import type { ChairContributor, ChairSubmission } from "@elochair/policy";
import { findLeaks } from "@elochair/policy/testing";
import { ConferenceConfig, conferences } from "@elochair/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contributorsCsv, submissionsCsv } from "./csv";
import { auditLog, contributions, people, submissions } from "./db/schema";
import { type SandboxSummary, seedSandbox } from "./fixtures";
import {
  createApiToken,
  getConference,
  loadPersonViewer,
  loadSubmissionRecords,
  saveConference,
} from "./repo";
import { queryAllSubmissions, querySubmissions } from "./services/submissions";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Chair-facing lists and exports: excludedCount for people and their agents, CSV paging past one
 * page, the presenter-cap flag, and invitees shown only as the owner typed them.
 */

let t: TestApp;
let s: SandboxSummary;
let chairCookie: string;
let chairId: string;
let tokenM: string;
let tokenC: string;
let ownSubmittedId: string;
const extraIds: string[] = [];

/** RFC 4180 rows (quoted cells, "" escapes, CRLF line ends), without the byte order mark. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && src[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

/** The CSV as objects keyed by header. */
async function csv(path: string, auth: { cookie?: string; token?: string; internal?: boolean }) {
  const app = auth.internal ? t.internal : t.public;
  const headers: Record<string, string> = {};
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  const res = await app.request(path, { headers });
  expect(res.status).toBe(200);
  const text = await res.text();
  const [header, ...rows] = parseCsv(text);
  return {
    text,
    omitted: res.headers.get("x-omitted-rows"),
    rows: rows.map((r) => Object.fromEntries((header ?? []).map((h, i) => [h, r[i] ?? ""]))),
  };
}

async function insertSubmission(opts: {
  ownerId: string;
  typeKey?: string;
  status?: string;
  title?: string;
}): Promise<string> {
  const k = await getConference(t.db, s.slug);
  const [row] = await t.db
    .insert(submissions)
    .values({
      conferenceId: k!.id,
      ownerPersonId: opts.ownerId,
      typeKey: opts.typeKey ?? "talk",
      language: "en",
      title: opts.title ?? "A fictional extra talk",
      abstract: "Fictional words for a test.",
      status: opts.status ?? "submitted",
      submittedAt: opts.status === "draft" ? null : new Date("2026-02-20T12:00:00Z"),
    })
    .returning({ id: submissions.id });
  await t.db.insert(contributions).values({
    submissionId: row!.id,
    personId: opts.ownerId,
    role: "lead",
    position: 0,
    status: "confirmed",
  });
  return row!.id;
}

beforeAll(async () => {
  t = await makeTestApp();
  await saveConference(t.db, conferences.elo2027, "draft");
  s = await seedSandbox(t.db);
  chairCookie = await signIn(t, s.chairEmail);
  chairId = await personId(t, s.chairEmail);
  tokenM = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "M",
      name: "cloud",
    })
  ).token;
  tokenC = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "C",
      name: "local",
    })
  ).token;
  // The chair's own work: one submitted proposal and one draft. Chairs cannot manage their own.
  ownSubmittedId = await insertSubmission({ ownerId: chairId, title: "The chair's own talk" });
  await insertSubmission({ ownerId: chairId, status: "draft", title: "The chair's own draft" });
  // Enough plain submissions to need more than one page of 500. Panels do not count toward the
  // presenter cap, so their one author stays under it.
  const [author] = await t.db
    .insert(people)
    .values({ email: "extra-author@example.org", displayName: "Fictional Extra Author" })
    .returning({ id: people.id });
  const extras = await t.db
    .insert(submissions)
    .values(
      Array.from({ length: 320 }, () => ({
        conferenceId: s.conferenceId,
        ownerPersonId: author!.id,
        typeKey: "panel",
        language: "en",
        title: "A fictional extra panel",
        abstract: "Fictional words for a test.",
        status: "submitted",
        submittedAt: new Date("2026-02-20T12:00:00Z"),
      })),
    )
    .returning({ id: submissions.id });
  extraIds.push(...extras.map((x) => x.id));
  await t.db
    .insert(contributions)
    .values(
      extraIds.map((id) => ({ submissionId: id, personId: author!.id, role: "lead", position: 0 })),
    );
}, 180_000);
afterAll(() => t.close());

