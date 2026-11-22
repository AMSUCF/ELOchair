import { findLeaks } from "@elochair/policy/testing";
import type { ConferenceConfig } from "@elochair/schema";
import { and, desc, eq, gt, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditLog,
  conferenceRoles,
  conflicts,
  notificationChoices,
  notifications,
  outbox,
  reviewerProfiles,
  reviewReminders,
} from "./db/schema";
import { fixtureCall, seedTestCall } from "./fixtures";
import { RateLimiter } from "./ratelimit";
import { createApiToken, getConference, grantRole, saveConference } from "./repo";
import { runNotifications } from "./services/notifications";
import { call, makeTestApp, ORIGIN, personId, signIn, type TestApp } from "./testkit";

/*
 * The emails of the review phase (spec 03, §1.7): what is recorded when something happens, what
 * the job makes of it by each person's choice (an email for each one, one summary a day, none),
 * the one reminder before reviews are due, what an email may carry, and each person's choices
 * on "Your account". The clock is the test's: nothing here waits.
 *
 * The conferences are in America/Bogota, five hours behind UTC all year: the summary's hour,
 * eight in the morning, is 13:00 UTC.
 */

/** Seven in the morning in Bogotá: an hour before the day's summary. */
const NOW = new Date("2027-02-01T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Eight in the morning there, on the day of NOW and on the days after. */
const eight = (daysOn = 0) => new Date(Date.parse("2027-02-01T13:00:00Z") + daysOn * DAY);
const after = (at: Date, ms = 1000) => new Date(at.getTime() + ms);
const AGREEMENTS = fixtureCall.agreements?.map((a) => ({ key: a.key, version: a.version })) ?? [];
/** The fixture call reviews talks in its first committee, which asks for three reviews. */
const POOL = fixtureCall.reviewPools[0]?.key ?? "";
const NEEDED = fixtureCall.reviewPools[0]?.reviewsPerSubmission ?? 0;
const CRITERIA = fixtureCall.reviewPools[0]?.criteria.map((c) => c.key) ?? [];
const words = (n: number) => Array.from({ length: n }, () => "verse").join(" ");
/** The outbox kinds of the four emails: their message keys. */
const KINDS = ["new_assignments", "review_reminder", "reviewer_declined", "reviews_complete"];

/** Everything a person typed in these tests: none of it may be in an email or in the audit log. */
const typed: string[] = [];
const mark = (text: string) => {
  typed.push(text);
  return text;
};

let t: TestApp;
let run = 0;
/** A name for whatever a test makes for itself: people and conferences are never shared. */
const fresh = (what: string) => `notify-${what}-${++run}`;
const address = (who: string) => `${who}@example.org`;

type Person = { cookie: string; id: string; email: string };
async function person(who: string, languages: string[] = ["en"]): Promise<Person> {
  const email = address(fresh(who));
  const cookie = await signIn(t, email);
  const res = await call(t.public, "PUT", "/api/me/profile", {
    cookie,
    body: {
      displayName: mark(`TYPEDNAME ${who} ${run}`),
      affiliation: null,
      country: null,
      languages,
      pronouns: null,
      orcid: null,
      bios: {},
    },
  });
  expect(res.status).toBe(200);
  return { cookie, id: await personId(t, email), email };
}

type World = { slug: string; conferenceId: string; chair: Person; owner: Person };
const at = (w: World | string, rest = "") =>
  `/api/conferences/${typeof w === "string" ? w : w.slug}${rest}`;

/** A conference with a chair and an author, its call still open. */
async function world(): Promise<World> {
  const slug = fresh("call");
  const { conferenceId } = await seedTestCall(t.db, { slug, now: NOW });
  const chair = await person("chair");
  await grantRole(t.db, { conferenceId, personId: chair.id, role: "chair" });
  return { slug, conferenceId, chair, owner: await person("owner") };
}

async function setConfig(w: World, change: (config: ConferenceConfig) => void, phase?: string) {
  const k = await getConference(t.db, w.slug);
  if (!k) throw new Error("no conference");
  const next = structuredClone(k.config);
  change(next);
  await saveConference(t.db, next, phase);
}
/** The call's closing date passes: reviewers can be assigned. */
const closeCall = (w: World) =>
  setConfig(w, (c) => {
    c.deadlines.submissionsClose = new Date(NOW.getTime() - HOUR).toISOString();
  });
const movePhase = (w: World, phase: string, from: string) =>
  call(t.public, "PUT", at(w, "/phase"), { cookie: w.chair.cookie, body: { phase, from } });
/** Closed and in review: where reviews are written. */
async function inReview(w: World) {
  await closeCall(w);
  expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
}

/** A talk by the world's author, submitted (while the call is open). */
async function talk(w: World, by: Person = w.owner): Promise<string> {
  const title = mark(`TYPEDTITLE ${fresh("talk")}`);
  const created = await call(t.public, "POST", at(w, "/submissions"), {
    cookie: by.cookie,
    body: { typeKey: "talk", language: "en", participationMode: "in_person" },
  });
  expect(created.status).toBe(201);
  const filled = await call(t.public, "PATCH", `/api/submissions/${created.json.id}`, {
    cookie: by.cookie,
    body: { version: created.json.version, title, abstract: mark(`TYPEDABSTRACT ${words(259)}`) },
  });
  expect(filled.status, JSON.stringify(filled.json)).toBe(200);
  const sent = await call(t.public, "POST", `/api/submissions/${created.json.id}/submit`, {
    cookie: by.cookie,
    body: { version: filled.json.version, acceptedAgreements: AGREEMENTS },
  });
  expect(sent.status, JSON.stringify(sent.json)).toBe(200);
  return created.json.id;
}

/** Someone with the reviewer's role for the first committee, as if they had accepted. */
async function reviewer(w: World, who = "reviewer", languages: string[] = ["en"]) {
  const p = await person(who, languages);
  await grantRole(t.db, {
    conferenceId: w.conferenceId,
    personId: p.id,
    role: "reviewer",
    scope: [POOL],
  });
  await t.db
    .insert(reviewerProfiles)
    .values({ conferenceId: w.conferenceId, personId: p.id, pools: [POOL], languages: ["en"] });
  return p;
}
const chairOf = async (w: World, who = "cochair", languages: string[] = ["en"]) => {
  const p = await person(who, languages);
  await grantRole(t.db, { conferenceId: w.conferenceId, personId: p.id, role: "chair" });
  return p;
};

const assign = (w: World, id: string, to: Person, by: Person = w.chair) =>
  call(t.public, "POST", at(w, `/assignments/submissions/${id}/reviewers`), {
    cookie: by.cookie,
    body: { reviewerId: to.id, confirmedFull: true },
  });
const unassign = (w: World, id: string, who: Person) =>
  call(t.public, "DELETE", at(w, `/assignments/submissions/${id}/reviewers/${who.id}`), {
    cookie: w.chair.cookie,
    body: {},
  });
async function assigned(w: World, id: string, ...to: Person[]) {
  for (const p of to) expect((await assign(w, id, p)).status, p.email).toBe(204);
}
const sendReview = (who: Person, id: string, version = 0, comments = "REVIEWTEXT a fine talk") =>
  call(t.public, "PUT", `/api/submissions/${id}/review`, {
    cookie: who.cookie,
    body: {
      version,
      send: true,
      scores: Object.fromEntries(CRITERIA.map((key) => [key, 4])),
      comments: mark(comments),
      chairNote: mark("REVIEWTEXT for the chairs only"),
      recommendation: "accept",
    },
  });
const giveBack = (who: Person, id: string, reason: string, note?: string) =>
  call(t.public, "POST", `/api/submissions/${id}/review/decline`, {
    cookie: who.cookie,
    body: { reason, ...(note ? { note: mark(note) } : {}) },
  });

const choices = (who: Person) => call(t.public, "GET", "/api/me/notifications", who);
const choose = (who: Person, w: World | string, body: unknown) =>
  call(t.public, "PUT", `/api/me/notifications/${typeof w === "string" ? w : w.slug}`, {
    cookie: who.cookie,
    body,
  });
async function chosen(who: Person, w: World, body: unknown) {
  expect((await choose(who, w, body)).status).toBe(200);
}

/**
 * What the job did at one conference while `work` ran, by what it wrote to the audit log. The
 * job looks at every conference there is, and the tests here share one database: each asks
 * about its own.
 */
async function did(w: World, work: () => Promise<unknown>) {
  const [last] = await t.db
    .select({ id: auditLog.id })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);
  await work();
  const rows = await t.db
    .select()
    .from(auditLog)
    .where(
      and(
        gt(auditLog.id, last?.id ?? 0),
        eq(auditLog.conferenceId, w.conferenceId),
        inArray(auditLog.action, ["notifications.answered", "review_reminder.sent"]),
      ),
    );
  const done = { emails: 0, reminders: 0, dropped: 0 };
  for (const row of rows) {
    const details = row.details as Record<string, number>;
    if (row.action === "review_reminder.sent") {
      done.reminders += details.reminded ?? 0;
      done.emails += details.reminded ?? 0;
    } else {
      done.emails += details.emails ?? 0;
      done.dropped += details.dropped ?? 0;
    }
  }
  return done;
}
/** One run of the job, at the time the clock says: what it did at that conference. */
const job = (w: World) => did(w, () => runNotifications(t.deps));
async function jobAt(w: World, when: Date) {
  t.setNow(when);
  try {
    return await job(w);
  } finally {
    t.setNow(NOW);
  }
}
/** The emails of the review phase that are in the outbox for someone, oldest first. */
async function mailTo(who: Person) {
  const rows = await t.db
    .select()
    .from(outbox)
    .where(and(eq(outbox.toEmail, who.email), inArray(outbox.kind, KINDS)))
    .orderBy(outbox.createdAt, outbox.subject, outbox.bodyText);
  return rows.map((m) => ({ kind: m.kind, subject: m.subject, text: m.bodyText }));
}
const waiting = async (who: Person) =>
  (await t.db.select().from(notifications).where(eq(notifications.personId, who.id)))
    .map((n) => ({ kind: n.kind, status: n.status, reason: n.reason, done: n.doneAt !== null }))
    .sort((a, b) => `${a.kind}${a.status}`.localeCompare(`${b.kind}${b.status}`));
