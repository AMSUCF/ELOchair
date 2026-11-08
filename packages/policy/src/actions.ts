import type { Contribution, Submission } from "@elochair/schema";
import type { Viewer } from "./viewer";

/*
 * Who may change a submission. Like submissionAccess(), this is the single place the rule
 * lives; routes ask, they do not decide. Agents never change submissions.
 * Whether the call is open (phase and deadlines) is checked separately: see isCallOpen().
 */

export type SubmissionAction =
  /** Change title, abstract, fields, track, topics, language (and type while a draft). */
  | "edit"
  /** Invite, re-role, reorder or remove co-authors. */
  | "manage_contributors"
  | "submit"
  | "withdraw"
  /** Confirm or decline one's own pending invitation. */
  | "answer_invitation";

const EDITABLE = new Set<Submission["status"]>(["draft", "submitted"]);

function ownContribution(viewer: Viewer, contributions: Contribution[]): Contribution | undefined {
  if (viewer.kind !== "person") return undefined;
  return contributions.find((c) => c.personId === viewer.personId);
}

export function canActOnSubmission(
  viewer: Viewer,
  ctx: { submission: Pick<Submission, "status">; contributions: Contribution[] },
  action: SubmissionAction,
): boolean {
  const mine = ownContribution(viewer, ctx.contributions);
  if (!mine) return false;
  const status = ctx.submission.status;
  if (action === "answer_invitation") return mine.status === "invited" && EDITABLE.has(status);

  const isLead = mine.role === "lead" && mine.status === "confirmed";
  if (!isLead) return false;
  switch (action) {
    case "edit":
    case "manage_contributors":
    case "withdraw":
      return EDITABLE.has(status);
    case "submit":
      return status === "draft";
  }
}