describe("excludedCount", () => {
  it("is the same for a chair and their tier M and tier C agents: own work is excluded", async () => {
    const path = `/api/conferences/${s.slug}/submissions?limit=1`;
    const person = await call(t.public, "GET", path, { cookie: chairCookie });
    const agentM = await call(t.public, "GET", path, { token: tokenM });
    const agentC = await call(t.internal, "GET", path, { token: tokenC });
    for (const res of [person, agentM, agentC]) expect(res.status).toBe(200);
    // One own submitted proposal; the own draft is never counted.
    expect(person.json.excludedCount).toBe(1);
    expect(agentM.json.excludedCount).toBe(1);
    expect(agentC.json.excludedCount).toBe(1);
  });

  it("is what the CSV reports as omitted, in the header and in the audit row", async () => {
    const out = await csv(`/api/conferences/${s.slug}/submissions.csv`, { cookie: chairCookie });
    expect(out.omitted).toBe("1");
    expect(out.rows.some((r) => r.id === ownSubmittedId)).toBe(false);
    const viaC = await csv(`/api/conferences/${s.slug}/submissions.csv`, {
      token: tokenC,
      internal: true,
    });
    expect(viaC.omitted).toBe("1");
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "submissions.exported"));
    expect(rows.at(-1)?.details).toMatchObject({ omitted: 1 });
  });
});

describe("CSV exports", () => {
  it("include every row past the first page of 500, whatever cursor or limit the client sends", async () => {
    const expected = s.submissionCount + extraIds.length;
    expect(expected).toBeGreaterThan(500);
    const all = await csv(`/api/conferences/${s.slug}/submissions.csv`, { cookie: chairCookie });
    expect(all.rows).toHaveLength(expected);
    expect(new Set(all.rows.map((r) => r.id)).size).toBe(expected);
    for (const id of extraIds) expect(all.text).toContain(id);

    const cursor = all.rows[3]?.id ?? "";
    const paged = await csv(`/api/conferences/${s.slug}/submissions.csv?limit=5&cursor=${cursor}`, {
      cookie: chairCookie,
    });
    expect(paged.rows).toHaveLength(expected);
    const contributorsCsv = await csv(`/api/conferences/${s.slug}/contributors.csv?limit=5`, {
      cookie: chairCookie,
    });
    expect(new Set(contributorsCsv.rows.map((r) => r.reference)).size).toBe(expected);
    const audit = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "submissions.exported"));
    expect(audit.at(-1)?.details).toMatchObject({ rows: expected, filters: [] });
  });

  it("queryAllSubmissions pages through small pages without losing or repeating rows", async () => {
    const k = await getConference(t.db, s.slug);
    const viewer = await loadPersonViewer(t.db, chairId);
    const records = (await loadSubmissionRecords(t.db, k!)).slice(0, 60);
    const query = { status: ["submitted" as const], cursor: records[5]?.submission.id, limit: 3 };
    const out = await queryAllSubmissions(t.db, viewer!, k!, query, records, 7);
    const ids = out.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(out.total);
    // The same rows, in the same order, as one big page from the start.
    const onePage = await querySubmissions(
      t.db,
      viewer!,
      k!,
      { ...query, cursor: undefined, limit: 500 },
      records,
    );
    expect(ids).toEqual(onePage.items.map((i) => i.id));
    expect(out.total).toBeGreaterThan(50);
  });

  it("flags over_presenter_cap only where the role counts toward the cap", async () => {
    const [over] = s.overCapPersonIds;
    const k = await getConference(t.db, s.slug);
    // The over-cap person's three led talks: these count.
    const led = (
      await t.db
        .select({ id: contributions.submissionId })
        .from(contributions)
        .where(and(eq(contributions.personId, over!), eq(contributions.role, "lead")))
    ).map((r) => r.id);
    expect(led).toHaveLength(3);
    // Submissions where no over-cap person holds any role yet.
    const busy = new Set(
      (
        await t.db
          .select({ id: contributions.submissionId })
          .from(contributions)
          .where(inArray(contributions.personId, s.overCapPersonIds))
      ).map((r) => r.id),
    );
    const free = (type: string) =>
      t.db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.conferenceId, k!.id), eq(submissions.typeKey, type)))
        .then((rows) =>
          rows.map((r) => r.id).filter((id) => !busy.has(id) && !extraIds.includes(id)),
        );
    const [panel] = await free("panel");
    const [coauthored, invited] = await free("talk");
    // A panelist on a panel (a type that does not count), a coauthor (a role that does not
    // count) and a pending invitation as presenter (not confirmed): none of these count.
    await t.db.insert(contributions).values([
      { submissionId: panel!, personId: over!, role: "panelist", position: 9, status: "confirmed" },
      { submissionId: coauthored!, personId: over!, role: "coauthor", position: 9 },
      {
        submissionId: invited!,
        personId: over!,
        role: "presenter",
        position: 9,
        status: "invited",
        invitedEmail: "over-cap@example.org",
        invitedName: "Typed Over Cap",
      },
    ]);
    const out = await csv(`/api/conferences/${s.slug}/submissions.csv`, { cookie: chairCookie });
    const flag = (id: string) => out.rows.find((r) => r.id === id)?.over_presenter_cap;
    for (const id of led) expect(flag(id)).toBe("yes");
    expect(flag(panel!)).toBe("");
    expect(flag(coauthored!)).toBe("");
    expect(flag(invited!)).toBe("");
    // Exactly the counted submissions of the three over-cap people, nothing else.
    const flagged = out.rows.filter((r) => r.over_presenter_cap === "yes").map((r) => r.id);
    expect(flagged).toHaveLength(9);
  });

  it("shows an invitee with an existing profile only as the owner typed them", async () => {
    const [invitee] = await t.db
      .insert(people)
      .values({
        email: "has-profile@example.org",
        displayName: "SECRETPROFILE Name",
        affiliation: "SECRETAFF Institute",
        country: "NZ",
        pronouns: "SECRETPRONOUN",
        bios: { en: "SECRETBIO of someone who never agreed" },
      })
      .returning({ id: people.id });
    const target = extraIds[0]!;
    await t.db.insert(contributions).values({
      submissionId: target,
      personId: invitee!.id,
      role: "coauthor",
      position: 1,
      status: "invited",
      invitedEmail: "has-profile@example.org",
      invitedName: "Typed Name",
      invitedAffiliation: "Typed Affiliation",
    });
    const markers = ["SECRETPROFILE", "SECRETAFF", "SECRETPRONOUN", "SECRETBIO"];
    const contribs = await csv(`/api/conferences/${s.slug}/contributors.csv`, {
      cookie: chairCookie,
    });
    const row = contribs.rows.find((r) => r.status === "invited" && r.name === "Typed Name");
    expect(row).toMatchObject({
      email: "has-profile@example.org",
      affiliation: "Typed Affiliation",
      country: "",
      pronouns: "",
      has_bio: "",
    });
    expect(findLeaks(contribs.text, markers)).toEqual([]);
    const subs = await csv(`/api/conferences/${s.slug}/submissions.csv`, { cookie: chairCookie });
    expect(subs.rows.find((r) => r.id === target)?.contributors).toContain("Typed Name");
    expect(findLeaks(subs.text, markers)).toEqual([]);
  });
});