const count = (text: string, label: string) =>
  Number(new RegExp(`^${label}: (\\d+)$`, "m").exec(text)?.[1] ?? Number.NaN);

beforeAll(async () => {
  t = await makeTestApp();
  // Many people sign in and write from one address here; the limits have their own tests.
  t.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
  t.deps.limits.linkPerEmail = new RateLimiter(100_000, 60_000);
});
afterAll(() => t?.close());

describe("what is recorded when something happens", () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it("an assignment records that the reviewer is to be told, and mails nobody", async () => {
    const r = await reviewer(w);
    const id = await talk(w);
    await closeCall(w);
    const before = (await t.db.select().from(outbox)).length;
    await assigned(w, id, r);
    const rows = await t.db.select().from(notifications).where(eq(notifications.personId, r.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conferenceId: w.conferenceId,
      personId: r.id,
      kind: "assigned",
      submissionId: id,
      reason: null,
      status: "pending",
      doneAt: null,
    });
    // When it happened, by the app's clock.
    expect(rows[0]?.createdAt.toISOString()).toBe(NOW.toISOString());
    // The email is made afterwards, by the job: assigning writes none.
    expect((await t.db.select().from(outbox)).length).toBe(before);
    // An assignment that is refused records nothing: it is all one transaction.
    expect((await assign(w, id, r)).status).toBe(409);
    expect(await waiting(r)).toHaveLength(1);
  });

  it("a proposal given back records it for every chair, with the reason and never the note", async () => {
    const inReviewNow = await world();
    const admin = await person("admin");
    await grantRole(t.db, {
      conferenceId: inReviewNow.conferenceId,
      personId: admin.id,
      role: "admin",
    });
    const second = await chairOf(inReviewNow);
    const r = await reviewer(inReviewNow);
    const id = await talk(inReviewNow);
    await inReview(inReviewNow);
    await assigned(inReviewNow, id, r);
    expect((await giveBack(r, id, "time", "NOTETEXT away until the day")).status).toBe(204);
    for (const chair of [inReviewNow.chair, admin, second]) {
      expect(await waiting(chair), chair.email).toEqual([
        { kind: "declined", status: "pending", reason: "time", done: false },
      ]);
    }
    // Nothing for the reviewer who gave it back, beyond their assignment, or for the author.
    expect((await waiting(r)).map((n) => n.kind)).toEqual(["assigned"]);
    expect(await waiting(inReviewNow.owner)).toEqual([]);
    const all = await t.db
      .select()
      .from(notifications)
      .where(eq(notifications.conferenceId, inReviewNow.conferenceId));
    expect(findLeaks(all, typed)).toEqual([]);
  });

  it("the review that gives a proposal all its reviews records it for the chairs, once", async () => {
    const v = await world();
    const rs = [await reviewer(v), await reviewer(v), await reviewer(v), await reviewer(v)];
    const id = await talk(v);
    await inReview(v);
    await assigned(v, id, ...rs);
    expect(NEEDED).toBe(3);
    const complete = async () => (await waiting(v.chair)).filter((n) => n.kind !== "assigned");
    // A draft is nobody's but its reviewer's, and counts for nothing.
    const draft = await call(t.public, "PUT", `/api/submissions/${id}/review`, {
      cookie: rs[0]?.cookie,
      body: {
        version: 0,
        send: false,
        scores: {},
        comments: "",
        chairNote: "",
        recommendation: null,
      },
    });
    expect(draft.status).toBe(200);
    expect((await sendReview(rs[0] as Person, id, 1)).status).toBe(200);
    expect((await sendReview(rs[1] as Person, id)).status).toBe(200);
    expect(await complete()).toEqual([]);
    // A sent review that is changed is not another review.
    expect((await sendReview(rs[0] as Person, id, 2, "REVIEWTEXT changed")).status).toBe(200);
    expect(await complete()).toEqual([]);
    // The third is the committee's number.
    expect((await sendReview(rs[2] as Person, id)).status).toBe(200);
    expect(await complete()).toEqual([
      { kind: "reviews_complete", status: "pending", reason: null, done: false },
    ]);
    // A fourth, and a change of the third, add nothing.
    expect((await sendReview(rs[3] as Person, id)).status).toBe(200);
    expect((await sendReview(rs[2] as Person, id, 1, "REVIEWTEXT changed again")).status).toBe(200);
    expect(await complete()).toHaveLength(1);
  });
});

