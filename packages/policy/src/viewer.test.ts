import { ConferenceRole } from "@elochair/schema";
import { describe, expect, it } from "vitest";
import { isConferenceChair, type PersonViewer } from "./viewer";

const HERE = "conference-here";
const ELSEWHERE = "conference-elsewhere";

const person = (grants: PersonViewer["grants"] = [], siteAdmin = false): PersonViewer => ({
  kind: "person",
  personId: "someone",
  siteAdmin,
  grants,
});
const granted = (role: ConferenceRole, conferenceId = HERE) =>
  person([{ conferenceId, role, scope: [] }]);

/*
 * The people who run a conference are one group: whatever the server lets an admin do it lets a
 * chair do, the settings and the phase included, because every such check asks this one
 * question. The `admin` role stays in the data and means nothing more than `chair`.
 */
describe("who chairs a conference", () => {
  it("is the same for the chair role, the admin role and a site admin", () => {
    expect(isConferenceChair(granted("chair"), HERE)).toBe(true);
    expect(isConferenceChair(granted("admin"), HERE)).toBe(true);
    expect(isConferenceChair(person([], true), HERE)).toBe(true);
  });

  it("leaves out track chairs, reviewers and people with no role", () => {
    expect(isConferenceChair(granted("track_chair"), HERE)).toBe(false);
    expect(isConferenceChair(granted("reviewer"), HERE)).toBe(false);
    expect(isConferenceChair(person(), HERE)).toBe(false);
  });

  it("counts a role only at the conference it was granted for", () => {
    for (const role of ConferenceRole.options) {
      expect(isConferenceChair(granted(role, ELSEWHERE), HERE), role).toBe(false);
    }
  });

  it("is settled for every role there is", () => {
    // A new role must be put on one side or the other here, on purpose.
    const chairs = ConferenceRole.options.filter((role) => isConferenceChair(granted(role), HERE));
    expect(chairs).toEqual(["admin", "chair"]);
  });
});
