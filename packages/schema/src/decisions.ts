/*
 * Decisions (spec 03, §1.6): what a chair records for a proposal, and what its authors are told
 * once the chairs send the decisions. Zod-free, so that the pages name the same outcomes the
 * server takes.
 *
 * An outcome is written as the status it gives a proposal when it is sent: nothing has to turn
 * one into the other. Until it is sent a decision is kept apart from the proposal, whose status
 * is what its owner and co-authors see: recording one changes nothing they can read.
 */

/** What a chair can decide: the three statuses a sent decision gives a proposal. */
export const DECISION_OUTCOMES = ["accepted", "waitlisted", "rejected"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

/**
 * The outcomes that can be recorded for a proposal in this status. One that is under
 * consideration (`submitted`) takes any of the three. One on the waiting list takes the two
 * that end it: that is what a waiting list is for. Any other status takes none: a draft and a
 * withdrawn proposal are not decided, and a sent accept or reject is final in the app.
 */
export function decisionOutcomesFor(status: string): readonly DecisionOutcome[] {
  if (status === "submitted") return DECISION_OUTCOMES;
  if (status === "waitlisted") return ["accepted", "rejected"];
  return [];
}