describe("new assignments, as the reviewer chose", () => {
  let w: World;
  let talks: string[];
  beforeAll(async () => {
    w = await world();
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = "2027-03-10T23:59:00-05:00";
    });
    talks = [await talk(w), await talk(w), await talk(w)];
    await inReview(w);
  });

  it("each one: an email for each, at once, saying how many, when reviews are due and where the list is", async () => {
    const r = await reviewer(w);
    await chosen(r, w, { assignments: "each" });
    await assigned(w, talks[0] as string, r);
    await assigned(w, talks[1] as string, r);
    expect(await job(w)).toMatchObject({ emails: 2, dropped: 0 });
    const mail = await mailTo(r);
    expect(mail).toHaveLength(2);
    for (const m of mail) {
      expect(m.kind).toBe("new_assignments");
      expect(m.subject).toBe("Test call: proposals assigned to you for review");
      expect(count(m.text, "Newly assigned")).toBe(1);
      expect(m.text).toContain("Reviews are due by March 10, 2027");
      expect(m.text).toContain("(America/Bogota).");
      expect(m.text).toContain(`\n\n${ORIGIN}/en/reviews\n\n`);
      // Why they got it, in one line, and where to change that: the last thing in it.
      expect(m.text).toContain("You are getting this email because you review for Test call.");
      expect(m.text.endsWith(`\n\n${ORIGIN}/en/me#emails`)).toBe(true);
    }
    expect(await waiting(r)).toEqual([
      { kind: "assigned", status: "sent", reason: null, done: true },
      { kind: "assigned", status: "sent", reason: null, done: true },
    ]);
    // Run again, and again a day later: nothing is sent twice.
    expect(await job(w)).toMatchObject({ emails: 0 });
    expect(await jobAt(w, after(eight(1)))).toMatchObject({ emails: 0 });
    expect(await mailTo(r)).toHaveLength(2);
  });

  it("one summary a day, which is what holds for someone who chose nothing: one email at eight in the morning, with all that has gathered", async () => {
    const r = await reviewer(w);
    for (const id of talks) await assigned(w, id, r);
    // An hour before, a minute before, and at the very hour (what was written at the hour
    // waits for the next one): nothing yet.
    expect(await job(w)).toMatchObject({ emails: 0 });
    expect(await jobAt(w, new Date(eight().getTime() - 60_000))).toMatchObject({ emails: 0 });
    expect(await mailTo(r)).toEqual([]);
    expect((await waiting(r)).map((n) => n.status)).toEqual(["pending", "pending", "pending"]);
    // Once the conference's clock has passed eight: one email, which counts all three.
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 1 });
    const mail = await mailTo(r);
    expect(mail).toHaveLength(1);
    expect(count(mail[0]?.text ?? "", "Newly assigned")).toBe(3);
    expect((await waiting(r)).map((n) => n.status)).toEqual(["sent", "sent", "sent"]);
    // The same minute again, and every hour of the day: no second summary.
    for (let h = 0; h < 24; h++) {
      expect(await jobAt(w, after(eight(), h * HOUR + 2000))).toMatchObject({ emails: 0 });
    }
    expect(await mailTo(r)).toHaveLength(1);
  });

  it("one summary a day: a run that was missed is made up for by the next one, with one email", async () => {
    const r = await reviewer(w);
    await assigned(w, talks[0] as string, r);
    // Assigned again the next afternoon, to another proposal, while no job ran at all.
    t.setNow(after(eight(1), 6 * HOUR));
    try {
      await assigned(w, talks[1] as string, r);
    } finally {
      t.setNow(NOW);
    }
    // The server comes back three days later, in the middle of the night there.
    expect(await jobAt(w, new Date(eight(3).getTime() - 5 * HOUR))).toMatchObject({ emails: 1 });
    const mail = await mailTo(r);
    expect(mail).toHaveLength(1);
    expect(count(mail[0]?.text ?? "", "Newly assigned")).toBe(2);
  });

  it("one summary a day: what is assigned after a summary went out is in the next day's", async () => {
    const r = await reviewer(w);
    await assigned(w, talks[0] as string, r);
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 1 });
    t.setNow(after(eight(), 2 * HOUR));
    try {
      await assigned(w, talks[1] as string, r);
      // The rest of that day: nothing more.
      expect(await job(w)).toMatchObject({ emails: 0 });
      expect(await jobAt(w, new Date(eight(1).getTime() - 1000))).toMatchObject({ emails: 0 });
    } finally {
      t.setNow(NOW);
    }
    expect(await jobAt(w, after(eight(1)))).toMatchObject({ emails: 1 });
    expect((await mailTo(r)).map((m) => count(m.text, "Newly assigned"))).toEqual([1, 1]);
  });

  it("none: nothing is sent, and what waited is marked as answered by no email", async () => {
    const r = await reviewer(w);
    await chosen(r, w, { assignments: "none" });
    await assigned(w, talks[0] as string, r);
    await assigned(w, talks[1] as string, r);
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 0, dropped: 2 });
    expect(await mailTo(r)).toEqual([]);
    expect(await waiting(r)).toEqual([
      { kind: "assigned", status: "dropped", reason: null, done: true },
      { kind: "assigned", status: "dropped", reason: null, done: true },
    ]);
    // Choosing emails again brings nothing back: what was dropped stays dropped.
    await chosen(r, w, { assignments: "each" });
    expect(await job(w)).toMatchObject({ emails: 0, dropped: 0 });
    expect(await mailTo(r)).toEqual([]);
  });

  it("goes by the choice as it is when the job runs, not as it was when the proposal was assigned", async () => {
    const r = await reviewer(w);
    await assigned(w, talks[0] as string, r);
    expect(await job(w)).toMatchObject({ emails: 0 });
    await chosen(r, w, { assignments: "each" });
    expect(await job(w)).toMatchObject({ emails: 1 });
    expect(await mailTo(r)).toHaveLength(1);
  });

  it("someone taken off the proposal before the email is made gets none about it", async () => {
    const each = await reviewer(w);
    const daily = await reviewer(w);
    await chosen(each, w, { assignments: "each" });
    for (const r of [each, daily]) {
      for (const id of talks) await assigned(w, id, r);
      // A chair takes them off one of the three again.
      expect((await unassign(w, talks[1] as string, r)).status).toBe(204);
    }
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 3, dropped: 2 });
    // An email for each of the two that stand; and one summary that counts two.
    expect((await mailTo(each)).map((m) => count(m.text, "Newly assigned"))).toEqual([1, 1]);
    expect((await mailTo(daily)).map((m) => count(m.text, "Newly assigned"))).toEqual([2]);
    for (const r of [each, daily]) {
      expect((await waiting(r)).map((n) => n.status)).toEqual(["dropped", "sent", "sent"]);
    }
  });

  it("someone taken off every proposal, or off the committee, gets no email at all", async () => {
    const off = await reviewer(w);
    const out = await reviewer(w);
    const conflicted = await reviewer(w);
    for (const r of [off, out, conflicted]) {
      await chosen(r, w, { assignments: "each" });
      await assigned(w, talks[0] as string, r);
    }
    expect((await unassign(w, talks[0] as string, off)).status).toBe(204);
    // Their reviewer's role is removed, which releases the assignment with it.
    const removed = await call(t.public, "DELETE", at(w, `/people/${out.id}/roles/reviewer`), {
      cookie: w.chair.cookie,
      body: { assignments: 1, reviews: 0 },
    });
    expect(removed.status, JSON.stringify(removed.json)).toBe(204);
    // A conflict recorded since: the assignment stands, and gives them nothing.
    await t.db.insert(conflicts).values({
      conferenceId: w.conferenceId,
      personId: conflicted.id,
      submissionId: talks[0] as string,
      kind: "declared",
      declaredBy: "chair",
    });
    expect(await job(w)).toMatchObject({ emails: 0, dropped: 3 });
    for (const r of [off, out, conflicted]) {
      expect(await mailTo(r), r.email).toEqual([]);
      expect((await waiting(r)).map((n) => n.status)).toEqual(["dropped"]);
    }
  });

  it("assigned to the same proposal twice before the email is made: one new assignment", async () => {
    const r = await reviewer(w);
    await chosen(r, w, { assignments: "each" });
    await assigned(w, talks[0] as string, r);
    expect((await unassign(w, talks[0] as string, r)).status).toBe(204);
    await assigned(w, talks[0] as string, r);
    expect(await job(w)).toMatchObject({ emails: 1, dropped: 0 });
    expect((await mailTo(r)).map((m) => count(m.text, "Newly assigned"))).toEqual([1]);
    expect((await waiting(r)).map((n) => n.status)).toEqual(["sent", "sent"]);
  });

  it("is written in the reader's language, with links to the pages in that language", async () => {
    const es = await reviewer(w, "revisora", ["es", "en"]);
    const pt = await reviewer(w, "revisor", ["pt-BR"]);
    for (const r of [es, pt]) {
      await chosen(r, w, { assignments: "each" });
      await assigned(w, talks[0] as string, r);
    }
    await job(w);
    const [spanish] = await mailTo(es);
    expect(spanish?.subject).toBe(
      "Convocatoria de prueba: te han asignado propuestas para revisar",
    );
    expect(spanish?.text).toContain(
      "Nuevas asignaciones: 1\nLas revisiones se entregan hasta el 10 de marzo de 2027",
    );
    expect(spanish?.text).toContain(`\n\n${ORIGIN}/es/reviews\n\n`);
    expect(spanish?.text).toContain(
      "Recibes este correo porque revisas para Convocatoria de prueba.",
    );
    expect(spanish?.text.endsWith(`\n\n${ORIGIN}/es/me#emails`)).toBe(true);
    const [portuguese] = await mailTo(pt);
    expect(portuguese?.subject).toBe("Chamada de teste: foram-lhe atribuídas propostas para rever");
    expect(portuguese?.text).toContain(
      "Novas atribuições: 1\nAs revisões são entregues até 10 de março de 2027",
    );
    expect(portuguese?.text).toContain(`\n\n${ORIGIN}/pt/reviews\n\n`);
    expect(portuguese?.text).toContain("Recebe este email porque revê para Chamada de teste.");
    expect(portuguese?.text.endsWith(`\n\n${ORIGIN}/pt/me#emails`)).toBe(true);
  });

  it("says so where the chairs have set no day reviews are due", async () => {
    const v = await world();
    const r = await reviewer(v);
    const id = await talk(v);
    await inReview(v);
    await chosen(r, v, { assignments: "each" });
    await assigned(v, id, r);
    await job(v);
    expect((await mailTo(r))[0]?.text).toContain(
      "Newly assigned: 1\nThe chairs have not set a day when reviews are due.\n\n",
    );
  });

  it("a chair who assigns a proposal to themself is told nothing: nobody is emailed about their own act", async () => {
    const v = await world();
    const cochair = await chairOf(v);
    const ids = [await talk(v), await talk(v)];
    await inReview(v);
    for (const c of [v.chair, cochair]) {
      await grantRole(t.db, {
        conferenceId: v.conferenceId,
        personId: c.id,
        role: "reviewer",
        scope: [POOL],
      });
      await chosen(c, v, { assignments: "each", chairNotices: "each" });
    }
    // To themself: nothing is recorded. By the other chair: told like any reviewer.
    expect((await assign(v, ids[0] as string, v.chair)).status).toBe(204);
    expect(await waiting(v.chair)).toEqual([]);
    expect((await assign(v, ids[1] as string, v.chair, cochair)).status).toBe(204);
    expect(await job(v)).toMatchObject({ emails: 1 });
    expect((await mailTo(v.chair)).map((m) => m.kind)).toEqual(["new_assignments"]);
    // They give one back: the other chair is told, and they are not.
    expect((await giveBack(v.chair, ids[0] as string, "time")).status).toBe(204);
    expect(await job(v)).toMatchObject({ emails: 1 });
    expect((await mailTo(cochair)).map((m) => m.kind)).toEqual(["reviewer_declined"]);
    expect((await mailTo(v.chair)).map((m) => m.kind)).toEqual(["new_assignments"]);
    expect((await waiting(v.chair)).map((n) => n.kind)).toEqual(["assigned"]);
  });
});

describe("new assignments, before the conference is in review and after", () => {
  it("wait until reviewers can open what is assigned to them, and are then sent as chosen", async () => {
    const w = await world();
    const each = await reviewer(w);
    const daily = await reviewer(w);
    const id = await talk(w);
    await closeCall(w);
    await chosen(each, w, { assignments: "each" });
    // Assigned in the days between the closing date and the move into review.
    await assigned(w, id, each, daily);
    for (const when of [NOW, after(eight()), after(eight(2))]) {
      expect(await jobAt(w, when)).toMatchObject({ emails: 0, dropped: 0 });
    }
    expect((await waiting(each)).map((n) => n.status)).toEqual(["pending"]);
    // The chairs move the conference into review, three days later in the afternoon.
    const then = after(eight(3), 7 * HOUR);
    t.setNow(then);
    try {
      expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
      // Both are told at the next run: the summary's hour has passed since they were assigned.
      expect(await job(w)).toMatchObject({ emails: 2 });
    } finally {
      t.setNow(NOW);
    }
    expect(await mailTo(each)).toHaveLength(1);
    expect(await mailTo(daily)).toHaveLength(1);
  });

  it("are dropped if the conference has left review before they were announced", async () => {
    const w = await world();
    const r = await reviewer(w);
    const id = await talk(w);
    await closeCall(w);
    await chosen(r, w, { assignments: "each" });
    await assigned(w, id, r);
    expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
    expect((await movePhase(w, "deciding", "reviewing")).status).toBe(200);
    expect(await job(w)).toMatchObject({ emails: 0, dropped: 1 });
    expect(await mailTo(r)).toEqual([]);
    // And so is one that is made after review: reviews are read then, not written.
    const late = await reviewer(w);
    await chosen(late, w, { assignments: "each" });
    await assigned(w, id, late);
    expect(await job(w)).toMatchObject({ emails: 0, dropped: 1 });
    expect(await mailTo(late)).toEqual([]);
    expect((await waiting(late)).map((n) => n.status)).toEqual(["dropped"]);
  });
});

