import { ConferenceConfig, conferences, statedDeadline } from "@elochair/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureCall, seedOpenCall, seedTestCall } from "./fixtures";
import { getConference, saveConference } from "./repo";
import { call, makeTestApp, type TestApp } from "./testkit";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

describe("the fixture call", () => {
  it("is a valid configuration with the formats and limits the tests rely on", () => {
    const c = ConferenceConfig.parse(fixtureCall);
    const type = (key: string) => c.submissionTypes.find((x) => x.key === key);
    expect(c.submissionTypes.map((x) => x.key)).toEqual([
      "panel",
      "talk",
      "workshop",
      "performance",
      "exhibition",
      "experimental",
    ]);
    expect(type("talk")?.abstract).toMatchObject({ minWords: 250, maxWords: 300 });
    expect(type("talk")?.team).toEqual({ min: 1, max: 4 });
    expect(type("panel")?.team).toEqual({ min: 3, max: 6 });
    expect(type("panel")?.countsTowardPresenterCap).toBe(false);
    expect(type("workshop")?.fields.map((f) => f.key)).toEqual(["needs"]);
    expect(c.languages).toEqual(["en", "es", "pt"]);
    expect(c.rules.presenterCap?.max).toBe(2);
    expect(c.agreements.map((a) => a.key)).toEqual(["privacy", "code_of_conduct", "recordings"]);
  });

  it("is fictional and separate from any real conference", () => {
    expect(fixtureCall.slug).toBe("test-call");
    expect(fixtureCall.contactEmail).toMatch(/@example\.org$/);
    expect(fixtureCall.website).toBeUndefined();
    expect(Object.keys(conferences)).not.toContain(fixtureCall.slug);
    // Nowhere in it: the real organisation, its conferences, their hosts or their sites.
    // ("Electronic literature" alone is the art form, which the formats do mention.)
    const all = JSON.stringify(fixtureCall);
    expect(all.match(/\bELO\b|\belo20\d\d\b/g)).toBeNull();
    expect(
      all.match(
        /literature organi[sz]ation|eliterature|uninorte|universidad del norte|barranquilla/gi,
      ),
    ).toBeNull();
    // Every link and address is in a domain reserved for examples.
    const hosts = [...all.matchAll(/https?:\/\/([^/"\s]+)|[\w.+-]+@([\w.-]+)/g)].map(
      (m) => m[1] ?? m[2] ?? "",
    );
    expect(hosts).toEqual(["example.org", "example.org"]);
  });

  it("opens as test-call for tests, while development gets ELO 2027's own formats", async () => {
    const now = new Date("2027-02-01T12:00:00Z");
    const test = await seedTestCall(t.db, { now });
    const dev = await seedOpenCall(t.db, { now });
    expect(test.slug).toBe("test-call");
    expect(dev.slug).toBe("elo2027-open");
    const [testCall, devCall] = await Promise.all([
      getConference(t.db, test.slug),
      getConference(t.db, dev.slug),
    ]);
    expect(testCall?.phase).toBe("cfp_open");
    expect(testCall?.config.submissionTypes.map((x) => x.key)).toEqual(
      fixtureCall.submissionTypes.map((x) => x.key),
    );
    expect(devCall?.config.submissionTypes.map((x) => x.key)).toEqual(
      conferences.elo2027.submissionTypes.map((x) => x.key),
    );
    expect(devCall?.config.title.en).toBe("ELO 2027 (open test call)");
    // Both follow the clock they were given, not the conference's real dates.
    expect(new Date(devCall?.config.deadlines.submissionsClose ?? 0).getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });
});

const DAY = 24 * 60 * 60 * 1000;

describe("a seeded call's deadlines", () => {
  it("are the same instants as ever, each written on the clock its configuration writes it on", async () => {
    const now = new Date("2027-02-01T12:00:00Z");
    const { slug } = await seedTestCall(t.db, { slug: "stated-call", now });
    const config = (await getConference(t.db, slug))?.config;
    if (!config) throw new Error("the call was seeded");
    const seeded = config.deadlines;
    // Opened yesterday, closing in thirty days, then sixty and ninety.
    expect(
      [
        seeded.submissionsOpen,
        seeded.submissionsClose,
        seeded.notification,
        seeded.finalMaterials,
      ].map((iso) => (Date.parse(iso) - now.getTime()) / DAY),
    ).toEqual([-1, 30, 60, 90]);
    // The fixture call closes anywhere on Earth and writes its other dates in Bogotá's offset:
    // so does a call seeded from it, and the pages state each deadline on that clock.
    expect(seeded).toEqual({
      submissionsOpen: "2027-01-31T07:00:00.000-05:00",
      submissionsClose: "2027-03-03T00:00:00.000-12:00",
      notification: "2027-04-02T07:00:00.000-05:00",
      finalMaterials: "2027-05-02T07:00:00.000-05:00",
    });
    const clock = (iso: string) => statedDeadline(iso, config.timezone).clock;
    expect(clock(seeded.submissionsClose)).toBe("aoe");
    expect(clock(seeded.submissionsOpen)).toBe("conference");
    expect(clock(seeded.notification)).toBe("conference");
    expect(clock(seeded.finalMaterials)).toBe("conference");
  });
});

describe("where a call stands, by the server's clock", () => {
  it("tells the list and the conference's page the same: yet to open, open, closed", async () => {
    const opened = new Date("2027-02-01T12:00:00Z");
    const { slug } = await seedTestCall(t.db, { slug: "standing-call", now: opened });
    const standing = async (at: Date) => {
      t.setNow(at);
      const list = await call(t.public, "GET", "/api/conferences");
      const listed = list.json.conferences.find((k: { slug: string }) => k.slug === slug);
      const page = (await call(t.public, "GET", `/api/conferences/${slug}`)).json;
      expect([page.callState, page.callOpen]).toEqual([listed.callState, listed.callOpen]);
      return [listed.callState, listed.callOpen];
    };
    try {
      // It opened a day before `opened` and closes thirty days after it.
      expect(await standing(new Date(opened.getTime() - 2 * DAY))).toEqual(["upcoming", false]);
      expect(await standing(opened)).toEqual(["open", true]);
      expect(await standing(new Date(opened.getTime() + 30 * DAY - 1))).toEqual(["open", true]);
      expect(await standing(new Date(opened.getTime() + 30 * DAY))).toEqual(["closed", false]);
      // Once the conference has moved on, its call is closed whatever the dates say.
      const k = await getConference(t.db, slug);
      if (!k) throw new Error("the call was seeded");
      await saveConference(t.db, k.config, "reviewing");
      expect(await standing(opened)).toEqual(["closed", false]);
    } finally {
      t.setNow(new Date("2027-02-01T12:00:00Z"));
    }
  });
});
