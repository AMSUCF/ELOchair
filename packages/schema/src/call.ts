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

/**
 * Where a conference's call stands for someone who might submit:
 * - "open": people can submit now (isCallOpen).
 * - "upcoming": it has not opened yet. The opening date has not arrived, or the conference is
 *   still a draft whose closing date has not passed.
 * - "closed": the closing date has passed, or the conference is in a later phase.
 */
export type CallState = "open" | "upcoming" | "closed";

/**
 * The state of a conference's call at `now`. It is what the pages say about the call ("Call
 * opening soon", "Submissions closed"); what people may do is decided by isCallOpen and the
 * policy, never by this. A phase that is not one counts as closed. Zod-free.
 */
export function callState(
  config: Pick<ConferenceConfig, "deadlines">,
  phase: string,
  now: Date,
): CallState {
  if (isCallOpen(config, phase, now)) return "open";
  const ahead = phase === "draft" || phase === "cfp_open";
  return ahead && now.getTime() < Date.parse(config.deadlines.submissionsClose)
    ? "upcoming"
    : "closed";
}