describe("notices to chairs, as each chair chose", () => {
  let w: World;
  let each: Person;
  let daily: Person;
  let none: Person;
  beforeAll(async () => {
    w = await world();
    each = await chairOf(w, "each");
    daily = await chairOf(w, "daily");
    none = await chairOf(w, "none");
    await chosen(each, w, { chairNotices: "each" });
    await chosen(none, w, { chairNotices: "none" });
    // The world's own chair chose nothing either: "none" here, to keep them out of the counts.
    await chosen(w.chair, w, { chairNotices: "none" });
  });

  it("a proposal given back: an email for each one at once, one summary a day, or none, with the reasons in words", async () => {
    const r = await reviewer(w);
    const other = await reviewer(w);
    const ids = [await talk(w), await talk(w), await talk(w)];
    await inReview(w);
    await assigned(w, ids[0] as string, r);
    await assigned(w, ids[1] as string, other);
    await assigned(w, ids[2] as string, r);
    expect(
      (await giveBack(r, ids[0] as string, "time", "NOTETEXT no time before the day")).status,
    ).toBe(204);
    expect((await giveBack(other, ids[1] as string, "expertise")).status).toBe(204);
    expect(
      (await giveBack(r, ids[2] as string, "conflict", "NOTETEXT I know whose this is")).status,
    ).toBe(204);
    // Each one: three emails at once, each with its own reason.
    // (Dropped: the three of the chair who chose none, and of the world's own chair.)
    expect(await job(w)).toMatchObject({ emails: 3, dropped: 6 });
    const mails = await mailTo(each);
    expect(mails.map((m) => m.kind)).toEqual([
      "reviewer_declined",
      "reviewer_declined",
      "reviewer_declined",
    ]);
    expect(mails.map((m) => /^Reason given: (.+)$/m.exec(m.text)?.[1]).sort()).toEqual([
      "a conflict of interest",
      "no time",
      "outside what they can judge",
    ]);
    for (const m of mails) {
      expect(m.subject).toBe("Test call: proposals given back by reviewers");
      expect(
        count(m.text, "Proposals that a reviewer gave back, saying they cannot review them"),
      ).toBe(1);
      expect(m.text).toContain(`\n\n${ORIGIN}/en/c/${w.slug}/assignments\n\n`);
      expect(m.text).toContain("You are getting this email because you are a chair of Test call.");
      expect(m.text.endsWith(`\n\n${ORIGIN}/en/me#emails`)).toBe(true);
    }
    // None: nothing, and nothing left waiting.
    expect(await mailTo(none)).toEqual([]);
    expect((await waiting(none)).map((n) => n.status)).toEqual(["dropped", "dropped", "dropped"]);
    // One summary a day: nothing until eight, then one email that counts all three, with each
    // reason once, in the app's order.
    expect(await mailTo(daily)).toEqual([]);
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 1 });
    const [summary] = await mailTo(daily);
    expect(
      count(
        summary?.text ?? "",
        "Proposals that a reviewer gave back, saying they cannot review them",
      ),
    ).toBe(3);
    expect(summary?.text).toContain(
      "Reason given: a conflict of interest; outside what they can judge; no time\n",
    );
    expect(await mailTo(daily)).toHaveLength(1);
    expect(await jobAt(w, after(eight(1)))).toMatchObject({ emails: 0 });
  });

  it("a proposal that two reviewers gave back is one proposal given back, with both their reasons", async () => {
    const v = await world();
    await chosen(v.chair, v, { chairNotices: "each" });
    const summarized = await chairOf(v, "daily");
    const rs = [await reviewer(v), await reviewer(v)];
    const id = await talk(v);
    await inReview(v);
    await assigned(v, id, ...rs);
    expect((await giveBack(rs[0] as Person, id, "time")).status).toBe(204);
    expect((await giveBack(rs[1] as Person, id, "expertise")).status).toBe(204);
    const given = "Proposals that a reviewer gave back, saying they cannot review them";
    await jobAt(v, after(eight()));
    for (const chair of [v.chair, summarized]) {
      const mails = await mailTo(chair);
      // What the email counts is what it says: proposals.
      expect(
        mails.map((m) => count(m.text, given)),
        chair.email,
      ).toEqual([1]);
      expect(mails[0]?.text).toContain("Reason given: outside what they can judge; no time\n");
      expect((await waiting(chair)).map((n) => n.status)).toEqual(["sent", "sent"]);
    }
  });

  it("a proposal with all its reviews: the same three ways", async () => {
    const v = await world();
    const eachHere = await chairOf(v, "each");
    const noneHere = await chairOf(v, "none");
    await chosen(eachHere, v, { chairNotices: "each" });
    await chosen(noneHere, v, { chairNotices: "none" });
    const rs = [await reviewer(v), await reviewer(v), await reviewer(v)];
    const ids = [await talk(v), await talk(v)];
    await inReview(v);
    for (const id of ids) {
      await assigned(v, id, ...rs);
      for (const r of rs) {
        await chosen(r, v, { assignments: "none" });
        expect((await sendReview(r, id)).status).toBe(200);
      }
    }
    expect(await job(v)).toMatchObject({ emails: 2 });
    const mails = await mailTo(eachHere);
    expect(mails).toHaveLength(2);
    for (const m of mails) {
      expect(m.kind).toBe("reviews_complete");
      expect(m.subject).toBe("Test call: proposals that have all their reviews");
      expect(
        count(m.text, "Proposals that now have all the reviews their committee asks for"),
      ).toBe(1);
      expect(m.text).toContain(`\n\n${ORIGIN}/en/c/${v.slug}/assignments\n\n`);
      expect(m.text).toContain("You are getting this email because you are a chair of Test call.");
      expect(m.text.endsWith(`\n\n${ORIGIN}/en/me#emails`)).toBe(true);
    }
    expect(await mailTo(noneHere)).toEqual([]);
    // The world's own chair chose nothing: one summary, the next morning, that counts both.
    expect(await mailTo(v.chair)).toEqual([]);
    expect(await jobAt(v, after(eight()))).toMatchObject({ emails: 1 });
    const [summary] = await mailTo(v.chair);
    expect(
      count(
        summary?.text ?? "",
        "Proposals that now have all the reviews their committee asks for",
      ),
    ).toBe(2);
  });

  it("are in the chair's language", async () => {
    const v = await world();
    const es = await chairOf(v, "presidenta", ["es"]);
    const pt = await chairOf(v, "presidente", ["pt"]);
    for (const c of [es, pt]) await chosen(c, v, { chairNotices: "each" });
    const r = await reviewer(v);
    const id = await talk(v);
    await inReview(v);
    await assigned(v, id, r);
    expect((await giveBack(r, id, "time")).status).toBe(204);
    await job(v);
    const [spanish] = await mailTo(es);
    expect(spanish?.subject).toBe(
      "Convocatoria de prueba: propuestas devueltas por quienes revisan",
    );
    expect(spanish?.text).toContain("Motivo indicado: falta de tiempo\n");
    expect(spanish?.text).toContain(`\n\n${ORIGIN}/es/c/${v.slug}/assignments\n\n`);
    expect(spanish?.text).toContain("Recibes este correo porque presides Convocatoria de prueba.");
    const [portuguese] = await mailTo(pt);
    expect(portuguese?.subject).toBe("Chamada de teste: propostas devolvidas por quem revê");
    expect(portuguese?.text).toContain("Motivo indicado: falta de tempo\n");
    expect(portuguese?.text.endsWith(`\n\n${ORIGIN}/pt/me#emails`)).toBe(true);
  });
});