describe("csv.ts on a chair projection", () => {
  const profile = {
    displayName: "MARKER-NAME",
    email: "marker-account@example.org",
    affiliation: "MARKER-AFF",
    country: "MARKER-COUNTRY",
    pronouns: "MARKER-PRONOUNS",
    orcid: null,
    bios: { en: "MARKER-BIO" },
  };
  const contributor = (over: Partial<ChairContributor>): ChairContributor => ({
    personId: "00000000-0000-4000-8000-000000000002",
    role: "coauthor",
    position: 1,
    status: "invited",
    isOwner: false,
    ...profile,
    invitedEmail: "typed@example.org",
    invitedName: "Typed Name",
    invitedAffiliation: "Typed Affiliation",
    ...over,
  });
  const row: ChairSubmission = {
    view: "chair",
    id: "00000000-0000-4000-8000-000000000001",
    conferenceId: "00000000-0000-4000-8000-000000000000",
    ownerPersonId: "00000000-0000-4000-8000-000000000009",
    version: 1,
    typeKey: "talk",
    trackKey: null,
    topicKeys: [],
    language: "en",
    title: "A title",
    abstract: "Some words",
    fields: {},
    participationMode: null,
    status: "submitted",
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z",
    submittedAt: "2027-01-01T00:00:00.000Z",
    contributors: [
      contributor({
        personId: "00000000-0000-4000-8000-000000000009",
        role: "lead",
        position: 0,
        status: "confirmed",
        isOwner: true,
        displayName: "Owner Profile Name",
        email: "owner@example.org",
        affiliation: "Owner Profile Affiliation",
        country: "CO",
        pronouns: "she/her",
        bios: { en: "A bio" },
        invitedEmail: null,
        invitedName: null,
        invitedAffiliation: null,
      }),
      contributor({}),
      contributor({
        personId: "00000000-0000-4000-8000-000000000003",
        position: 2,
        status: "declined",
        invitedEmail: "declined@example.org",
        invitedName: "Declined Typed",
        invitedAffiliation: null,
      }),
    ],
    issueCodes: [],
    selfIdWarningCount: 0,
    assignedReviewerIds: [],
    conflictCount: 0,
  };
  const markers = ["MARKER-", "marker-account"];

  it("renders invited and declined contributors from the invitation fields only", () => {
    const text = contributorsCsv([row]);
    expect(findLeaks(text, markers)).toEqual([]);
    const [, owner, invited, declined] = parseCsv(text);
    expect(owner?.slice(5)).toEqual([
      "Owner Profile Name",
      "owner@example.org",
      "Owner Profile Affiliation",
      "CO",
      "she/her",
      "yes",
    ]);
    expect(invited?.slice(5)).toEqual([
      "Typed Name",
      "typed@example.org",
      "Typed Affiliation",
      "",
      "",
      "",
    ]);
    expect(declined?.slice(5)).toEqual(["Declined Typed", "declined@example.org", "", "", "", ""]);
  });

  it("lists invitees in submissions.csv by the name and address the owner typed", () => {
    const config = ConferenceConfig.parse(conferences.elo2026);
    const text = submissionsCsv(config, [row], new Set());
    expect(findLeaks(text, markers)).toEqual([]);
    expect(text).toContain("Typed Name <typed@example.org> (coauthor, invited)");
    expect(text).not.toContain("Declined Typed");
  });
});

