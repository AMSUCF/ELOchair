/**
 * Strings for the reviewer's screens (English source): "My reviews", the review form under a
 * proposal, a review that was sent, and "I cannot review this proposal". Spec 03, §1.4.
 *
 * The names of the three fixed fields and of the three recommendations are here, and are the
 * app's own. The descriptions under the fields are the standard wording: a reviewer reads them
 * until the chairs write their own in the conference's settings (spec 03, §1.8).
 */
export const reviewsEn = {
  navMyReviews: "My reviews",

  /* "My reviews": the list. */
  myReviewsTitle: "My reviews",
  myReviewsNeedSignIn: "Please sign in to see your reviews.",
  myReviewsNone:
    "You have nothing to review at the moment. Proposals appear here once a conference you review for is in review and its chairs have assigned some to you.",
  myReviewsCommittees: "You review for: {committees}",
  myReviewsDue: "Reviews are due {date}.",
  myReviewsDueNote:
    "You can send and change your reviews for as long as the conference is in review.",
  myReviewsClosed:
    "Reviewing has ended at this conference. You can read your reviews; they can no longer be changed.",
  myReviewsCountSent: "{sent} of {total} sent",
  myReviewsCountDraftOne: "1 draft",
  myReviewsCountDraftMany: "{n} drafts",
  myReviewsCountNotStarted: "{n} not started",
  myReviewsGuidelinesFor: "Guidelines for reviewers: {committee}",
  myReviewsProposals: "Proposals assigned to you",
  myReviewsEmpty: "No proposal is assigned to you at this conference yet.",
  myReviewsOnlyYours:
    "You see only the proposals assigned to you. Nobody else who reviews them is shown.",
  myReviewsLeft:
    "“{title}” has left your list. The chairs can see that you cannot review it, and can give it to someone else.",
  reviewStatus_not_started: "Not started",
  reviewStatus_draft: "Draft",
  reviewStatus_sent: "Sent",

  /* A proposal as its reviewer reads it, and the form under it. */
  reviewNamesShown:
    "This committee sees who the authors are; they never learn who reviewed their proposal.",
  reviewFormTitle: "Your review",
  reviewFormIntro:
    "The chairs read your review and know it is yours. The authors receive your comments for them, without your name and without the scores.",
  reviewScoreLead: "Score each criterion. {min} is the lowest, {max} the highest.",
  reviewScoreLeadMixed:
    "Score each criterion. On each scale the smallest number is the lowest score, and the largest the highest.",
  reviewScale: "From {min} (lowest) to {max} (highest)",
  reviewScoreTyped: "A whole number from {min} to {max}",
  reviewComments: "Comments for the authors",
  reviewCommentsHelp:
    "The authors receive this with the decision. Say what is strong, what is unclear, and what would improve it.",
  reviewChairNote: "Note for the chairs only (optional)",
  reviewChairNoteHelp: "The authors never see this.",
  reviewRecommendation: "Your recommendation",
  recommendation_accept: "Accept",
  recommendation_unsure: "Unsure",
  recommendation_reject: "Reject",
  reviewWords: "{count} words",
  reviewWordsBetween: "{count} words (between {min} and {max})",
  reviewWordsMin: "{count} words (at least {min})",
  reviewWordsMax: "{count} words (at most {max})",
  reviewSend: "Send review",
  reviewSaveDraft: "Save draft",
  reviewDraftSaved:
    "Draft saved. The chairs see your review only once you send it. You can change it after sending, while the conference is in review.",
  reviewSent:
    "Your review was sent. The chairs can read it now. You can change it while the conference is in review.",
  reviewChanged: "Your changed review was sent. The chairs now read this version.",
  reviewErrors: "Before you send your review, fix the following:",
  reviewErrorsDraft: "The draft could not be saved as it is:",
  reviewNothingToSave: "There is nothing new to save.",
  reviewStale:
    "This review was saved elsewhere meanwhile, in another tab or on another device. What you typed here is still in the form: check it, then save or send it again.",
  reviewRestoredMoved:
    "Your unsaved changes were restored from this device. This review was saved somewhere else since you made them, in another tab or on another device, and they would replace what was saved there. Check them, then save or send, or discard them.",
  reviewNotReviewing:
    "Not saved: the conference is no longer in review, so reviews can no longer be changed.",
  reviewGone:
    "Not saved: this proposal is no longer assigned to you. What you typed was not sent to anyone.",
  reviewAlreadySent:
    "Not saved as a draft: this review was already sent. Send it again to change what the chairs read.",
  reviewUnconfirmed: "The server did not confirm this. Please try again.",
  reviewDraftNotice:
    "This is a draft. Only you can see it: the chairs see your review once you send it.",
  reviewSentOn:
    "Your review was sent on {date}. You can change it while the conference is in review.",
  reviewSentChangedOn:
    "Your review was sent on {date} and last changed on {changed}. You can change it while the conference is in review.",
  reviewSentClosed:
    "Your review was sent on {date}. Reviewing has ended, so it can no longer be changed.",
  reviewDraftClosed:
    "This draft was not sent. Reviewing has ended, so it can no longer be sent, and the chairs do not see it.",
  reviewNotStartedClosed: "You did not review this proposal. Reviewing has ended.",
  reviewScoreOf: "{score} of {max}",
  reviewNoScore: "No score",
  reviewNoRecommendation: "None given",
  reviewNoComments: "Nothing written yet.",
  reviewNoteHeading: "Note for the chairs only",
  reviewNoteNone: "You wrote none.",
  reviewChange: "Change my review",
  reviewChanging:
    "You are changing a review that was sent. The chairs read the version you sent until you send this one.",
  reviewKeepSent: "Leave the review as it was sent",
  reviewBackToList: "Back to my reviews",
  reviewCannot: "I cannot review this proposal",
  reviewCannotAfterSent:
    "You have sent your review of this proposal, so it stays yours to review. If you can no longer stand by it, change it, or write to the chairs:",
  issue_not_on_form:
    "The review form no longer has this. Reload the page to see the form as it is now.",

  /* "I cannot review this proposal". */
  cannotTitle: "I cannot review this proposal",
  cannotDoes:
    "The chairs are told by email that a proposal was given back. On its page they see who gave it back, with your reason and your note, and they can give it to someone else. It leaves your list, and you can no longer open it.",
  cannotDoesChair:
    "The chairs are told by email that a proposal was given back. On its page they see who gave it back, with your reason and your note, and they can give it to someone else. It leaves your list of reviews. You can still open the proposal as a chair, unless your reason is a conflict of interest: then you can no longer open it.",
  cannotWhy: "Why?",
  cannotReason_conflict: "I have a conflict of interest, or I know whose work this is",
  cannotReason_expertise: "It is outside what I can judge",
  cannotReason_time: "I do not have the time",
  cannotConflictNote:
    "After a conflict of interest, the proposal is never assigned to you again. After either of the other two, a chair could assign it to you again later.",
  cannotNote: "Note for the chairs (optional)",
  cannotTell: "Tell the chairs",
  cannotCancel: "Cancel",
  cannotErrors: "Before you tell the chairs, fix the following:",
  issue_choose_reason: "Choose a reason.",
  cannotDraftGoes: "The draft you saved for this proposal is discarded.",
  cannotNotOffered:
    "This is no longer possible: your review of this proposal was sent, or the conference is no longer in review.",
  cannotGone: "This proposal is not assigned to you.",
};