describe("a chair is told nothing about a proposal that is kept from them", () => {
  it("not about their own proposal, and not about one they have a conflict with: no email, and no number", async () => {
    const w = await world();
    const author = await chairOf(w, "authorchair");
    const conflicted = await chairOf(w, "conflictedchair");
    for (const c of [w.chair, author, conflicted]) await chosen(c, w, { chairNotices: "each" });
    const rs = [await reviewer(w), await reviewer(w), await reviewer(w), await reviewer(w)];
    const own = await talk(w, author);
    const theirs = await talk(w);
    const plain = await talk(w);
    await t.db.insert(conflicts).values({
      conferenceId: w.conferenceId,
      personId: conflicted.id,
      submissionId: theirs,
      kind: "declared",
      declaredBy: "chair",
    });
    await inReview(w);
    for (const id of [own, theirs, plain]) {
      await assigned(w, id, ...rs);
      // One reviewer gives it back, and the other three send their reviews: it has them all.
      expect((await giveBack(rs[3] as Person, id, "time")).status).toBe(204);
      for (const r of rs.slice(0, 3)) expect((await sendReview(r, id)).status).toBe(200);
    }
    await jobAt(w, after(eight()));
    const kinds = async (who: Person) => (await mailTo(who)).map((m) => m.kind).sort();
    // The chair who manages all three is told of all three, twice each.
    expect(await kinds(w.chair)).toEqual([
      ...Array(3).fill("reviewer_declined"),
      ...Array(3).fill("reviews_complete"),
    ]);
    // The two others are told of the two they manage, and of nothing else.
    for (const kept of [author, conflicted]) {
      expect(await kinds(kept), kept.email).toEqual([
        "reviewer_declined",
        "reviewer_declined",
        "reviews_complete",
        "reviews_complete",
      ]);
      expect((await waiting(kept)).map((n) => `${n.kind} ${n.status}`).sort()).toEqual([
        "declined dropped",
        "declined sent",
        "declined sent",
        "reviews_complete dropped",
        "reviews_complete sent",
        "reviews_complete sent",
      ]);
    }
  });

  it("nor in a summary: it counts the proposals that chair manages", async () => {
    const w = await world();
    const author = await chairOf(w, "authorchair");
    const r = await reviewer(w);
    const own = await talk(w, author);
    const plain = await talk(w);
    await inReview(w);
    for (const id of [own, plain]) {
      await assigned(w, id, r);
      expect((await giveBack(r, id, "expertise")).status).toBe(204);
    }
    expect(await jobAt(w, after(eight()))).toMatchObject({ emails: 2 });
    const given = "Proposals that a reviewer gave back, saying they cannot review them";
    expect((await mailTo(w.chair)).map((m) => count(m.text, given))).toEqual([2]);
    expect((await mailTo(author)).map((m) => count(m.text, given))).toEqual([1]);
    // Only their own was given back: no email at all, not one that says nothing happened.
    const v = await world();
    const alone = await chairOf(v, "authorchair");
    const rv = await reviewer(v);
    const only = await talk(v, alone);
    await inReview(v);
    await assigned(v, only, rv);
    expect((await giveBack(rv, only, "time")).status).toBe(204);
    await jobAt(v, after(eight()));
    expect(await mailTo(alone)).toEqual([]);
    expect(await mailTo(v.chair)).toHaveLength(1);
  });

  it("and someone who is no longer a chair when the email is made gets none", async () => {
    const w = await world();
    const leaving = await chairOf(w, "leaving");
    const r = await reviewer(w);
    const id = await talk(w);
    await inReview(w);
    await assigned(w, id, r);
    expect((await giveBack(r, id, "time")).status).toBe(204);
    const removed = await call(t.public, "DELETE", at(w, `/people/${leaving.id}/roles/chair`), {
      cookie: w.chair.cookie,
      body: {},
    });
    expect(removed.status).toBe(204);
    await jobAt(w, after(eight()));
    expect(await mailTo(leaving)).toEqual([]);
    expect((await waiting(leaving)).map((n) => n.status)).toEqual(["dropped"]);
    expect(await mailTo(w.chair)).toHaveLength(1);
  });
});

describe("the one reminder before reviews are due", () => {
  /** Reviews are due at the end of 11 February, Bogotá time. */
  const DUE = "2027-02-11T23:59:00-05:00";
  /** Three days before, at eight in the morning there: when the reminder goes out. */
  const OPENS = new Date("2027-02-08T13:00:00Z");
  const CLOSES = new Date(DUE);
  type Set = {
    w: World;
    /** Two proposals, none sent. */
    busy: Person;
    /** One proposal, sent. */
    done: Person;
    /** One proposal, a draft: not sent. */
    drafting: Person;
    /** One proposal, not sent, and the reminder turned off. */
    off: Person;
    /** A reviewer with nothing assigned. */
    idle: Person;
  };
  async function set(
    change: (c: ConferenceConfig) => void = () => {},
    review = true,
  ): Promise<Set> {
    const w = await world();
    const [busy, done, drafting, off, idle] = [
      await reviewer(w, "busy"),
      await reviewer(w, "done"),
      await reviewer(w, "drafting"),
      await reviewer(w, "off"),
      await reviewer(w, "idle"),
    ];
    const ids = [await talk(w), await talk(w)];
    await closeCall(w);
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = DUE;
      change(c);
    });
    await assigned(w, ids[0] as string, busy, done, drafting, off);
    await assigned(w, ids[1] as string, busy);
    // Nobody here wants an email about the assignments themselves.
    for (const r of [busy, done, drafting, idle]) await chosen(r, w, { assignments: "none" });
    await chosen(off, w, { assignments: "none", reminder: false });
    if (review) {
      expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
      expect((await sendReview(done, ids[0] as string)).status).toBe(200);
      const draft = await call(t.public, "PUT", `/api/submissions/${ids[0]}/review`, {
        cookie: drafting.cookie,
        body: {
          version: 0,
          send: false,
          scores: {},
          comments: "",
          chairNote: "",
          recommendation: null,
        },
      });
      expect(draft.status).toBe(200);
    }
    await job(w);
    return { w, busy, done, drafting, off, idle };
  }
  const reminders = async (who: Person) =>
    (await mailTo(who)).filter((m) => m.kind === "review_reminder");
  const marker = (w: World) =>
    t.db.select().from(reviewReminders).where(eq(reviewReminders.conferenceId, w.conferenceId));

  it("goes out three days before, at eight in the morning: not a minute earlier", async () => {
    const s = await set();
    for (const early of [NOW, new Date(OPENS.getTime() - DAY), new Date(OPENS.getTime() - 1000)]) {
      expect(await jobAt(s.w, early), early.toISOString()).toMatchObject({ reminders: 0 });
    }
    expect(await marker(s.w)).toEqual([]);
    expect(await jobAt(s.w, OPENS)).toMatchObject({ reminders: 2, emails: 2 });
    const [mail] = await reminders(s.busy);
    expect(mail?.subject).toBe("Test call: reviews are due soon");
    expect(mail?.text).toContain(
      "A reminder about your reviews for Test call.\n\nReviews are due by February 11, 2027",
    );
    expect(mail?.text).toContain("(America/Bogota).\nReviews you have not sent yet: 2\n\n");
    expect(mail?.text).toContain(`\n\n${ORIGIN}/en/reviews\n\n`);
    expect(mail?.text).toContain(
      "You are getting this reminder because you review for Test call and have reviews that are not sent. To get no reminder from this conference, change your choices under",
    );
    expect(mail?.text.endsWith(`\n\n${ORIGIN}/en/me#emails`)).toBe(true);
    // A draft is not a sent review: one not sent.
    expect(
      count((await reminders(s.drafting))[0]?.text ?? "", "Reviews you have not sent yet"),
    ).toBe(1);
  });

  it("goes to nobody who has nothing left to send, has no proposal, or turned it off", async () => {
    const s = await set();
    await jobAt(s.w, OPENS);
    expect(await reminders(s.done)).toEqual([]);
    expect(await reminders(s.idle)).toEqual([]);
    expect(await reminders(s.off)).toEqual([]);
    // Nor to the chair or the author, who review nothing.
    expect(await reminders(s.w.chair)).toEqual([]);
    expect(await reminders(s.w.owner)).toEqual([]);
  });

  it("is sent once: not at the next run, not the next day, and not to someone assigned meanwhile", async () => {
    const s = await set();
    expect(await jobAt(s.w, OPENS)).toMatchObject({ reminders: 2 });
    // Remembered for the conference, with the day it was for.
    expect((await marker(s.w)).map((m) => m.reviewsDue.toISOString())).toEqual([
      CLOSES.toISOString(),
    ]);
    for (const later of [OPENS, after(OPENS, 60_000), after(OPENS, DAY), after(OPENS, 3 * DAY)]) {
      expect(await jobAt(s.w, later), later.toISOString()).toMatchObject({ reminders: 0 });
    }
    // The one who had nothing is given a proposal the next day; and the one who had turned
    // it off turns it on again. Neither is reminded: it was decided once for that day, for all
    // of them.
    const more = await t.db
      .select()
      .from(notifications)
      .where(eq(notifications.personId, s.busy.id));
    await assigned(s.w, more[1]?.submissionId ?? "", s.idle);
    await chosen(s.off, s.w, { reminder: true });
    expect(await jobAt(s.w, after(OPENS, DAY))).toMatchObject({ reminders: 0 });
    for (const who of [s.busy, s.drafting]) expect(await reminders(who)).toHaveLength(1);
    for (const who of [s.idle, s.off, s.done]) expect(await reminders(who)).toEqual([]);
  });

  it("is still sent by a server that was down at the hour, until the day reviews are due", async () => {
    const s = await set();
    // Back two days late, at night: the reminder goes out then.
    expect(await jobAt(s.w, after(OPENS, 2 * DAY + 9 * HOUR))).toMatchObject({ reminders: 2 });
    expect(await reminders(s.busy)).toHaveLength(1);
    // Back only after the day itself: nobody is reminded of a day that has passed.
    const late = await set();
    for (const past of [CLOSES, after(CLOSES), after(CLOSES, 5 * DAY)]) {
      expect(await jobAt(late.w, past)).toMatchObject({ reminders: 0 });
    }
    expect(await reminders(late.busy)).toEqual([]);
    expect(await marker(late.w)).toEqual([]);
    // The minute before the day ends is still in time.
    const last = await set();
    expect(await jobAt(last.w, new Date(CLOSES.getTime() - 60_000))).toMatchObject({
      reminders: 2,
    });
    expect(await reminders(last.busy)).toHaveLength(1);
  });

  it("is for the day the chairs set: if they move the day, reviewers are reminded of the new one in its turn", async () => {
    const s = await set();
    expect(await jobAt(s.w, OPENS)).toMatchObject({ reminders: 2 });
    // The chairs give everyone two more weeks.
    const later = "2027-02-25T23:59:00-05:00";
    await setConfig(s.w, (c) => {
      c.deadlines.reviewsDue = later;
    });
    const opens = new Date("2027-02-22T13:00:00Z");
    for (const early of [after(OPENS, DAY), new Date(opens.getTime() - 1000)]) {
      expect(await jobAt(s.w, early), early.toISOString()).toMatchObject({ reminders: 0 });
    }
    expect(await jobAt(s.w, opens)).toMatchObject({ reminders: 2 });
    const mails = await reminders(s.busy);
    expect(mails).toHaveLength(2);
    expect(mails.map((m) => /February (\d+), 2027/.exec(m.text)?.[1]).sort()).toEqual(["11", "25"]);
    expect((await marker(s.w)).map((m) => m.reviewsDue.toISOString())).toEqual([
      new Date(later).toISOString(),
    ]);
    // Once for that day too.
    expect(await jobAt(s.w, after(opens, DAY))).toMatchObject({ reminders: 0 });
    expect(await reminders(s.busy)).toHaveLength(2);
  });

  it("is not lost where there was nobody to remind, or where a day was typed wrong", async () => {
    // In review, the day close, and nothing assigned yet: nobody to remind.
    const w = await world();
    const r = await reviewer(w);
    const id = await talk(w);
    await inReview(w);
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = DUE;
    });
    expect(await jobAt(w, OPENS)).toMatchObject({ reminders: 0, emails: 0 });
    // Decided for that day all the same: someone assigned afterwards is not reminded of it.
    await chosen(r, w, { assignments: "none" });
    await assigned(w, id, r);
    expect(await jobAt(w, after(OPENS, DAY))).toMatchObject({ reminders: 0 });
    expect(await reminders(r)).toEqual([]);
    // The chairs then set the day they meant: the reviewer is reminded before it.
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = "2027-02-25T23:59:00-05:00";
    });
    expect(await jobAt(w, new Date("2027-02-22T13:00:00Z"))).toMatchObject({ reminders: 1 });
    expect(await reminders(r)).toHaveLength(1);
  });

  it("goes out as many days before as the chairs set", async () => {
    const s = await set((c) => {
      c.rules.reviewReminderDays = 5;
    });
    const five = new Date("2027-02-06T13:00:00Z");
    expect(await jobAt(s.w, new Date(five.getTime() - 1000))).toMatchObject({ reminders: 0 });
    expect(await jobAt(s.w, five)).toMatchObject({ reminders: 2 });
    expect(await reminders(s.busy)).toHaveLength(1);
    const one = await set((c) => {
      c.rules.reviewReminderDays = 1;
    });
    expect(await jobAt(one.w, after(OPENS, DAY))).toMatchObject({ reminders: 0 });
    expect(await jobAt(one.w, new Date("2027-02-10T13:00:00Z"))).toMatchObject({ reminders: 2 });
    expect(await reminders(one.busy)).toHaveLength(1);
  });

  it("is not sent where no day is set, and not while the conference is not in review", async () => {
    const none = await set((c) => {
      delete c.deadlines.reviewsDue;
    });
    for (const when of [OPENS, after(OPENS, DAY), after(CLOSES)]) {
      expect(await jobAt(none.w, when)).toMatchObject({ reminders: 0 });
    }
    expect(await reminders(none.busy)).toEqual([]);
    // Assigned, a day set, and the chairs have not moved the conference into review yet.
    const early = await set(() => {}, false);
    expect(await jobAt(early.w, OPENS)).toMatchObject({ reminders: 0 });
    expect(await marker(early.w)).toEqual([]);
    // They do so a day later, still before the day: the reminder goes out at the next run.
    t.setNow(after(OPENS, DAY));
    try {
      expect((await movePhase(early.w, "reviewing", "cfp_open")).status).toBe(200);
      expect(await job(early.w)).toMatchObject({ reminders: 3 });
    } finally {
      t.setNow(NOW);
    }
    // Everyone with a proposal has reviews not sent there: nothing was written before review.
    for (const who of [early.busy, early.done, early.drafting]) {
      expect(await reminders(who)).toHaveLength(1);
    }
    expect(await reminders(early.off)).toEqual([]);
    // Past review, nobody is reminded: reviews are read, not written.
    const over = await set();
    expect((await movePhase(over.w, "deciding", "reviewing")).status).toBe(200);
    expect(await jobAt(over.w, OPENS)).toMatchObject({ reminders: 0 });
    expect(await reminders(over.busy)).toEqual([]);
  });

  it("is in the reader's language", async () => {
    const w = await world();
    const es = await reviewer(w, "revisora", ["es"]);
    const pt = await reviewer(w, "revisor", ["pt"]);
    const id = await talk(w);
    await closeCall(w);
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = DUE;
    });
    await assigned(w, id, es, pt);
    expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
    await jobAt(w, OPENS);
    const [spanish] = await reminders(es);
    expect(spanish?.subject).toBe("Convocatoria de prueba: se acerca la entrega de las revisiones");
    expect(spanish?.text).toContain(
      "Un recordatorio sobre tus revisiones para Convocatoria de prueba.\n\nLas revisiones se entregan hasta el 11 de febrero de 2027",
    );
    expect(spanish?.text).toContain("Revisiones que aún no has enviado: 1\n");
    expect(spanish?.text.endsWith(`\n\n${ORIGIN}/es/me#emails`)).toBe(true);
    const [portuguese] = await reminders(pt);
    expect(portuguese?.subject).toBe("Chamada de teste: aproxima-se a entrega das revisões");
    expect(portuguese?.text).toContain("Revisões que ainda não enviou: 1\n");
    expect(portuguese?.text).toContain(`\n\n${ORIGIN}/pt/reviews\n\n`);
  });
});

