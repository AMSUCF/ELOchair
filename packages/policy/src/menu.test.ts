import type { Person } from "@elochair/schema";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectMenu } from "./projections";
import { findLeaks } from "./testing";
import type { AgentViewer, PersonViewer, Viewer } from "./viewer";

/*
 * What the frame of every page is told about whoever is looking: their own name and address,
 * and which of their own pages the menu offers. It is asked by everyone on every page, signed
 * in or not, so it must hold nothing of anybody else.
 */

const person = (id: string, change: Partial<Person> = {}): Person => ({
  id,
  email: `${id}@example.org`,
  displayName: `Name of ${id}`,
  affiliation: null,
  country: null,
  languages: [],
  pronouns: null,
  orcid: null,
  bios: {},
  ...change,
});
const signedIn = (personId: string, grants: PersonViewer["grants"] = []): PersonViewer => ({
  kind: "person",
  personId,
  siteAdmin: false,
  grants,
});
const NOBODY = { view: "menu", account: null, submissions: false, reviews: false };

describe("what the frame is told about whoever is looking", () => {
  it("is a person's own name and address, and which of their pages the menu offers", () => {
    const ana = person("ana");
    expect(projectMenu(signedIn("ana"), ana, { submissions: false })).toEqual({
      view: "menu",
      account: { name: "Name of ana", email: "ana@example.org" },
      submissions: false,
      reviews: false,
    });
    expect(projectMenu(signedIn("ana"), ana, { submissions: true }).submissions).toBe(true);
    // Someone who has not said what they are called yet is known by their address.
    expect(
      projectMenu(signedIn("ana"), person("ana", { displayName: null }), { submissions: false })
        .account,
    ).toEqual({ name: null, email: "ana@example.org" });
  });

  it("offers the reviews to someone who reviews somewhere, whatever else they are", () => {
    const menu = (grants: PersonViewer["grants"]) =>
      projectMenu(signedIn("ana", grants), person("ana"), { submissions: false });
    expect(menu([{ conferenceId: "k", role: "reviewer", scope: ["pool"] }]).reviews).toBe(true);
    expect(
      menu([
        { conferenceId: "k", role: "chair", scope: [] },
        { conferenceId: "j", role: "reviewer", scope: ["pool"] },
      ]).reviews,
    ).toBe(true);
    expect(menu([{ conferenceId: "k", role: "chair", scope: [] }]).reviews).toBe(false);
    expect(menu([{ conferenceId: "k", role: "track_chair", scope: ["t"] }]).reviews).toBe(false);
  });

  it("tells the public and an agent that nobody is signed in, and nothing else", () => {
    const owner = signedIn("ana", [{ conferenceId: "k", role: "reviewer", scope: ["pool"] }]);
    const agent: AgentViewer = {
      kind: "agent",
      tokenId: "token",
      tier: "M",
      conferenceId: "k",
      owner,
    };
    for (const viewer of [{ kind: "public" }, agent] as Viewer[]) {
      expect(projectMenu(viewer, person("ana"), { submissions: true })).toEqual(NOBODY);
      expect(projectMenu(viewer, null, { submissions: true })).toEqual(NOBODY);
    }
    // A person whose record is gone has no account to show.
    expect(projectMenu(owner, null, { submissions: true })).toEqual(NOBODY);
  });

  it("never holds anything of another person, whoever's record it is handed", () => {
    const marker = fc.stringMatching(/^[a-z0-9]{6,12}$/).map((s) => `MARK-${s}-KRAM`);
    fc.assert(
      fc.property(marker, marker, marker, fc.boolean(), (name, mail, more, submissions) => {
        const other = person("bruno", {
          displayName: name,
          email: `${mail}@example.org`,
          affiliation: more,
          bios: { en: more },
        });
        const told = projectMenu(signedIn("ana"), other, { submissions });
        expect(told).toEqual(NOBODY);
        expect(findLeaks(told, [name, mail, more])).toEqual([]);
        // And of their own record it holds the name and the address, never the rest.
        const own = projectMenu(
          signedIn("ana"),
          person("ana", { affiliation: more, bios: { en: more }, pronouns: more, orcid: more }),
          { submissions },
        );
        expect(findLeaks(own, [more])).toEqual([]);
      }),
    );
  });
});
