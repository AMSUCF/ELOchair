/**
 * Strings for assigning reviewers (English source): the Reviewers section of a proposal's page
 * as a chair reads it, and the chairs' Assignments page. Spec 03, §1.3. A review pool is a
 * "committee" wherever a person reads it.
 */
export const assignmentsEn = {
  manageAssignmentsLink: "Assignments",

  /* The Reviewers section of a proposal's page. */
  reviewersTitle: "Reviewers",
  /*
   * What assigning does, in one sentence: {how} is one of the three reviewersHow_ phrases, by
   * how the proposal's format is reviewed. The second sentence is reviewersNoMail.
   */
  reviewersDoes_before:
    "A reviewer you assign here will be able to read this proposal once the conference is in review, {how}.",
  reviewersDoes_now: "A reviewer you assign here can read this proposal from then on, {how}.",
  reviewersHow_double: "anonymized: without the authors' names",
  reviewersHow_single: "with the authors' names and affiliations",
  reviewersHow_open: "with the authors' names, affiliations and bios",
  reviewersNoMail: "Nobody is emailed when you assign or remove a reviewer.",
  reviewersReviewsIntro:
    "A review appears here once its reviewer has sent it, with who wrote it. The authors are never told who reviewed.",
  reviewersCount: "Reviewers assigned: {n} of {needed}.",
  reviewersAsksOne: "Committee: {committee}. It asks for 1 reviewer for each proposal.",
  reviewersAsksMany: "Committee: {committee}. It asks for {needed} reviewers for each proposal.",
  reviewersNone: "No reviewer is assigned to this proposal.",
  reviewersAssignedOn: "Assigned {date}",
  reviewersRemove: "Remove from this proposal",
  reviewersRemoveFor: "Remove from this proposal: {name}",
  reviewersAskRemove: "Remove {name} from this proposal?",
  reviewersRemoveDoes:
    "{name} will no longer be able to read this proposal, and it will no longer count as one of theirs. They are not told by email.",
  reviewersRemoveAgain: "You can assign them again later.",
  reviewersRemoveDraft: "If they have begun a review and not sent it, that draft is discarded.",
  reviewersReviewNone: "No review sent yet.",
  reviewersReviewSent: "Review sent {date}.",
  reviewersReviewChanged: "Review sent {date}, last changed {changed}.",
  reviewersKept:
    "Cannot be removed from this proposal: their review was sent, and a sent review is part of the proposal's record.",
  reviewersBlockedSent:
    "No longer reviews this proposal, and is not counted among its reviewers: they are now one of its people, have a conflict of interest with it, or no longer review for this committee. Their review was sent before that, and stays part of the proposal's record.",
  reviewersRemoveSent:
    "Not removed: {name} has sent their review meanwhile, and a sent review stays with the proposal. The list was loaded again.",
  reviewersReviewOf: "Review by {name}",
  reviewersScore: "{score} of {max}",
  reviewersNoScore: "No score",
  reviewersRecommendation: "Recommendation",
  reviewersNoRecommendation: "None given",
  reviewersComments: "Comments for the authors",
  reviewersChairNote: "Note for the chairs only",
  reviewersChairNoteNone: "None.",
  reviewersOtherTitle: "Reviews by people no longer assigned",
  reviewersOtherIntro:
    "These reviews were sent by people who are no longer assigned to this proposal. They stay part of its record.",
  reviewersDeclinedTitle: "Said they could not review it",
  reviewersDeclinedOn: "Said so {date}.",
  reviewersDeclined_conflict:
    "A conflict of interest, or they know whose work it is. They will not be offered this proposal again.",
  reviewersDeclined_expertise: "It is outside what they can judge.",
  reviewersDeclined_time: "They do not have the time.",
  reviewersDeclinedNote: "Their note for the chairs:",
  reviewersBlocked:
    "Can no longer review this proposal, and is not counted among its reviewers: they are now one of its people, have a conflict of interest with it, or no longer review for this committee. Remove them from it.",
  reviewersRemoved: "{name} was removed from this proposal. Nobody was emailed.",
  reviewersRemoveGone:
    "Nothing was removed: {name} was no longer a reviewer of this proposal. The list was loaded again.",
  reviewersAssignTitle: "Assign a reviewer",
  reviewersAssignIntro:
    "These are the reviewers of this committee who can review this proposal. Its own people, and reviewers with a conflict of interest, are not listed. Each is shown with the number of proposals assigned to them, beside the most they said they would take; your own proposals, and any you have a conflict with, are not counted.",
  reviewersTakes_call_not_closed:
    "No reviewer can be assigned yet: the call has not closed. Reviewers can be assigned once its closing date has passed, or once the conference is in review.",
  reviewersTakes_not_under_consideration:
    "This proposal takes no new reviewers: it was withdrawn, or a decision has been recorded for it. You can still remove a reviewer it has.",
  reviewersNoCandidates:
    "No reviewer of this committee can be assigned to this proposal. Chairs invite reviewers on the People page.",
  reviewersFind: "Find a reviewer by name or email address",
  reviewersFindNone: "No reviewer matches what you typed.",
  reviewersLanguages: "Reviews in: {languages}",
  reviewersLoad: "{n} assigned",
  reviewersLoadOf: "{n} assigned of {max}",
  reviewersFull: "Has reached the number of proposals they said they would take.",
  reviewersAssign: "Assign",
  reviewersAssignFor: "Assign {name} to this proposal",
  reviewersAskFull: "Assign {name} all the same?",
  reviewersFullDoes:
    "{name} said they would take at most {max} proposals, and has {n}. That number is what they offered, not a limit: you can still assign them.",
  reviewersDoAssign: "Yes, assign",
  reviewersAssigned: "{name} is now a reviewer of this proposal. Nobody was emailed.",
  reviewersNowFull:
    "Not assigned yet: {name} has reached the number of proposals they said they would take. Read the numbers, then confirm.",
  reviewersNotOffered:
    "Not assigned: {name} can no longer be assigned to this proposal. The list was loaded again.",
  reviewersAlready: "{name} is already a reviewer of this proposal. The list was loaded again.",
  reviewersNotTaking:
    "Not assigned: this proposal takes no reviewer at the moment. The list was loaded again.",
  reviewersNoAccess:
    "Nothing was changed: only a chair who manages this proposal can change its reviewers.",
  reviewersLoadFailed:
    "The reviewers of this proposal could not be loaded. Reload the page to try again.",

  /* The Assignments page. */
  assignmentsTitle: "Assignments",
  assignmentsNoAccess: "Only the chairs of this conference can see who reviews its proposals.",
  assignmentsIntro:
    "Every proposal that can be given reviewers, under the committee that reviews it. Those that still need reviewers come first, then those still waiting for reviews. To assign or remove a reviewer, or to read the reviews that were sent, open the proposal. Nothing is assigned automatically, and nobody is emailed.",
  assignmentsCallOpen:
    "The call has not closed yet, so no reviewer can be assigned. The proposals submitted so far are listed.",
  assignmentsExcludedOne:
    "1 proposal is not listed: it is your own, or you have a conflict with it.",
  assignmentsExcludedMany:
    "{n} proposals are not listed: they are your own, or you have a conflict with them.",
  assignmentsCommittees: "Committees",
  assignmentsProposalsNone: "No proposal of this committee takes reviewers.",
  assignmentsProposalsOne: "1 proposal.",
  assignmentsProposalsMany: "{n} proposals.",
  assignmentsShortNone: "None still needs reviewers.",
  assignmentsShortOne: "1 still needs reviewers.",
  assignmentsShortMany: "{n} still need reviewers.",
  assignmentsAsksOne: "This committee asks for 1 reviewer for each proposal.",
  assignmentsAsksMany: "This committee asks for {needed} reviewers for each proposal.",
  assignmentsReviewers: "Reviewers: {n} of {needed}",
  assignmentsSent: "Reviews sent: {n}",
  assignmentsWaitingOne:
    "1 has its reviewers and fewer reviews sent than the committee asks for. It is listed next.",
  assignmentsWaitingMany:
    "{n} have their reviewers and fewer reviews sent than the committee asks for. They are listed next.",
  assignmentsNeedsOne: "Needs 1 more",
  assignmentsNeedsMany: "Needs {n} more",
  assignmentsComplete: "Has its reviewers",
  assignmentsNoReviewer: "No reviewer yet",
};