describe("running the job twice, and at the same moment", () => {
  it("answers every notification once, and reminds once", async () => {
    const w = await world();
    const each = await reviewer(w);
    const daily = await reviewer(w);
    const ids = [await talk(w), await talk(w)];
    await closeCall(w);
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = "2027-02-11T23:59:00-05:00";
    });
    await chosen(each, w, { assignments: "each" });
    for (const id of ids) await assigned(w, id, each, daily);
    expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
    const when = new Date("2027-02-08T13:00:05Z");
    t.setNow(when);
    try {
      const three = () => Promise.all([1, 2, 3].map(() => runNotifications(t.deps)));
      // Between them: two emails for the one, one summary for the other, and two reminders.
      expect(await did(w, three)).toEqual({ emails: 5, reminders: 2, dropped: 0 });
      expect(await job(w)).toEqual({ emails: 0, reminders: 0, dropped: 0 });
    } finally {
      t.setNow(NOW);
    }
    expect((await mailTo(each)).map((m) => m.kind).sort()).toEqual([
      "new_assignments",
      "new_assignments",
      "review_reminder",
    ]);
    expect((await mailTo(daily)).map((m) => m.kind).sort()).toEqual([
      "new_assignments",
      "review_reminder",
    ]);
    // Every notification is marked with the time it was answered, in the same step.
    const rows = await t.db
      .select()
      .from(notifications)
      .where(eq(notifications.conferenceId, w.conferenceId));
    expect(rows.map((n) => n.status)).toEqual(["sent", "sent", "sent", "sent"]);
    expect(rows.every((n) => n.doneAt?.toISOString() === when.toISOString())).toBe(true);
  });

  it("goes on to the other conferences when one of them cannot be read", async () => {
    const broken = await world();
    const good = await world();
    const stuck = await reviewer(broken);
    const told = await reviewer(good);
    for (const [w, r] of [
      [broken, stuck],
      [good, told],
    ] as const) {
      const id = await talk(w);
      await inReview(w);
      await chosen(r, w, { assignments: "each" });
      await assigned(w, id, r);
    }
    // A stored configuration that no longer reads, as a version of the app that knows more
    // might leave one. (Written directly: no route would store it.)
    const { conferences } = await import("./db/schema");
    const [row] = await t.db
      .select()
      .from(conferences)
      .where(eq(conferences.id, broken.conferenceId));
    const logged: unknown[][] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => logged.push(args);
    try {
      await t.db
        .update(conferences)
        .set({ config: { ...(row?.config as object), timezone: "Nowhere/At_All" } })
        .where(eq(conferences.id, broken.conferenceId));
      expect(await job(good)).toMatchObject({ emails: 1 });
    } finally {
      console.error = error;
      await t.db
        .update(conferences)
        .set({ config: row?.config })
        .where(eq(conferences.id, broken.conferenceId));
    }
    expect(await mailTo(told)).toHaveLength(1);
    expect(await mailTo(stuck)).toEqual([]);
    expect(logged.map((l) => String(l[0]))).toEqual([
      `notifications failed for conference ${broken.conferenceId}`,
      `the reminder failed for conference ${broken.conferenceId}`,
    ]);
    // Put right, it is answered at the next run: nothing was lost.
    expect(await job(broken)).toMatchObject({ emails: 1 });
    expect(await mailTo(stuck)).toHaveLength(1);
  });
});

