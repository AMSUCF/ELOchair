import { ConferenceConfig, conferences } from "@elochair/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixtureCall, seedOpenCall, seedTestCall } from "./fixtures";
import { getConference } from "./repo";
import { makeTestApp, type TestApp } from "./testkit";

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
