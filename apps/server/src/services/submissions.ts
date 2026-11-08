import {
  actingPerson,
  isConferenceChair,
  type ProjectedSubmission,
  projectSubmission,
  type SubmissionRecord,
  type Viewer,
} from "@elochair/policy";
import { presenterCapReport, type SubmissionQuery, type SubmissionStatus } from "@elochair/schema";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { submissions } from "../db/schema";
import { type ConferenceRow, loadSubmissionRecords } from "../repo";

/** Statuses that count as "submitted work" for the presenter cap. */
export const COUNTED_STATUSES: SubmissionStatus[] = [
  "submitted",
  "accepted",
  "confirmed",
  "published",
];

/**
 * How many counted roles a person holds across submitted work, counting `current` as submitted
 * and their own pending invitation on it as confirmed (so the warning shows before it is too
 * late). Only ever reported to that person.
 */
export function ownCapCount(
  records: SubmissionRecord[],
  personId: string,
  currentId: string | null,
): number | null {
  const config = records[0]?.config;
  if (!config?.rules.presenterCap) return null;
  const subs = records.map((r) =>
    r.submission.id === currentId
      ? { ...r.submission, status: "submitted" as const }
      : r.submission,
  );
  const contribs = records.flatMap((r) =>
    r.contributions.map((c) =>
      r.submission.id === currentId && c.personId === personId && c.status === "invited"
        ? { ...c, status: "confirmed" as const }
        : c,
    ),
  );
  const report = presenterCapReport(config, subs, contribs, COUNTED_STATUSES);
  return report.counts.find((c) => c.personId === personId)?.count ?? 0;
}

export class QueryNotAllowed extends Error {}

export type QueryResult = {
  items: ProjectedSubmission[];
  total: number;
  /** Submissions the acting person cannot manage (own or conflicted); chairs only. */
  excludedCount: number | null;
  nextCursor: string | null;
};

/** The viewer manages this conference (chair, track chair or admin), or is their agent. */
export function viewerChairs(viewer: Viewer, conferenceId: string): boolean {
  if (viewer.kind === "agent" && viewer.conferenceId !== conferenceId) return false;
  const p = actingPerson(viewer);
  if (!p) return false;
  return (
    isConferenceChair(p, conferenceId) ||
    p.grants.some((g) => g.conferenceId === conferenceId && g.role === "track_chair")
  );
}

/**
 * The one query behind the REST list, the CSV exports and the MCP tools. It projects first and
 * filters only on projected fields, so a filter can never reveal what the projection hides.
 */
export async function querySubmissions(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  query: SubmissionQuery,
  records?: SubmissionRecord[],
): Promise<QueryResult> {
  if (query.q && viewer.kind === "agent" && viewer.tier === "M") {
    throw new QueryNotAllowed("q_not_allowed");
  }
  const all = records ?? (await loadSubmissionRecords(db, conference));
  const projected = all
    .map((r) => projectSubmission(viewer, r))
    .filter((p): p is ProjectedSubmission => p !== null);

  const q = query.q?.toLocaleLowerCase();
  const matches = projected.filter((p) => {
    const status = "status" in p ? p.status : undefined;
    if (query.status && (!status || !(query.status as string[]).includes(status))) return false;
    if (query.type && p.typeKey !== query.type) return false;
    if (query.track && p.trackKey !== query.track) return false;
    if (query.language && p.language !== query.language) return false;
    if (query.participationMode) {
      if (!("participationMode" in p) || p.participationMode !== query.participationMode)
        return false;
    }
    if (query.hasSelfIdWarnings !== undefined) {
      if (!("selfIdWarningCount" in p)) return false;
      if (p.selfIdWarningCount > 0 !== query.hasSelfIdWarnings) return false;
    }
    if (query.hasPendingInvitations !== undefined) {
      const contributors = "contributors" in p ? (p.contributors ?? []) : [];
      const pending = contributors.some((c) => "status" in c && c.status === "invited");
      if (pending !== query.hasPendingInvitations) return false;
    }
    if (query.incomplete !== undefined) {
      if (!("issueCodes" in p)) return false;
      const incomplete = status === "submitted" && p.issueCodes.length > 0;
      if (incomplete !== query.incomplete) return false;
    }
    if (q && !("title" in p && p.title.toLocaleLowerCase().includes(q))) return false;
    return true;
  });

  const start = query.cursor ? matches.findIndex((p) => p.id === query.cursor) + 1 : 0;
  const page = matches.slice(start, start + query.limit);
  const last = page.at(-1);
  const chairs = viewerChairs(viewer, conference.id);
  const manageable = projected.filter((p) => p.view === "chair" || p.view === "metadata").length;
  const nonDraft = all.filter(
    (r) => r.submission.status !== "draft" && r.submission.submittedAt,
  ).length;
  return {
    items: page,
    total: matches.length,
    excludedCount: chairs ? Math.max(0, nonDraft - manageable) : null,
    nextCursor: last && start + page.length < matches.length ? last.id : null,
  };
}

/** Bump the version (optimistic concurrency) and touch updatedAt. */
export async function bumpVersion(db: Db, submissionId: string, now: Date): Promise<void> {
  const [row] = await db
    .select({ version: submissions.version })
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  await db
    .update(submissions)
    .set({ version: (row?.version ?? 0) + 1, updatedAt: now })
    .where(eq(submissions.id, submissionId));
}