describe("what an email may carry", () => {
  it("is a number, the conference, a day, a reason out of three and two links: nothing anyone typed", async () => {
    const w = await world();
    const cochair = await chairOf(w, "cochair");
    const rs = [await reviewer(w), await reviewer(w), await reviewer(w), await reviewer(w)];
    const ids = [await talk(w), await talk(w)];
    await closeCall(w);
    await setConfig(w, (c) => {
      c.deadlines.reviewsDue = "2027-02-11T23:59:00-05:00";
    });
    expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
    for (const [i, c] of [w.chair, cochair].entries()) {
      await chosen(c, w, { chairNotices: i === 0 ? "each" : "daily" });
    }
    for (const [i, r] of rs.entries()) {
      await chosen(r, w, { assignments: i % 2 ? "each" : "daily" });
    }
    await assigned(w, ids[0] as string, ...rs);
    await assigned(w, ids[1] as string, ...rs);
    expect(
      (
        await giveBack(
          rs[3] as Person,
          ids[0] as string,
          "conflict",
          "NOTETEXT the author is my sister",
        )
      ).status,
    ).toBe(204);
    for (const r of rs.slice(0, 3)) {
      expect((await sendReview(r, ids[0] as string, 0, `REVIEWTEXT by ${r.email}`)).status).toBe(
        200,
      );
    }
    await jobAt(w, new Date("2027-02-08T13:00:05Z"));
    const everyone = [w.chair, cochair, w.owner, ...rs];
    const sent = (await Promise.all(everyone.map(mailTo))).flat();
    // All four emails were made.
    expect([...new Set(sent.map((m) => m.kind))].sort()).toEqual([...KINDS].sort());
    // No title, abstract, name, address of anyone else, note or word of a review; no id either.
    const ids_ = [...ids, w.conferenceId, ...everyone.map((p) => p.id)];
    for (const who of everyone) {
      const theirs = await mailTo(who);
      const others = everyone.filter((p) => p !== who).map((p) => p.email);
      expect(findLeaks(theirs, [...typed, ...others, ...ids_]), who.email).toEqual([]);
    }
    expect(typed.length).toBeGreaterThan(10);
    // The author gets none of them.
    expect(await mailTo(w.owner)).toEqual([]);
    // What the job wrote to the audit log is numbers and kinds.
    const audited = await t.db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.conferenceId, w.conferenceId),
          inArray(auditLog.action, ["notifications.answered", "review_reminder.sent"]),
        ),
      );
    expect(audited.length).toBeGreaterThan(3);
    for (const row of audited) expect(row.actorKind).toBe("system");
    // Nobody is named in it: who was written to is in the outbox, and that something was
    // dropped for someone is nobody's to read.
    expect(
      findLeaks(audited, [...typed, ...everyone.flatMap((p) => [p.email, p.id]), ...ids]),
    ).toEqual([]);
    for (const row of audited) {
      expect([row.actorPersonId, row.targetType, row.targetId]).toEqual([
        null,
        "conference",
        w.conferenceId,
      ]);
    }
    expect(audited.find((a) => a.action === "review_reminder.sent")?.details).toEqual({
      reminded: 4,
      reviewsDue: "2027-02-12T04:59:00.000Z",
    });
    expect(
      audited
        .filter((a) => a.action === "notifications.answered")
        .map((a) => Object.keys(a.details as object).sort()),
    ).toEqual(Array(audited.length - 1).fill(["dropped", "emails", "kind", "sent"]));
  });

  it("is in the chairs' own words where they wrote some, and a text without the link to the choices is refused", async () => {
    const w = await world();
    const r = await reviewer(w);
    const id = await talk(w);
    await inReview(w);
    const settings = async () =>
      (await call(t.public, "GET", at(w, "/settings"), { cookie: w.chair.cookie })).json as {
        config: ConferenceConfig;
        token: string;
      };
    const send = async (
      method: "PUT" | "POST",
      rest: string,
      messages: ConferenceConfig["messages"],
    ) => {
      const { config, token } = await settings();
      return call(t.public, method, at(w, rest), {
        cookie: w.chair.cookie,
        ifMatch: token,
        body: { ...config, messages },
      });
    };
    const save = (messages: ConferenceConfig["messages"]) => send("PUT", "/config", messages);
    // Each of the four in the chairs' words, in English, with all of its placeholders.
    const own = {
      new_assignments: {
        subject: { en: "{count} for you at {conference}" },
        body: { en: "[new_assignments] {count} / {conference} / {due}\n{link}\n{choices}" },
      },
      review_reminder: {
        body: { en: "[review_reminder] {count} / {conference} / {due}\n{link}\n{choices}" },
      },
      reviewer_declined: {
        body: { en: "[reviewer_declined] {count} / {reason} / {conference}\n{link}\n{choices}" },
      },
      reviews_complete: {
        body: { en: "[reviews_complete] {count} / {conference}\n{link}\n{choices}" },
      },
    };
    expect((await save(own)).status).toBe(200);
    await chosen(r, w, { assignments: "each" });
    await chosen(w.chair, w, { chairNotices: "each" });
    await assigned(w, id, r);
    await job(w);
    expect(await mailTo(r)).toEqual([
      {
        kind: "new_assignments",
        subject: "1 for you at Test call",
        text: `[new_assignments] 1 / Test call / The chairs have not set a day when reviews are due.\n${ORIGIN}/en/reviews\n${ORIGIN}/en/me#emails`,
      },
    ]);
    expect((await giveBack(r, id, "expertise")).status).toBe(204);
    await job(w);
    expect(await mailTo(w.chair)).toEqual([
      {
        kind: "reviewer_declined",
        // The subject was not reworded: it is the standard one.
        subject: "Test call: proposals given back by reviewers",
        text: `[reviewer_declined] 1 / outside what they can judge / Test call\n${ORIGIN}/en/c/${w.slug}/assignments\n${ORIGIN}/en/me#emails`,
      },
    ]);
    // A reader in another language gets the standard text in theirs.
    const es = await reviewer(w, "revisora", ["es"]);
    await chosen(es, w, { assignments: "each" });
    await assigned(w, id, es);
    await job(w);
    expect((await mailTo(es))[0]?.subject).toBe(
      "Convocatoria de prueba: te han asignado propuestas para revisar",
    );

    // A text that leaves out the link to the choices, or lets something touch it, or names a
    // title, is refused at that text.
    const before = await settings();
    for (const [messages, path, code] of [
      [
        { new_assignments: { body: { en: "{count} new: {link}" } } },
        "messages.new_assignments.body.en",
        "message_missing_placeholder",
      ],
      [
        { review_reminder: { body: { en: "{count}\n{link}\nChoices: {choices}." } } },
        "messages.review_reminder.body.en",
        "message_link_touched",
      ],
      [
        { reviewer_declined: { body: { en: "{title}\n{link}\n{choices}" } } },
        "messages.reviewer_declined.body.en",
        "message_unknown_placeholder",
      ],
      [
        { reviews_complete: { body: { en: "{reviewer}\n{link}\n{choices}" } } },
        "messages.reviews_complete.body.en",
        "message_unknown_placeholder",
      ],
      [
        { reviews_complete: { subject: { en: "{count}: {choices}" } } },
        "messages.reviews_complete.subject.en",
        "message_not_in_subject",
      ],
    ] as const) {
      // The review of the change names the text and why, and offers no save.
      const reviewed = await send("POST", "/config/preview", messages);
      expect(reviewed.status, path).toBe(200);
      expect(reviewed.json.canSave, path).toBe(false);
      expect(reviewed.json.issues, path).toMatchObject([{ path, code }]);
      // Saved without a review, it is refused all the same.
      const refused = await save(messages);
      expect(refused.status, path).toBe(400);
      expect(refused.json.error, path).toBe("invalid");
    }
    expect((await settings()).token).toBe(before.token);
    expect((await save(undefined)).status).toBe(200);
  });
});