describe("paging the chair list (#12)", () => {
  const list = (query: string) =>
    call(t.public, "GET", `/api/conferences/${s.slug}/submissions?${query}`, {
      cookie: chairCookie,
    });
  const ids = (res: { json: { items: { id: string }[] } }) => res.json.items.map((i) => i.id);

  it("continues after the last item shown, even when it has since left the filter", async () => {
    const everything = ids(await list("status=submitted&limit=500"));
    const page1 = await list("status=submitted&limit=100");
    expect(ids(page1)).toEqual(everything.slice(0, 100));
    const boundary = page1.json.nextCursor as string;
    expect(boundary).toBe(everything[99]);
    // The boundary proposal is withdrawn before "Show more": it no longer matches.
    await t.db.update(submissions).set({ status: "withdrawn" }).where(eq(submissions.id, boundary));
    try {
      const page2 = await list(`status=submitted&limit=100&cursor=${boundary}`);
      expect(page2.status).toBe(200);
      expect(ids(page2)).toEqual(everything.slice(100, 200));
      expect(page2.json.total).toBe(page1.json.total - 1);
      // A cursor that never matched the filter is placed in the same order.
      const other = page1.json.items[99].typeKey === "panel" ? "talk" : "panel";
      const ofOtherType = ids(await list(`type=${other}&status=submitted&limit=500`));
      expect(ofOtherType).not.toContain(boundary);
      const position = everything.indexOf(boundary);
      const expected = ofOtherType.filter((id) => everything.indexOf(id) > position).slice(0, 5);
      expect(expected).toHaveLength(5);
      const next = await list(`type=${other}&status=submitted&limit=5&cursor=${boundary}`);
      expect(ids(next)).toEqual(expected);
    } finally {
      await t.db
        .update(submissions)
        .set({ status: "submitted" })
        .where(eq(submissions.id, boundary));
    }
  });

  it("refuses a cursor that is not a submission of the conference, instead of starting over", async () => {
    const madeUp = ["00000000-0000-4000-8000-000000000000", "page-2", ownSubmittedId.slice(1)];
    for (const cursor of madeUp) {
      const res = await list(`status=submitted&limit=100&cursor=${cursor}`);
      expect(res.status).toBe(400);
      expect(res.json).toEqual({
        error: "invalid",
        issues: [{ path: "cursor", message: expect.any(String) }],
      });
    }
  });

  it("answers a cursor the viewer cannot see like a made-up one, so it reveals nothing", async () => {
    const [first] = ids(await list("status=submitted&limit=1"));
    // A signed-in stranger sees the conference but none of its proposals while it is in review.
    const stranger = await signIn(t, "cursor-stranger@example.org");
    const asStranger = (cursor: string) =>
      call(t.public, "GET", `/api/conferences/${s.slug}/submissions?cursor=${cursor}`, {
        cookie: stranger,
      });
    const real = await asStranger(first as string);
    const madeUp = await asStranger("00000000-0000-4000-8000-000000000000");
    expect(real.status).toBe(400);
    expect(real.json).toEqual(madeUp.json);
    expect((await asStranger("")).status).toBe(200);
  });
});
