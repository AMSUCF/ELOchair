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

/** The phase that follows `phase`; null after the last one, and for a phase that is not one. */
export const nextPhase = (phase: string): Phase | null => step(phase, 1);

/** The phase before `phase`; null before the first one, and for a phase that is not one. */
export const previousPhase = (phase: string): Phase | null => step(phase, -1);
