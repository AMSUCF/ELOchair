/**
 * Strings for decisions (English source): the Decision section of a proposal's page as a chair
 * reads it, the chairs' Decisions page with the step that sends them, and what a proposal's
 * authors read once a decision was sent. Spec 03, §1.6. A review pool is a "committee" wherever
 * a person reads it.
 */
export const decisionsEn = {
  manageDecisionsLink: "Decisions",

  /* The Decision section of a proposal's page. */
  decisionTitle: "Decision",
  decisionDoes:
    "Recording a decision here tells nobody. The authors are told when the chairs send the decisions, on the Decisions page. Until then you can change it or take it back.",
  decisionReviews: "Reviews sent: {sent} of {asked}.",
  decisionReviewsBelow: "The reviews themselves are under “Reviewers”, below.",
  /* {list} is made of the three decisionRec_ parts that are not zero: "2 accept, 1 unsure". */
  decisionRecs: "Recommendations: {list}.",
  decisionRecsNone: "No recommendation was given.",
  decisionRec_accept: "{n} accept",
  decisionRec_unsure: "{n} unsure",
  decisionRec_reject: "{n} reject",
  decisionChoose: "Decision for this proposal",
  decisionChoice_accepted: "Accept",
  decisionChoice_waitlisted: "Put on the waiting list",
  decisionChoice_rejected: "Reject",
  decisionRecord: "Record this decision",
  decisionChange: "Change the decision",
  decisionTakeBack: "Take the decision back",
  decisionNone: "No decision is recorded for this proposal.",
  /* {outcome} is one of the three decisionOutcome_ words. */
  decisionRecorded: "Recorded, and not sent yet: {outcome}.",
  decisionOutcome_accepted: "accept",
  decisionOutcome_waitlisted: "waiting list",
  decisionOutcome_rejected: "reject",
  decisionSendWhere: "It is sent with the others, on the Decisions page.",
  /* {deciding} is the name of that phase (phase_deciding). */
  decisionSendLater:
    "It can be sent once the conference is in the phase “{deciding}”, on the Decisions page.",
  /* {status} is what the authors read: status_accepted, status_waitlisted or status_rejected. */
  decisionTold: "The authors were told on {date}: “{status}”.",
  decisionFinal: "That is final here: no other decision can be recorded for this proposal.",
  decisionWaitlistNext:
    "You can record the decision that ends the waiting list, accept or reject. It is sent like the first one.",
  decisionTakes_not_in_review: "No decision can be recorded yet: the conference is not in review.",
  decisionTakes_not_under_consideration:
    "No decision can be recorded: this proposal was withdrawn.",
  decisionWillNotBeSent:
    "The decision that was recorded for it before will not be sent. You can take it back.",
  decisionChooseFirst: "Choose one of the decisions first.",
  decisionSaidRecorded: "Recorded: {outcome}. Nobody was told.",
  decisionSaidTakenBack: "The decision was taken back. Nobody was told.",
  decisionNotNow:
    "Nothing was recorded: this proposal takes no decision now. It is shown here as it is now.",
  decisionGone:
    "Nothing was taken back: no decision was waiting for this proposal any more. It is shown here as it is now.",
  decisionNoAccess:
    "Nothing was changed: only a chair who manages this proposal can record its decision.",
  decisionLoadFailed:
    "The decision for this proposal could not be loaded. Reload the page to try again.",
  decisionToPage: "All decisions",

  /* The Decisions page. */
  decisionsTitle: "Decisions",
  decisionsNoAccess: "Only the chairs of this conference can see its decisions.",
  decisionsIntro:
    "Every proposal that still awaits a decision, under the committee that reviews it. Those with no decision yet come first. To record a decision, open the proposal: its reviews are on the same page. Recording tells nobody. A proposal that was told “accepted” or “not accepted” is no longer listed here: find it on “Manage submissions”, by its status.",
  decisionsNotYet: "No decision can be recorded yet: the conference is not in review.",
  decisionsExcludedOne: "1 proposal is not listed: it is your own, or you have a conflict with it.",
  decisionsExcludedMany:
    "{n} proposals are not listed: they are your own, or you have a conflict with them.",
  decisionsProposalsNone: "No proposal of this committee awaits a decision.",
  decisionsProposalsOne: "1 proposal awaits a decision.",
  decisionsProposalsMany: "{n} proposals await a decision.",
  decisionsUndecidedNone: "None is without a decision.",
  decisionsUndecidedOne: "1 has no decision yet.",
  decisionsUndecidedMany: "{n} have no decision yet.",
  decisionsNoneYet: "No decision yet",
  decisionsRecorded: "Recorded: {outcome}",
  decisionsNotSent: "Not sent yet.",
  decisionsWaitlisted: "On the waiting list",
  decisionsWaitlistedTold: "The authors were told.",
  decisionsReviews: "Reviews sent: {sent} of {asked}",
  decisionsNoReviews: "No review was sent.",

  /* Sending the decisions: its own step, at the top of the Decisions page. */
  sendTitle: "Send the decisions",
  sendDoes:
    "Sending tells the authors. Every decision that is recorded and not sent yet goes out, for the whole conference: the proposal gets its new status, and its owner and confirmed co-authors get an email with the outcome and the reviewers' comments for the authors.",
  sendWaiting:
    "Waiting to be sent: {accepted} accepted, {waitlisted} for the waiting list, {rejected} not accepted.",
  sendNothing: "No decision is waiting to be sent.",
  /* {phase} is the phase the conference is in, {deciding} the name of phase_deciding. */
  sendNotYet:
    "Decisions cannot be sent yet: the conference is in the phase “{phase}”. They can be sent once it is in “{deciding}”, when reviews can no longer be changed.",
  sendOpen: "Send the decisions",
  sendAsk: "Send these decisions?",
  sendWill_accepted: "Proposals that will be told “accepted”: {n}",
  sendWill_waitlisted: "Proposals that will be told “on the waiting list”: {n}",
  sendWill_rejected: "Proposals that will be told “not accepted”: {n}",
  sendWill_people: "People who will be emailed: {n}",
  sendWill_undecided: "Proposals with no decision yet, which will be told nothing: {n}",
  sendWill_dropped:
    "Decisions that will not be sent, because the proposal was withdrawn or returned to draft: {n}",
  sendCounts:
    "These numbers count every decision recorded at the conference, also for proposals you are not shown because they are your own or you have a conflict with them.",
  sendFinal:
    "A sent “accepted” or “not accepted” is final: it cannot be changed here afterwards. A proposal on the waiting list can be given a new decision later.",
  /* {language} is the name of the language the page is read in. */
  sendPreviews:
    "These are the emails, with a made-up title and made-up comments. Each person gets theirs in their own language; this is the {language} text.",
  sendPreview_accepted: "The email for “accepted”",
  sendPreview_waitlisted: "The email for “on the waiting list”",
  sendPreview_rejected: "The email for “not accepted”",
  sendDo: "Yes, send them",
  sendDone:
    "The decisions were sent. Accepted: {accepted}. On the waiting list: {waitlisted}. Not accepted: {rejected}. People emailed: {people}.",
  sendDoneDropped: "Not sent, because the proposal was withdrawn or returned to draft: {n}.",
  sendStale:
    "Nothing was sent: what is waiting is no longer what this confirmation showed. It now shows what is waiting. Read it again, then send.",
  sendStaleNothing:
    "Nothing was sent now: no decision is waiting to be sent any more. The page shows what there is now.",
  sendNotDeciding:
    "Nothing was sent: the conference is not in a phase in which decisions are sent. The page shows it as it is now.",
  sendNoAccess: "Nothing was sent: only the chairs of this conference can send its decisions.",
  sendUnconfirmed:
    "The server did not confirm that the decisions were sent. Reload the page to see what is still waiting before you try again.",

  /* What a proposal's owner and confirmed co-authors read once its decision was sent. */
  authorDecisionTitle: "Decision",
  authorDecision_accepted: "This proposal has been accepted.",
  authorDecision_waitlisted:
    "This proposal is on the waiting list. It is not accepted so far, and it may still be: you will get an email when the chairs decide.",
  authorDecision_rejected: "This proposal was not accepted.",
  authorDecisionSent: "The chairs sent this decision on {date}.",
  authorCommentsTitle: "Comments from the reviewers",
  authorCommentsIntro:
    "The reviewers wrote these comments for the authors. Reviewers are not named.",
  editDecided: "A decision on this proposal was sent: it can no longer be edited.",
} as const;
