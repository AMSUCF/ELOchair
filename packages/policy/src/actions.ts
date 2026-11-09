import type { Contribution, Submission } from "@elochair/schema";
import type { Viewer } from "./viewer";

/*
 * Who may change a submission, and when. Like submissionAccess(), this is the single place the
 * rule lives; routes ask, they do not decide. Agents never change submissions.
 */

export type SubmissionAction =
  /** Change title, abstract, fields, track, topics, language, mode (type only while a draft). */
  | "edit"
  /** Invite, re-role, reorder, resend to or remove co-authors. */
  | "manage_contributors"
  | "submit"
  /** Back to draft (before the close), e.g. to change format or swap a whole panel. */
  | "unsubmit"
  | "withdraw"
  | "delete_draft"
  /**
   * Confirm or decline one's own pending invitation. Declining is possible whatever the status
   * (withdrawn work included); confirming also needs an open call and live work, which the route
   * checks.
   */
  | "answer_invitation"
  /** A confirmed co-author (not the owner) takes themselves off, whatever the status. */
  | "leave";

/**
 * When each action is possible: "open_call" needs isCallOpen(); "withdraw_phases" needs the
 * conference in one of WITHDRAW_PHASES; "always" needs nothing beyond the status rules below.
 * Answering an invitation is "always" so that declining is always possible; confirming
 * additionally needs an open call, which the route checks.
 */
export const ACTION_TIMING: Record<SubmissionAction, "open_call" | "withdraw_phases" | "always"> = {
  edit: "open_call",
  manage_contributors: "open_call",
  submit: "open_call",
  unsubmit: "open_call",
  delete_draft: "open_call",
  withdraw: "withdraw_phases",
  answer_invitation: "always",
  leave: "always",
};

export const WITHDRAW_PHASES = new Set(["cfp_open", "reviewing", "deciding"]);

const EDITABLE = new Set<Submission["status"]>(["draft", "submitted"]);

export function canActOnSubmission(
  viewer: Viewer,
  ctx: {
    submission: Pick<Submission, "status" | "ownerPersonId">;
    contributions: Pick<Contribution, "personId" | "status">[];
  },
  action: SubmissionAction,
): boolean {
  if (viewer.kind !== "person") return false;
  const status = ctx.submission.status;
  const isOwner = ctx.submission.ownerPersonId === viewer.personId;
  const mine = ctx.contributions.find((c) => c.personId === viewer.personId);

  switch (action) {
    case "edit":
    case "manage_contributors":
      return isOwner && EDITABLE.has(status);
    case "submit":
    case "delete_draft":
      return isOwner && status === "draft";
    case "unsubmit":
    case "withdraw":
      return isOwner && status === "submitted";
    // A person must always be able to refuse authorship: no status or phase check here.
    case "answer_invitation":
      return mine?.status === "invited";
    case "leave":
      return !isOwner && mine?.status === "confirmed";
  }
}
