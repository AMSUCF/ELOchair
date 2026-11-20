import type { ConferenceConfig } from "@elochair/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agreementAcks, auditLog, outbox } from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import type { MemoryTransport } from "./mail";
import { grantRole } from "./repo";
import { call, makeTestApp, personId, signIn, type TestApp } from "./testkit";

/*
 * Chairs edit the agreements (spec 02, §1.5 and §1.9). Consent is recorded against an
 * agreement's version, so what it says (its title, its text, its link) changes only together
 * with its version: the review says so beside the version, and a save is refused. A new version
 * asks whoever submits or confirms next, emails nobody, and leaves submitted work as it is.
 * All on the made-up fixture call, whose three agreements are at version "draft-1".
 */

let t: TestApp;
let conferenceId: string;
const SLUG = "agreements-call";
const NOW = new Date("2027-02-01T12:00:00Z");
const words = (n: number) => Array.from({ length: n }, () => "verse").join(" ");
const cookies: Record<string, string> = {};
type Config = ConferenceConfig;
type Agreement = Config["agreements"][number];
type Sub = { id: string; version: number; status: string };
/** The call as it was seeded, and the token that names it. */
let seeded: { config: Config; token: string };

const at = (rest: string) => `/api/conferences/${SLUG}/${rest}`;
const settings = async () => {
  const got = await call(t.public, "GET", at("settings"), { cookie: cookies.chair });
  expect(got.status).toBe(200);
  return got.json as { config: Config; token: string };
};
/** The stored configuration with `change` applied, sent by the chair to `rest`. */
async function chair(method: "POST" | "PUT", rest: string, change: (config: Config) => void) {
  const { config, token } = await settings();
  const next = structuredClone(config);
  change(next);
  return call(t.public, method, at(rest), { cookie: cookies.chair, ifMatch: token, body: next });
}
const save = (change: (config: Config) => void) => chair("PUT", "config", change);
const preview = (change: (config: Config) => void) => chair("POST", "config/preview", change);
/** One of a configuration's agreements, to change it. */
const agreement = (c: Config, key: string): Agreement => {
  const found = c.agreements.find((a) => a.key === key);
  if (!found) throw new Error(`no agreement ${key}`);
  return found;
};
const audited = async () =>
  (
    await t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.conferenceId, conferenceId),
          eq(auditLog.action, "conference.config_updated"),
        ),
      )
      .orderBy(auditLog.id)
  ).map((row) => (row.details as { changes: { path: string }[] }).changes.map((c) => c.path));
/** What each agreement's version is in a configuration, as a person accepts them. */
const versions = (c: Config) => c.agreements.map((a) => ({ key: a.key, version: a.version }));
const accepted = async (email: string) =>
  (
    await t.db
      .select()
      .from(agreementAcks)
      .where(eq(agreementAcks.personId, await personId(t, email)))
  )
    .map((row) => `${row.key}@${row.version}`)
    .sort();

async function person(who: string, name: string) {
  const email = `agreements-${who}@example.org`;
  const cookie = await signIn(t, email);
  const res = await call(t.public, "PUT", "/api/me/profile", {
    cookie,
    body: {
      displayName: name,
      affiliation: null,
      country: null,
      languages: ["en"],
      pronouns: null,
      orcid: null,
      bios: {},
    },
  });
  expect(res.status).toBe(200);
  cookies[who] = cookie;
  return email;
}
async function draft(who: string, title: string): Promise<Sub> {
  const created = await call(t.public, "POST", at("submissions"), {
    cookie: cookies[who],
    body: { typeKey: "talk", language: "en", participationMode: "in_person" },
  });
  expect(created.status).toBe(201);
  const filled = await call(t.public, "PATCH", `/api/submissions/${created.json.id}`, {
    cookie: cookies[who],
    body: { version: created.json.version, title, abstract: words(260) },
  });
  expect(filled.status).toBe(200);
  return filled.json;
}
const submit = (who: string, s: Sub, acceptedAgreements: { key: string; version: string }[]) =>
  call(t.public, "POST", `/api/submissions/${s.id}/submit`, {
    cookie: cookies[who],
    body: { version: s.version, acceptedAgreements },
  });
