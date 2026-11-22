/**
 * Strings for the chairs' People page and for the page an invitation to a role links to
 * (English source). Spec 03, §1.2.
 */
export const peopleEn = {
  managePeopleLink: "People",
  peopleTitle: "People",
  peopleNoAccess: "Only the chairs of this conference can see and change its people.",
  peopleIntro:
    "This page shows who holds a role at this conference, and the invitations that nobody has accepted. A person gets a role by accepting an invitation sent from here. You can take a role away again.",
  peopleNoName: "No name yet",
  peopleYou: "You",
  peopleInviteTitle: "Invite someone",
  peopleInviteIntro:
    "The person gets an email with a link. Nothing changes until they open the link and accept: then the address you typed gets the role, whoever opened the link. The link works for {days} days. You invite one address at a time.",
  peopleInviteEmail: "Email address",
  peopleInviteName: "Name (optional)",
  peopleInviteNameHint:
    "Only chairs see this name, on this page. It is not put in the email, and the person gives their own name when they accept.",
  peopleInviteRole: "Role",
  peopleInviteRole_reviewer: "Reviewer",
  peopleInviteRoleDoes_reviewer:
    "Sees only the proposals the chairs assign to them, and writes a review of each.",
  peopleInviteRole_chair: "Chair",
  peopleInviteRoleDoes_chair:
    "Can do everything you can: see every proposal and everyone on it, change the conference's settings, invite and remove people, and move the conference from one phase to the next.",
  peopleInvitePools: "Review pools",
  peopleInvitePoolsHint:
    "Choose at least one. The reviewer can be assigned proposals in the formats these pools review.",
  peopleInviteLang: "Language of the email",
  peopleInviteSend: "Send the invitation",
  peopleInviteLimits:
    "You can send {perInviter} invitations a day, and one address can be sent {perRecipient} a day.",
  peopleEmailInvalid: "Enter one valid email address.",
  peopleNameInvalid:
    "Use one line of letters or digits, at most {max} characters, without hidden formatting characters.",
  peoplePoolsRequired: "Choose at least one review pool.",
  peopleInvited: "The invitation was sent to {email}.",
  peopleAlreadyInvited:
    "An invitation to this address for this role is already waiting. You can send it again from the list of invitations.",
  peopleAlreadyHasRole: "This address already holds that role at this conference.",
  peopleInviteLimited:
    "Not sent: too many invitations have gone out today. You can send {perInviter} a day, and one address can be sent {perRecipient} a day. Try again tomorrow.",
  peopleChairsTitle: "Chairs",
  peopleChairsIntro:
    "Chairs run the conference: they see every proposal, change the settings and manage this page. You cannot remove your own role, so that the conference always has a chair.",
  peopleReviewersTitle: "Reviewers",
  peopleReviewersIntro:
    "Reviewers are listed under each review pool they belong to, with the number of proposals assigned to them. Your own proposals, and any you have a conflict with, are not counted.",
  peoplePoolEmpty: "Nobody reviews for this pool yet.",
  peoplePoolGone: "Not in a current review pool",
  peopleAssignedNone: "No proposals assigned",
  peopleAssignedOne: "1 proposal assigned",
  peopleAssignedMany: "{n} proposals assigned",
  peopleOffers: "Will take up to {max}. Reviews in: {languages}.",
  peopleTrackChairsTitle: "Track chairs",
  peopleTrackChairsIntro:
    "Track chairs are not part of this version of the app. The people here were given the role earlier. You can remove it; nobody can be invited to it.",
  peopleTracks: "Tracks: {tracks}",
  peopleAllTracks: "All tracks",
  peopleInvitationsTitle: "Invitations",
  peopleInvitationsIntro:
    "Invitations that are waiting for an answer, were declined or have expired. Each is shown as you typed it. Nobody is emailed when a person answers: this list is where you see it. “Send again” sends a new email with a new link, and the link in the earlier email stops working.",
  peopleInvitationsNone: "No invitation is waiting, declined or expired.",
  peopleInvitationRole_reviewer: "Invited as a reviewer: {pools}",
  peopleInvitationRole_chair: "Invited as a chair",
  peopleInvState_waiting: "Waiting for an answer",
  peopleInvState_declined: "Declined",
  peopleInvState_expired: "Expired",
  peopleInvSent: "Sent {date}",
  peopleInvExpires: "The link works until {date}",
  peopleInvDeclined: "Declined {date}",
  peopleInvExpired: "The link stopped working {date}",
  peopleResend: "Send again",
  peopleResendFor: "Send again: invitation to {email}",
  peopleCancel: "Cancel the invitation",
  peopleCancelFor: "Cancel the invitation to {email}",
  peopleDismiss: "Take off this list",
  peopleDismissFor: "Take off this list: invitation to {email}",
  peopleResent: "A new email was sent to {email}. The link in the earlier email no longer works.",
  peopleResendLimited:
    "Not sent. An invitation can be sent again once an hour, and the daily limits apply: {perInviter} from you, {perRecipient} to one address.",
  peoplePoolsGone:
    "Not sent: the review pools of this invitation are no longer part of the conference, so its link gives nothing. Cancel it, and invite the person again.",
  peopleInvitationChanged:
    "Nothing was done: this invitation had changed in the meantime. The list was loaded again.",
  peopleAskCancel: "Cancel the invitation to {email}?",
  peopleCancelDoes:
    "The link in the email stops working, and the invitation leaves this list. Nobody is told.",
  peopleDoCancel: "Yes, cancel it",
  peopleAskDismiss: "Take the invitation to {email} off this list?",
  peopleDismissDoes: "Nothing else changes, and nobody is told. You can invite this address again.",
  peopleDoDismiss: "Yes, take it off",
  peopleGoBack: "No, go back",
  peopleCancelled: "The invitation to {email} was cancelled. Its link no longer works.",
  peopleDismissed: "The invitation to {email} was taken off the list.",
  peopleRemove: "Remove",
  peopleRemoveFor_chair: "Remove {name} as a chair",
  peopleRemoveFor_reviewer: "Remove {name} as a reviewer",
  peopleRemoveFor_track_chair: "Remove {name} as a track chair",
  peopleAskRemove_chair: "Remove {name} as a chair?",
  peopleAskRemove_reviewer: "Remove {name} as a reviewer?",
  peopleAskRemove_track_chair: "Remove {name} as a track chair?",
  peopleRemoveDoes_chair:
    "{name} will no longer see the proposals as a chair, change the settings, invite or remove people, or move the conference's phase. They are not told by email. Invitations they sent stay as they are: cancel any of them in the list below. To make them a chair again, invite them again.",
  peopleRemoveDoes_reviewer:
    "{name} will no longer be a reviewer at this conference, in any review pool, and will no longer see the proposals assigned to them. They are not told by email. To make them a reviewer again, invite them again.",
  peopleRemoveDoes_track_chair:
    "{name} will no longer manage the proposals of their tracks. They are not told by email. Nobody can be invited to this role in this version of the app.",
  peopleRemoveAssignedNone: "None of the proposals you manage is assigned to them.",
  peopleRemoveAssignedOne:
    "1 proposal you manage is assigned to them, and will lose this reviewer.",
  peopleRemoveAssignedMany:
    "{n} proposals you manage are assigned to them, and will lose this reviewer.",
  peopleDoRemove: "Yes, remove",
  peopleRemoved_chair: "{name} is no longer a chair of this conference.",
  peopleRemoved_reviewer: "{name} is no longer a reviewer at this conference.",
  peopleRemoved_track_chair: "{name} is no longer a track chair of this conference.",
  peopleRemoveStale:
    "Nothing was removed: the number of proposals assigned to this reviewer has changed. Read the new number, then confirm again.",
  peopleRemoveGone:
    "Nothing was removed: this person no longer holds that role. The list was loaded again.",
  peopleUnconfirmed: "The server did not confirm this. Please try again.",
  roleInvTitle: "Invitation to a role",
  roleInvIntro_reviewer: "The chairs of {conference} invite you to be a reviewer.",
  roleInvIntro_chair: "The chairs of {conference} invite you to be a chair of the conference.",
  roleInvConference: "Conference",
  roleInvRole: "Role",
  roleInvCommittees: "Committees",
  roleInvFor: "Invitation for",
  roleInvMeans_reviewer:
    "If you accept: the chairs will assign proposals to you; you read them and write a short review of each.",
  roleInvMeans_chair:
    "If you accept: you will be able to see every proposal and everyone on it, change the conference's settings, invite people, and move the conference from one phase to the next.",
  roleInvBound:
    "This invitation is for {email}. If you accept, that address gets the role, whoever opens this link. Accepting does not sign you in.",
  roleInvExpires: "You can answer until {date}.",
  roleInvLanguages: "Languages you can review in",
  roleInvLanguagesHint: "Choose at least one.",
  roleInvLanguagesRequired: "Choose at least one language to accept.",
  roleInvLoad: "The most proposals you are willing to review",
  roleInvLoadHint:
    "A whole number from {min} to {max}. The chairs see it when they assign proposals.",
  roleInvLoadInvalid: "Enter a whole number from {min} to {max}.",
  roleInvYourName: "Your name",
  roleInvNameHelp: "Your own name, as the chairs will see it.",
  roleInvNameRequired: "Enter your name to accept.",
  roleInvAccept: "Accept",
  roleInvDecline: "Decline",
  roleInvDeclineNote:
    "Declining needs nothing more. The chairs will see that you declined; nobody is emailed.",
  roleInvAccepted_reviewer:
    "Thank you: {email} is now a reviewer for {conference}. You can sign in with that address at any time.",
  roleInvAccepted_chair:
    "Thank you: {email} is now a chair of {conference}. Sign in with that address to manage the conference.",
  roleInvDeclined: "You declined. No role was given, and the chairs will see your answer.",
  roleInvInvalid:
    "This invitation link no longer works: it has expired, was already answered, or was cancelled. If you were sent a newer email, use the link in that one. Otherwise, ask the conference's chairs to invite you again.",
  roleInvSignIn: "Sign in as {email}",
};