describe("the test outbox", () => {
  it("gives the latest email of one kind, so that a notice is never taken for a sign-in email", async () => {
    const w = await world();
    const r = await reviewer(w);
    const id = await talk(w);
    await inReview(w);
    await chosen(r, w, { assignments: "each" });
    // A sign-in link is asked for, and then a notice reaches the same address.
    const asked = await call(t.public, "POST", "/api/auth/request-link", {
      body: { email: r.email, lang: "en" },
    });
    expect(asked.status).toBe(202);
    await assigned(w, id, r);
    await job(w);
    const latest = (kind?: string) =>
      call(
        t.public,
        "GET",
        `/api/_test/outbox/latest?${kind ? `kind=${kind}&` : ""}to=${encodeURIComponent(r.email)}`,
      );
    expect((await latest()).json.subject).toBe("Test call: proposals assigned to you for review");
    expect((await latest("new_assignments")).json.subject).toBe(
      "Test call: proposals assigned to you for review",
    );
    const signInMail = await latest("magic_link");
    expect(signInMail.json.subject).toBe("Your ELOchair sign-in link");
    expect(signInMail.json.text).toMatch(/#token=[A-Za-z0-9_-]+/);
    expect((await latest("review_reminder")).status).toBe(404);
  });
});

describe('each person\'s choices, on "Your account"', () => {
  let w: World;
  let r: Person;
  let both: Person;
  beforeAll(async () => {
    w = await world();
    r = await reviewer(w);
    both = await reviewer(w, "chairwhoreviews");
    await grantRole(t.db, { conferenceId: w.conferenceId, personId: both.id, role: "chair" });
  });
  const here = (json: { conferences: { conference: { slug: string } }[] }) =>
    json.conferences.find((k) => k.conference.slug === w.slug);

  it("are a summary a day and the reminder until they choose, each shown only for the role it belongs to", async () => {
    const mine = await choices(r);
    expect(mine.status).toBe(200);
    expect(mine.json.conferences).toEqual([
      {
        view: "email_choices",
        conference: { slug: w.slug, title: fixtureCall.title, defaultLanguage: "en" },
        reviewer: { assignments: "daily", reminder: true, reminderDays: 3 },
        chair: null,
      },
    ]);
    expect(here((await choices(w.chair)).json)).toMatchObject({
      reviewer: null,
      chair: { notices: "daily" },
    });
    expect(here((await choices(both)).json)).toMatchObject({
      reviewer: { assignments: "daily", reminder: true },
      chair: { notices: "daily" },
    });
    // Someone with no role anywhere has no choices to make.
    expect((await choices(w.owner)).json).toEqual({ conferences: [] });
    // No row is written by looking.
    expect(
      await t.db
        .select()
        .from(notificationChoices)
        .where(eq(notificationChoices.conferenceId, w.conferenceId)),
    ).toEqual([]);
  });

  it("are saved one at a time or together, and kept; what is left out stays as it was", async () => {
    const first = await choose(both, w, { assignments: "each" });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      conference: { slug: w.slug },
      reviewer: { assignments: "each", reminder: true },
      chair: { notices: "daily" },
    });
    const second = await choose(both, w, { reminder: false, chairNotices: "none" });
    expect(second.json).toMatchObject({
      reviewer: { assignments: "each", reminder: false },
      chair: { notices: "none" },
    });
    expect(here((await choices(both)).json)).toEqual(second.json);
    // One row for the person and the conference, whatever was saved how often.
    expect(
      await t.db
        .select()
        .from(notificationChoices)
        .where(eq(notificationChoices.personId, both.id)),
    ).toMatchObject([{ assignments: "each", reminder: false, chairNotices: "none" }]);
    // Somebody else's are as they were.
    expect(here((await choices(r)).json)).toMatchObject({
      reviewer: { assignments: "daily", reminder: true },
    });
  });

  it("are audited with the values chosen, and nothing else", async () => {
    await chosen(r, w, { assignments: "none", reminder: false });
    const rows = await t.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorPersonId, r.id), like(auditLog.action, "person.email%")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "person.email_choices_changed",
      actorKind: "human",
      conferenceId: w.conferenceId,
      targetType: "person",
      targetId: r.id,
      details: { assignments: "none", reminder: false },
    });
    expect(findLeaks(rows, [r.email, ...typed])).toEqual([]);
  });

  it("refuses a choice that belongs to a role the person does not hold there", async () => {
    expect((await choose(r, w, { chairNotices: "each" })).status).toBe(403);
    expect((await choose(w.chair, w, { assignments: "each" })).status).toBe(403);
    expect((await choose(w.chair, w, { reminder: false })).status).toBe(403);
    // Together with one that is theirs: nothing of it is saved.
    expect((await choose(r, w, { assignments: "each", chairNotices: "each" })).json).toEqual({
      error: "forbidden",
    });
    expect(here((await choices(r)).json)).toMatchObject({
      reviewer: { assignments: "none", reminder: false },
    });
    expect((await choose(w.chair, w, { chairNotices: "each" })).status).toBe(200);
  });

  it("has one answer for a conference where none of these emails is theirs", async () => {
    const elsewhere = await world();
    for (const slug of [elsewhere.slug, "no-such-conference"]) {
      const res = await choose(r, slug, { assignments: "each" });
      expect(res.status, slug).toBe(404);
      expect(res.json).toEqual({ error: "not_found" });
    }
    // The author of a proposal there, and a track chair, hold neither role.
    expect((await choose(w.owner, w, { assignments: "each" })).status).toBe(404);
    // An archived conference: nothing is sent for it any more, and nothing is listed.
    const old = await world();
    const was = await reviewer(old);
    await setConfig(old, () => {}, "archived");
    expect((await choose(was, old, { assignments: "each" })).status).toBe(404);
    expect((await choices(was)).json).toEqual({ conferences: [] });
  });

  it("takes only the three choices, each one of its values", async () => {
    for (const bad of [
      {},
      { assignments: "weekly" },
      { reminder: "no" },
      { chairNotices: null },
      { assignments: "each", personId: r.id },
      { assignments: "each", conferenceId: w.conferenceId },
    ]) {
      expect((await choose(both, w, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("is no agent's to see or to change, whatever its tier, and nobody's who is not signed in", async () => {
    for (const [tier, app] of [
      ["M", t.public],
      ["C", t.internal],
    ] as const) {
      const { token } = await createApiToken(t.db, {
        personId: both.id,
        conferenceId: w.conferenceId,
        tier,
        name: `notify ${tier}`,
      });
      expect((await call(app, "GET", "/api/me/notifications", { token })).status).toBe(401);
      const put = await call(app, "PUT", `/api/me/notifications/${w.slug}`, {
        token,
        body: { assignments: "none" },
      });
      expect(put.status).toBe(403);
      expect(put.json).toEqual({ error: "agents_read_only" });
    }
    expect((await call(t.public, "GET", "/api/me/notifications")).status).toBe(401);
    expect(
      (
        await call(t.public, "PUT", `/api/me/notifications/${w.slug}`, {
          body: { reminder: false },
        })
      ).status,
    ).toBe(401);
    // Nothing changed.
    expect(here((await choices(both)).json)).toMatchObject({ reviewer: { assignments: "each" } });
  });

  it("holds the person's own choices and the conference's name: nothing of anyone else", async () => {
    const others = [r, w.chair, w.owner];
    const mine = await choices(both);
    expect(
      findLeaks(mine.json, [
        ...typed,
        ...others.flatMap((p) => [p.id, p.email]),
        both.id,
        both.email,
        w.conferenceId,
      ]),
    ).toEqual([]);
    const saved = await choose(both, w, { assignments: "daily" });
    expect(
      findLeaks(saved.json, [...typed, ...others.flatMap((p) => [p.id, p.email]), both.id]),
    ).toEqual([]);
  });

  it("is kept when a role goes, and means nothing then", async () => {
    const v = await world();
    const leaving = await reviewer(v);
    await chosen(leaving, v, { assignments: "each", reminder: false });
    await t.db
      .delete(conferenceRoles)
      .where(
        and(
          eq(conferenceRoles.conferenceId, v.conferenceId),
          eq(conferenceRoles.personId, leaving.id),
        ),
      );
    expect((await choices(leaving)).json).toEqual({ conferences: [] });
    expect((await choose(leaving, v, { assignments: "none" })).status).toBe(404);
    // A reviewer again: what they chose is there.
    await grantRole(t.db, {
      conferenceId: v.conferenceId,
      personId: leaving.id,
      role: "reviewer",
      scope: [POOL],
    });
    expect((await choices(leaving)).json.conferences[0]).toMatchObject({
      reviewer: { assignments: "each", reminder: false },
    });
  });
});

/*
 * The in-memory database runs one transaction at a time. Against a real Postgres
 * (TEST_DATABASE_URL, as for reviews.test.ts) two runs of the job really do run at once. Run
 * this file on its own:
 *
 *   docker run --rm -d --name elochair-notify -e POSTGRES_PASSWORD=reviews \
 *     -p 127.0.0.1:55435:5432 postgres:16
 *   TEST_DATABASE_URL=postgres://postgres:reviews@127.0.0.1:55435/postgres \
 *     npx vitest run apps/server/src/notifications.test.ts
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("on Postgres, two runs of the job at once", () => {
  let pg: TestApp;
  let memory: TestApp;
  beforeAll(async () => {
    pg = await makeTestApp({}, { databaseUrl: process.env.TEST_DATABASE_URL });
    pg.deps.limits.writesPerPerson = new RateLimiter(100_000, 60_000);
    pg.deps.limits.linkPerIp = new RateLimiter(100_000, 60_000);
    pg.deps.limits.linkPerEmail = new RateLimiter(100_000, 60_000);
    // The helpers above drive `t`: for this part it is the app on Postgres.
    memory = t;
    t = pg;
    // A call of its own each run: the database may still hold an earlier run's rows.
    run = Date.now();
  }, 240_000);
  afterAll(async () => {
    t = memory;
    await pg?.close();
  });

  it("compose every email once, however many runs there are", async () => {
    for (let round = 0; round < 6; round++) {
      const w = await world();
      const each = await reviewer(w);
      const daily = await reviewer(w);
      const ids = [await talk(w), await talk(w), await talk(w)];
      await closeCall(w);
      await setConfig(w, (c) => {
        c.deadlines.reviewsDue = "2027-02-11T23:59:00-05:00";
      });
      await chosen(each, w, { assignments: "each" });
      await chosen(w.chair, w, { chairNotices: "each" });
      for (const id of ids) await assigned(w, id, each, daily);
      expect((await movePhase(w, "reviewing", "cfp_open")).status).toBe(200);
      expect((await giveBack(daily, ids[2] as string, "time")).status).toBe(204);
      t.setNow(new Date("2027-02-08T13:00:05Z"));
      try {
        await Promise.all(Array.from({ length: 6 }, () => runNotifications(t.deps)));
      } finally {
        t.setNow(NOW);
      }
      const kinds = async (who: Person) => (await mailTo(who)).map((m) => m.kind).sort();
      expect(await kinds(each), `round ${round}`).toEqual([
        "new_assignments",
        "new_assignments",
        "new_assignments",
        "review_reminder",
      ]);
      expect(await kinds(daily), `round ${round}`).toEqual(["new_assignments", "review_reminder"]);
      expect(await kinds(w.chair), `round ${round}`).toEqual(["reviewer_declined"]);
      expect(
        await pg.db
          .select()
          .from(reviewReminders)
          .where(eq(reviewReminders.conferenceId, w.conferenceId)),
      ).toHaveLength(1);
    }
  }, 240_000);
});
