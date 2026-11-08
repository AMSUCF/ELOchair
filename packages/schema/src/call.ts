import type { ConferenceConfig } from "./config";

/**
 * Whether people can create, edit, submit and withdraw submissions right now: the conference
 * is in phase "cfp_open" and `now` is inside [submissionsOpen, submissionsClose). Zod-free.
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
