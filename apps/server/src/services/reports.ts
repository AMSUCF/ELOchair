import {
  actingPerson,
  type PersonViewer,
  type SubmissionRecord,
  selfIdFindings,
  submissionAccess,
  submissionIssues,
  type Viewer,
} from "@elochair/policy";
import { presenterCapReport, type RoleGrant, type SubmissionStatus } from "@elochair/schema";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { conferenceRoles, people } from "../db/schema";
import type { ConferenceRow } from "../repo";

/**
 * The presenter-cap report for chairs: confirmed roles only, over the submissions the acting
 * person may manage as a chair (their own and conflicted work left out), plus how many counted
 * roles are still awaiting confirmation. Person IDs and counts only.
 */
export function capReportFor(
  viewer: Viewer,
  conference: ConferenceRow,
  records: SubmissionRecord[],
  statuses: readonly SubmissionStatus[],
) {
  const person = actingPerson(viewer);
  const manageable = records.filter(
    (r) => person !== null && submissionAccess(person, r) === "chair",
  );
  return presenterCapReport(
    conference.config,
    manageable.map((r) => r.submission),
    manageable.flatMap((r) => r.contributions),
    statuses,
  );
}

/** Everyone who chairs this conference (site admins, admins, chairs, track chairs). */
export async function chairsOf(db: Db, conferenceId: string): Promise<PersonViewer[]> {
  const grants = await db
    .select()
    .from(conferenceRoles)
    .where(eq(conferenceRoles.conferenceId, conferenceId));
  const admins = await db.select({ id: people.id }).from(people).where(eq(people.siteAdmin, true));
  const ids = [
    ...new Set([
      ...grants.filter((g) => g.role !== "reviewer").map((g) => g.personId),
      ...admins.map((a) => a.id),
    ]),
  ];
  if (!ids.length) return [];
  const flags = await db
    .select({ id: people.id, siteAdmin: people.siteAdmin })
    .from(people)
    .where(inArray(people.id, ids));
  const isAdmin = new Map(flags.map((f) => [f.id, f.siteAdmin]));
  return ids.map((personId) => ({
    kind: "person" as const,
    personId,
    siteAdmin: isAdmin.get(personId) ?? false,
    grants: grants
      .filter((g) => g.personId === personId)
      .map((g) => ({
        conferenceId: g.conferenceId,
        role: g.role as RoleGrant["role"],
        scope: g.scope,
      })),
  }));
}

const tally = (values: (string | null)[]) => {
  const out: Record<string, number> = {};
  for (const v of values) out[v ?? "none"] = (out[v ?? "none"] ?? 0) + 1;
  return out;
};

/**
 * Aggregates for a live call. Counts cover every submitted proposal (own and conflicted work
 * included: a count reveals nothing), and drafts appear only as one number.
 */
export function conferenceOverview(
  conference: ConferenceRow,
  records: SubmissionRecord[],
  chairs: PersonViewer[],
) {
  const config = conference.config;
  const drafts = records.filter(
    (r) => r.submission.status === "draft" || r.submission.submittedAt === null,
  );
  const real = records.filter((r) => !drafts.includes(r));
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const submittedByDay: Record<string, number> = {};
  for (const r of real) {
    if (!r.submission.submittedAt) continue;
    const d = day.format(new Date(r.submission.submittedAt));
    submittedByDay[d] = (submittedByDay[d] ?? 0) + 1;
  }
  const submitted = real.filter((r) => r.submission.status === "submitted");
  return {
    slug: conference.slug,
    phase: conference.phase,
    deadlines: config.deadlines,
    formats: config.submissionTypes.map((t) => t.key),
    tracks: config.tracks.map((t) => t.key),
    total: real.length,
    draftCount: drafts.length,
    byStatus: tally(real.map((r) => r.submission.status)),
    byType: tally(real.map((r) => r.submission.typeKey)),
    byTrack: tally(real.map((r) => r.submission.trackKey)),
    byLanguage: tally(real.map((r) => r.submission.language)),
    byParticipationMode: tally(real.map((r) => r.submission.participationMode)),
    submittedByDay,
    withSelfIdWarnings: real.filter(
      (r) => selfIdFindings(config, r.submission, r.contributions, r.people).length > 0,
    ).length,
    withPendingInvitations: real.filter((r) => r.contributions.some((c) => c.status === "invited"))
      .length,
    incomplete: submitted.filter(
      (r) => submissionIssues(config, r.submission, r.contributions, r.people).length > 0,
    ).length,
    withoutAvailableChair: real.filter(
      (r) => !chairs.some((p) => submissionAccess(p, r) === "chair"),
    ).length,
  };
}
