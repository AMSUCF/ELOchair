import type { ConferenceConfig } from "./config";

/**
 * Whether people can create, edit and submit submissions, and confirm invitations, right now:
 * the conference is in phase "cfp_open" and `now` is inside [submissionsOpen, submissionsClose).
 * Withdrawing does not depend on it: it follows the phase alone (WITHDRAW_PHASES in
 * packages/policy), and declining an invitation or leaving a proposal is always possible.
 * Zod-free.
 */
export function isCallOpen(
  config: Pick<ConferenceConfig, "deadlines">,
  phase: string,
  now: Date,
): boolean {
  const t = now.getTime();
  return (
    phase === "cfp_open" &&
    t >= Date.parse(config.deadlines.submissionsOpen) &&
    t < Date.parse(config.deadlines.submissionsClose)
  );
}