const proposal = async (who: string, s: Sub) =>
  (await call(t.public, "GET", `/api/submissions/${s.id}`, { cookie: cookies[who] })).json as Sub;

beforeAll(async () => {
  t = await makeTestApp();
  ({ conferenceId } = await seedTestCall(t.db, { slug: SLUG, now: NOW }));
  await person("chair", "Zed Agreementschair");
  await grantRole(t.db, {
    conferenceId,
    personId: await personId(t, "agreements-chair@example.org"),
    role: "chair",
  });
  await person("owner", "Olga Ownerperson");
  seeded = await settings();
}, 120_000);
afterAll(() => t.close());

describe("what an agreement says changes only together with its version", () => {
  it("starts from three agreements at one version, as the fixture call has them", () => {
    expect(versions(seeded.config)).toEqual(
      (fixtureCall.agreements ?? []).map((a) => ({ key: a.key, version: a.version })),
    );
    expect(seeded.config.agreements.map((a) => a.key)).toEqual([
      "privacy",
      "code_of_conduct",
      "recordings",
    ]);
  });

  it("refuses, in the review and in the save, a title, a text or a link changed under the stored version", async () => {
    const cases: [string, (c: Config) => void, string[], string[]][] = [
      [
        "a title in the main language",
        (c) => {
          agreement(c, "privacy").title.en = "Privacy notice, revised";
        },
        ["agreements.privacy.title.en"],
        ["privacy"],
      ],
      [
        "a title in another language",
        (c) => {
          agreement(c, "privacy").title.es = "Aviso de privacidad, revisado";
        },
        ["agreements.privacy.title.es"],
        ["privacy"],
      ],
      [
        "a text",
        (c) => {
          agreement(c, "recordings").text = { en: "Sessions are recorded and kept for a year." };
        },
        [
          "agreements.recordings.text.en",
          "agreements.recordings.text.es",
          "agreements.recordings.text.pt",
        ],
        ["recordings"],
      ],
      [
        "a text taken away in one language",
        (c) => {
          delete agreement(c, "privacy").text?.pt;
        },
        ["agreements.privacy.text.pt"],
        ["privacy"],
      ],
      [
        "a link",
        (c) => {
          agreement(c, "code_of_conduct").url = "https://example.org/another-code";
        },
        ["agreements.code_of_conduct.url"],
        ["code_of_conduct"],
      ],
      [
        "a link added where there was a text",
        (c) => {
          agreement(c, "privacy").url = "https://example.org/privacy";
        },
        ["agreements.privacy.url"],
        ["privacy"],
      ],
      [
        "a text added where there was a link",
        (c) => {
          agreement(c, "code_of_conduct").text = { en: "Be kind." };
        },
        ["agreements.code_of_conduct.text.en"],
        ["code_of_conduct"],
      ],
      [
        "two agreements at once, one of them with a new version",
        (c) => {
          agreement(c, "privacy").title.en = "Privacy notice, revised";
          agreement(c, "code_of_conduct").url = "https://example.org/another-code";
          agreement(c, "recordings").title.en = "Recordings policy, revised";
          agreement(c, "recordings").version = "draft-2";
        },
        [
          "agreements.privacy.title.en",
          "agreements.code_of_conduct.url",
          "agreements.recordings.title.en",
          "agreements.recordings.version",
        ],
        ["privacy", "code_of_conduct"],
      ],
    ];
    const rows = (await audited()).length;
    for (const [what, change, changed, refused] of cases) {
      const issues = refused.map((key) => ({
        path: `agreements.${key}.version`,
        code: "agreement_version_required",
      }));
      // The review names the version beside which the reason is shown, and offers no save.
      const reviewed = await preview(change);
      expect(reviewed.status, what).toBe(200);
      expect(
        reviewed.json.changes.map((c: { path: string }) => c.path),
        what,
      ).toEqual(changed);
      expect(reviewed.json.issues, what).toMatchObject(issues);
      expect(reviewed.json.issues, what).toHaveLength(issues.length);
      expect(reviewed.json.canSave, what).toBe(false);
      // Saved without a review, it is refused with the same issues, and nothing is stored.
      const refusal = await save(change);
      expect(refusal.status, what).toBe(409);
      expect(refusal.json.error, what).toBe("agreement_version_required");
      expect(refusal.json.issues, what).toMatchObject(issues);
      expect((await settings()).token, what).toBe(seeded.token);
    }
    expect(await audited()).toHaveLength(rows);
  });

  it("takes a new version alone, and the same changes together with one, audited by path", async () => {
    // A new version and nothing else.
    const alone = (c: Config) => {
      agreement(c, "recordings").version = "draft-2";
    };
    expect((await preview(alone)).json).toMatchObject({ canSave: true, issues: [] });
    expect((await save(alone)).status).toBe(200);
    expect((await audited()).at(-1)).toEqual(["agreements.recordings.version"]);

    // A title, a text and a link, each with its agreement's new version.
    const together = (c: Config) => {
      const privacy = agreement(c, "privacy");
      privacy.title.en = "Privacy notice, revised";
      privacy.text = { ...privacy.text, en: "We keep less than before.\n\nWe share nothing." };
      privacy.version = "2027-02";
      const conduct = agreement(c, "code_of_conduct");
      conduct.url = "https://example.org/another-code";
      conduct.version = "2";
    };
    const reviewed = await preview(together);
    expect(reviewed.json).toMatchObject({ canSave: true, issues: [], blocked: null });
    const saved = await save(together);
    expect(saved.status).toBe(200);
    expect((await audited()).at(-1)).toEqual([
      "agreements.privacy.title.en",
      "agreements.privacy.text.en",
      "agreements.privacy.version",
      "agreements.code_of_conduct.url",
      "agreements.code_of_conduct.version",
    ]);
    expect(agreement(saved.json.config, "privacy")).toMatchObject({
      version: "2027-02",
      title: { en: "Privacy notice, revised" },
      text: { en: "We keep less than before.\n\nWe share nothing." },
    });

    // The words now belong to the new version: going back to the old ones needs a version too.
    const wordsBack = (c: Config) => {
      agreement(c, "privacy").title.en = agreement(seeded.config, "privacy").title.en ?? "";
    };
    expect((await preview(wordsBack)).json.issues).toMatchObject([
      { path: "agreements.privacy.version", code: "agreement_version_required" },
    ]);
    expect((await save(wordsBack)).status).toBe(409);
    // Any version that differs from the stored one will do, an earlier one included: back to
    // the call as it was seeded.
    const back = await save((c) => {
      c.agreements = structuredClone(seeded.config.agreements);
    });
    expect(back.status).toBe(200);
    expect((await settings()).token).toBe(seeded.token);
  });

  it("refuses a link that is not https, and an agreement left with neither a text nor a link", async () => {
    const insecure = await preview((c) => {
      agreement(c, "code_of_conduct").url = "http://example.org/code-of-conduct";
      agreement(c, "code_of_conduct").version = "2";
    });
    expect(insecure.json.canSave).toBe(false);
    expect(insecure.json.issues).toMatchObject([
      { path: "agreements.code_of_conduct.url", code: "url" },
    ]);
    const emptied = await preview((c) => {
      delete agreement(c, "code_of_conduct").url;
      agreement(c, "code_of_conduct").version = "2";
    });
    expect(emptied.json.issues).toMatchObject([
      { path: "agreements.code_of_conduct.url", code: "agreement_needs_text_or_link" },
    ]);
    // A version is a short text: too long is said as such, not as a number that is too large.
    const long = await preview((c) => {
      agreement(c, "privacy").version = "x".repeat(41);
    });
    expect(long.json.issues).toMatchObject([
      { path: "agreements.privacy.version", code: "too_long", params: { max: 40 } },
    ]);
    for (const refused of [insecure, emptied, long]) expect(refused.json.canSave).toBe(false);
    expect((await settings()).token).toBe(seeded.token);
  });
});

