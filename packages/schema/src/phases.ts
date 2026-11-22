/*
 * Conference phases, in order. Zod-free, so that the browser can walk the order too: the
 * schema's `ConferencePhase` (config.ts) is made from this list, and nothing else lists them.
 */

export const CONFERENCE_PHASES = [
  "draft",
  "cfp_open",
  "reviewing",
  "deciding",
  "confirming",
  "scheduling",
  "published",
  "archived",
] as const;

type Phase = (typeof CONFERENCE_PHASES)[number];

const step = (phase: string, by: 1 | -1): Phase | null => {
  const at = (CONFERENCE_PHASES as readonly string[]).indexOf(phase);
  return at < 0 ? null : (CONFERENCE_PHASES[at + by] ?? null);
};

/**
 * The phases in which the owner of a submitted proposal may still withdraw it (spec 02, §1.3).
 * The policy enforces it and the editor shows "Withdraw" by it: one list for both.
 */
export const WITHDRAW_PHASES: readonly Phase[] = ["cfp_open", "reviewing", "deciding"];

/** Whether a submitted proposal can still be withdrawn in this phase. */
export const canWithdrawIn = (phase: string): boolean =>
  (WITHDRAW_PHASES as readonly string[]).includes(phase);

/**
 * Whether reviewers can open the proposals assigned to them in this phase (spec 03, §1.3): from
 * `reviewing` on. Before that an assignment gives nothing yet: chairs assign once the call has
 * closed, and reviewers read once the chairs move the conference into review. A phase that is
 * not one is not a phase of review.
 */
export const reviewersCanRead = (phase: string): boolean => {
  const at = (CONFERENCE_PHASES as readonly string[]).indexOf(phase);
  return at >= CONFERENCE_PHASES.indexOf("reviewing");
};

/** The phase that follows `phase`; null after the last one, and for a phase that is not one. */
export const nextPhase = (phase: string): Phase | null => step(phase, 1);

/** The phase before `phase`; null before the first one, and for a phase that is not one. */
export const previousPhase = (phase: string): Phase | null => step(phase, -1);
