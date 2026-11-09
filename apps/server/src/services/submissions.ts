import {
  actingPerson,
  isConferenceChair,
  isNeverSubmitted,
  type ProjectedSubmission,
  projectSubmission,
  type SubmissionRecord,
  submissionAccess,
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
/** The cursor is not a submission of the conference (400 invalid at path "cursor"). */
export class CursorNotFound extends Error {}

export type QueryResult = {
  items: ProjectedSubmission[];
  total: number;
  /**
   * Submitted work the acting person cannot manage (own or conflicted), whatever the filters;
   * chairs and their agents only.
   */
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
 *
 * Paging is by key: the cursor is the ID of the last item of the previous page, and the next
 * page holds the matching items after that submission in the conference's order (createdAt,
 * id). The cursor is placed in that order among the submissions this viewer can see, so a page
 * continues where the last one ended even if that last item has since stopped matching the
 * filters (withdrawn, say). A cursor that is not a submission this viewer can see throws
 * CursorNotFound, never a silent restart at the first page. Missing and invisible answer alike,
 * so a cursor cannot be used to learn whether someone else's draft exists.
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
  // In the conference's order: loadSubmissionRecords() sorts by (createdAt, id).
  const all = records ?? (await loadSubmissionRecords(db, conference));
  const position = new Map(all.map((r, i) => [r.submission.id, i]));
  const projected = all
    .map((r) => projectSubmission(viewer, r))
    .filter((p): p is ProjectedSubmission => p !== null);
  const after = query.cursor
    ? projected.some((p) => p.id === query.cursor)
      ? position.get(query.cursor)
      : undefined
    : -1;
  if (after === undefined) throw new CursorNotFound("cursor");

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

  // Matches keep the conference's order, so the rest starts at the first one past the cursor.
  const rest = matches.filter((p) => (position.get(p.id) ?? -1) > after);
  const page = rest.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    total: matches.length,
    excludedCount: excludedCount(viewer, conference, all),
    nextCursor: last && page.length < rest.length ? last.id : null,
  };
}

/**
 * How many submitted (never-draft) submissions the acting person cannot manage as a chair: their
 * own and conflicted work. Decided on the acting person, as capReportFor() does, so a chair and
 * their agents (either tier) get the same number. Null for viewers who do not chair.
 */
function excludedCount(
  viewer: Viewer,
  conference: ConferenceRow,
  records: SubmissionRecord[],
): number | null {
  const person = actingPerson(viewer);
  if (!person || !viewerChairs(viewer, conference.id)) return null;
  return records.filter(
    (r) => !isNeverSubmitted(r.submission) && submissionAccess(person, r) !== "chair",
  ).length;
}

/** Page size for queryAllSubmissions(); the largest page SubmissionQuery allows. */
export const ALL_PAGE_SIZE = 500;

/**
 * Every submission matching `filters`, through querySubmissions() page by page until there is no
 * next page, so exports never drop rows past one page. Any cursor or limit in `filters` is ignored.
 */
export async function queryAllSubmissions(
  db: Db,
  viewer: Viewer,
  conference: ConferenceRow,
  filters: SubmissionQuery,
  records?: SubmissionRecord[],
  pageSize = ALL_PAGE_SIZE,
): Promise<Omit<QueryResult, "nextCursor">> {
  const all = records ?? (await loadSubmissionRecords(db, conference));
  const items: ProjectedSubmission[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await querySubmissions(
      db,
      viewer,
      conference,
      { ...filters, cursor, limit: pageSize },
      all,
    );
    items.push(...page.items);
    if (!page.nextCursor || page.items.length === 0) {
      return { items, total: page.total, excludedCount: page.excludedCount };
    }
    cursor = page.nextCursor;
  }
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
