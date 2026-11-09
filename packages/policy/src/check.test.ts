/**
 * Time taken by the whole submission check (rules, self-identification, presenter cap, bios) on
 * a long abstract with many contributors. The server runs it on every /check and submit, and
 * the same self-identification code on every chair list, CSV export and MCP call.
 */
import {
  ConferenceConfig as ConfigSchema,
  type Contribution,
  conferences,
  effectiveBlindMode,
  type Person,
  type Submission,
} from "@elochair/schema";
import { describe, expect, it } from "vitest";
import { projectCheck, type SubmissionRecord } from "./projections";
import type { PersonViewer } from "./viewer";

/** Fictional people (house rule 10). */
const NAMES = [
  "Ana Lucía Pérez Gómez",
  "João Carlos Gonçalves da Silva",
  "María José Rodríguez Vera",
  "Søren Østergaard",
  "Juan de la Cruz Ramírez",
  "Ana Paula dos Santos Lima",
  "Luis Alberto Mar Fuentes",
  "Sofía Paz Herrera",
  "Carlos Eduardo León Castillo",
  "Beatriz Rosa Navarro",
];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/**
 * 5,000 words of prose (deterministic, mulberry32): ordinary words, everyone's surnames,
 * other people's citations, the authors' own citations, and every 500 words a run of 3,000
 * spaces or line breaks after a surname, as text pasted from a PDF or a table leaves.
 */
function longAbstract(): string {
  let seed = 7;
  const next = (n: number) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const surnames = NAMES.flatMap((n) => n.split(" ").slice(1)).concat(["Smith", "Jones"]);
  const words = ["la", "poesía", "digital", "y", "the", "hypertext", "of", "obra", "e", "and"];
  const out: string[] = [];
  for (let i = 0; i < 5_000; i++) {
    const r = next(12);
    out.push(
      r === 0
        ? (surnames[next(surnames.length)] as string)
        : r === 1
          ? `(${1990 + next(36)})`
          : (words[next(words.length)] as string),
    );
    if (i % 500 === 250) out.push(`Pérez${(next(2) ? " " : "\n").repeat(3_000)}`);
  }
  return out.join(" ");
}

describe("the submission check on long text", () => {
  it("takes well under a quarter of a second for 5,000 words and 10 contributors", () => {
    const config = ConfigSchema.parse(conferences.elo2027);
    const type = config.submissionTypes.find((t) => effectiveBlindMode(config, t.key) === "double");
    expect(type).toBeDefined();
    const people = new Map<string, Person>();
    const contributions: Contribution[] = NAMES.map((displayName, i) => {
      people.set(id(i), {
        id: id(i),
        email: `persona${i}@ficticia${i}.example`,
        displayName,
        orcid: null,
        affiliation: `Universidad Ficticia ${i}`,
        country: "CO",
        languages: ["es"],
        bios: { es: "Escribe poesía digital. ".repeat(40) },
        pronouns: null,
      });
      return {
        submissionId: id(100),
        personId: id(i),
        role: i === 0 ? "lead" : "coauthor",
        position: i,
        status: i % 3 === 2 ? "invited" : "confirmed",
        invitedEmail: i === 0 ? null : `invitada${i}@ficticia${i}.example`,
        invitedName: i === 0 ? null : displayName,
        invitedAffiliation: null,
      };
    });
    const abstract = longAbstract();
    const fields: Submission["fields"] = {};
    for (const f of type?.fields ?? []) {
      if (f.kind !== "url") fields[f.key] = abstract.slice(0, 5_000);
    }
    const now = "2027-02-01T12:00:00Z";
    const rec: SubmissionRecord = {
      config,
      submission: {
        id: id(100),
        conferenceId: id(101),
        ownerPersonId: id(0),
        version: 1,
        typeKey: type?.key ?? "",
        trackKey: null,
        topicKeys: [],
        language: "es",
        title: "Pérez y Gómez (2020) revisitado",
        abstract,
        fields,
        participationMode: "in_person",
        status: "draft",
        createdAt: now,
        updatedAt: now,
        submittedAt: null,
      },
      contributions,
      assignments: [],
      conflicts: [],
      people,
    };
    const owner: PersonViewer = { kind: "person", personId: id(0), siteAdmin: false, grants: [] };
    expect(abstract.split(/\s+/).length).toBeGreaterThanOrEqual(5_000);

    projectCheck(owner, { ...rec, submission: { ...rec.submission, abstract: "corto" } }, 0);
    const t0 = performance.now();
    const check = projectCheck(owner, rec, 0);
    const ms = performance.now() - t0;
    expect(check?.selfIdentification.length).toBeGreaterThan(0);
    // A few tens of milliseconds here; before the second review's fix it took about 700 ms.
    expect(ms).toBeLessThan(250);
  });
});
