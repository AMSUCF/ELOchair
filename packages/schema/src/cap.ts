import type { ConferenceConfig } from "./config";
import type { Contribution, Submission, SubmissionStatus } from "./domain";

export type CapCount = { personId: string; count: number; submissionIds: string[] };

export type CapReport = {
  max: number | null;
  counts: CapCount[];
  over: CapCount[];
  /** Counted roles still awaiting the invitee's confirmation: never counted toward anyone. */
  pendingCount: number;
};

/**
 * Who holds how many capped roles (e.g. lead or presenter) across submission types that count
 * toward the cap. Pass the statuses to consider: ["submitted"] to warn at submission time,
 * ["accepted", "confirmed", "published"] when finalizing decisions.
 */
export function presenterCapReport(
  config: ConferenceConfig,
  submissions: Pick<Submission, "id" | "typeKey" | "status">[],
  contributions: Pick<Contribution, "submissionId" | "personId" | "role" | "status">[],
  statuses: readonly SubmissionStatus[],
): CapReport {
  const rule = config.rules.presenterCap;
  if (!rule) return { max: null, counts: [], over: [], pendingCount: 0 };

  const counted = new Set(
    config.submissionTypes.filter((t) => t.countsTowardPresenterCap).map((t) => t.key),
  );
  const eligible = new Set(
    submissions
      .filter((s) => counted.has(s.typeKey) && statuses.includes(s.status))
      .map((s) => s.id),
  );
  const roles = new Set<string>(rule.countedRoles);

  const byPerson = new Map<string, Set<string>>();
  let pendingCount = 0;
  for (const c of contributions) {
    if (!eligible.has(c.submissionId) || !roles.has(c.role)) continue;
    // Only people who confirmed count: nobody can push someone else over the cap.
    if (c.status === "invited") pendingCount++;
    if (c.status !== "confirmed") continue;
    const ids = byPerson.get(c.personId) ?? new Set<string>();
    ids.add(c.submissionId);
    byPerson.set(c.personId, ids);
  }

  const counts = [...byPerson]
    .map(([personId, ids]) => ({ personId, count: ids.size, submissionIds: [...ids].sort() }))
    .sort((a, b) => b.count - a.count || a.personId.localeCompare(b.personId));
  return { max: rule.max, counts, over: counts.filter((c) => c.count > rule.max), pendingCount };
}