describe("what a new version does", () => {
  const OWNER = "agreements-owner@example.org";
  const INVITEE = "agreements-invitee@example.org";
  let submitted: Sub;
  let next: Sub;
  let inviteToken: string;

  beforeAll(async () => {
    // One proposal is submitted under the versions the call was seeded with; another is a
    // draft with someone invited to it, whose invitation is still to answer.
    submitted = await draft("owner", "Submitted before the new version");
    const sent = await submit("owner", submitted, versions(seeded.config));
    expect(sent.status).toBe(200);
    submitted = sent.json.submission;
    next = await draft("owner", "Submitted after the new version");
    const invited = await call(t.public, "POST", `/api/submissions/${next.id}/contributors`, {
      cookie: cookies.owner,
      body: {
        version: next.version,
        email: INVITEE,
        role: "coauthor",
        lang: "en",
        name: "Ines Invitee",
      },
    });
    expect(invited.status).toBe(201);
    next = invited.json;
    const mail = await call(
      t.public,
      "GET",
      `/api/_test/outbox/latest?to=${encodeURIComponent(INVITEE)}`,
    );
    inviteToken = /#token=(inv_[A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1] ?? "";
    expect(inviteToken).not.toBe("");
  });

  it("is saved with submitted work present: nothing blocks, nothing warns, nobody is emailed", async () => {
    expect(await accepted(OWNER)).toEqual([
      "code_of_conduct@draft-1",
      "privacy@draft-1",
      "recordings@draft-1",
    ]);
    const queued = (await t.db.select().from(outbox)).length;
    const delivered = (t.deps.mail as MemoryTransport).sent.length;

    const change = (c: Config) => {
      const privacy = agreement(c, "privacy");
      privacy.text = { ...privacy.text, en: "We keep less than before." };
      privacy.version = "2027-02";
    };
    const reviewed = await preview(change);
    expect(reviewed.json).toMatchObject({
      canSave: true,
      issues: [],
      blocked: null,
      warnings: { drafts: 0, callOpens: false, callCloses: false, pastDeadlines: [] },
    });
    expect((await save(change)).status).toBe(200);

    // No mail was queued by the save, and none went out.
    expect(await t.db.select().from(outbox)).toHaveLength(queued);
    expect((t.deps.mail as MemoryTransport).sent).toHaveLength(delivered);
    // The submitted proposal is as it was, to its version number.
    expect(await proposal("owner", submitted)).toMatchObject({
      status: "submitted",
      version: submitted.version,
    });
    // What its owner accepted stays recorded against the old version, and nothing is recorded
    // against the new one until somebody accepts it.
    expect(await accepted(OWNER)).toEqual([
      "code_of_conduct@draft-1",
      "privacy@draft-1",
      "recordings@draft-1",
    ]);
  });

  it("asks whoever submits next to accept the new version: the old one is refused", async () => {
    const stored = (await settings()).config;
    expect(versions(stored)).toContainEqual({ key: "privacy", version: "2027-02" });

    // A page opened before the change still offers the old version.
    const old = await submit("owner", next, versions(seeded.config));
    expect(old.status).toBe(422);
    expect(old.json.issues).toEqual([{ path: "agreements", code: "agreements_required" }]);
    expect((await proposal("owner", next)).status).toBe("draft");

    const now = await submit("owner", next, versions(stored));
    expect(now.status).toBe(200);
    expect(now.json.submission.status).toBe("submitted");
    // Both acceptances are on record: the old version from before, the new one from now.
    expect(await accepted(OWNER)).toEqual([
      "code_of_conduct@draft-1",
      "privacy@2027-02",
      "privacy@draft-1",
      "recordings@draft-1",
    ]);
  });

  it("asks whoever confirms an invitation next, in the same way", async () => {
    const stored = (await settings()).config;
    const answer = (acceptedAgreements: { key: string; version: string }[]) =>
      call(t.public, "POST", "/api/invitations/answer", {
        body: {
          token: inviteToken,
          answer: "confirm",
          displayName: "Ines Invitee",
          acceptedAgreements,
        },
      });
    const old = await answer(versions(seeded.config));
    expect(old.status).toBe(422);
    expect(old.json.issues).toEqual([{ path: "agreements", code: "agreements_required" }]);
    expect((await answer(versions(stored))).json).toEqual({ answer: "confirmed" });
    expect(await accepted(INVITEE)).toEqual([
      "code_of_conduct@draft-1",
      "privacy@2027-02",
      "recordings@draft-1",
    ]);
  });
});
