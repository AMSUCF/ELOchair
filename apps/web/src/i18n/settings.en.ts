/** Strings for the chairs' conference settings screen (English source). */
export const settingsEn = {
  manageSettingsLink: "Conference settings",
  settingsTitle: "Conference settings",
  settingsNoAccess: "Only the chairs of this conference can change its settings.",
  settingsIntro:
    "Change the conference's details, dates, limits and texts here, how proposals are reviewed, the wording of the emails the app sends, and the agreements people accept. You review every change before it is saved, and each save is recorded.",
  settingsScopeNote:
    "Formats, fields, languages, review pools, criteria and agreements are added or removed by importing a configuration on the server, not here.",
  settingsBackToManage: "Back to the submissions",
  settingsSectionConference: "The conference",
  settingsSectionDeadlines: "Deadlines",
  settingsSectionRules: "Rules",
  settingsSectionFormats: "Formats",
  settingsSectionReview: "Review",
  settingsSectionEmails: "Emails",
  settingsSectionAgreements: "Agreements",
  settingsSectionOther: "Formats not submitted here",
  settingsSectionWays: "Ways to contribute",
  settingsWaysIntro:
    "The front page and the conference page list these under “Ways to contribute”, each with a link to its formats. Adding or removing one, or moving a format to another, is done by importing a configuration.",
  settingsWayFormats: "It leads to these formats: {formats}.",
  settingsSectionTracks: "Tracks",
  settingsSectionTopics: "Topics",
  settingsField: "Field: {name}",
  settingsPoolFormats: "This pool reviews these formats: {formats}.",
  settingsPoolNoFormats: "No format is reviewed by this pool.",
  settingsPoolOwnMode_double: "{format} is always anonymized, whatever is chosen below.",
  settingsPoolOwnMode_single:
    "For {format}, reviewers always see the authors' names and affiliations, whatever is chosen below.",
  settingsPoolOwnMode_open:
    "For {format}, reviewers always see the authors' names, affiliations and bios, whatever is chosen below.",
  settingsCriterion: "Criterion: {name}",
  settingsLabel_title: "Title",
  settingsLabel_theme: "Theme",
  settingsLabel_distinction: "What sets this edition apart",
  settingsLabel_invitation: "Invitation",
  settingsDistinctionHint:
    "Optional. One line, shown with the dates and the place on the front page and at the top of the conference page.",
  settingsInvitationHint:
    "Optional. A short paragraph that says what work the call welcomes. The front page and the conference page begin with it, in the reader's language where you have written it and otherwise in the conference's main language.",
  settingsLabel_formatsIntro: "Introduction to the formats",
  settingsFormatsIntroHint:
    "Optional. A sentence or two, shown on the conference page above its submission formats, in the reader's language where you have written it and otherwise in the conference's main language.",
  settingsLabel_host: "Host institution",
  settingsLabel_location: "Place",
  settingsLabel_modality: "How people take part",
  settingsLabel_contactEmail: "Contact email",
  settingsLabel_website: "Conference website",
  settingsLabel_dates_start: "First day of the conference",
  settingsLabel_dates_end: "Last day of the conference",
  settingsLabel_placeholder: "Say on the conference page that it is provisional",
  settingsLabel_rules_presenterCap_max: "Most lead and presenting roles per person",
  settingsLabel_rules_bio_maxWords: "Most words in a bio",
  settingsLabel_rules_reviewReminderDays: "Reminder to reviewers: days before reviews are due",
  settingsReminderDaysHint:
    "Optional. Left empty, it is {days} days. That many days before the day reviews are due, from {hour} in the conference's time zone, each reviewer who still has reviews to send gets one email, unless they turned it off. No reminder is sent while no day is set. If you move the day afterwards, reviewers are reminded again before the new one, unless the reminder for that day has already gone out.",
  settingsLabel_type_name: "Name",
  settingsLabel_type_description: "Description",
  settingsLabel_type_abstract_label: "What the abstract is called",
  settingsLabel_type_abstract_minWords: "Fewest words in the abstract",
  settingsLabel_type_abstract_maxWords: "Most words in the abstract",
  settingsLabel_type_durationMinutes: "Minutes on the program",
  settingsLabel_type_team_min: "Fewest people",
  settingsLabel_type_team_max: "Most people",
  settingsLabel_field_label: "Label",
  settingsLabel_field_help: "Help text",
  settingsLabel_field_required: "This field must be filled in",
  settingsLabel_field_maxWords: "Most words",
  settingsLabel_field_min: "Smallest number",
  settingsLabel_field_max: "Largest number",
  settingsLabel_field_integer: "Whole numbers only",
  settingsLabel_pool_name: "Name",
  settingsLabel_pool_blindMode: "How authors appear to reviewers",
  settingsLabel_pool_reviewsPerSubmission: "Reviews per proposal",
  settingsLabel_pool_guidelines: "Guidelines for reviewers",
  settingsLabel_criterion_label: "Label",
  settingsLabel_criterion_description: "Description",
  settingsCriterionDescriptionHint:
    "Optional. What this criterion asks, or what its lowest and highest scores mean. Reviewers read it under the criterion's name on the review form.",
  settingsFormTitle: "The review form",
  settingsFormIntro:
    "Under the scores, this committee's review form has comments for the authors, a note for the chairs only, and an overall recommendation. Their names are the app's own. What is written under each, the limits on the comments, and whether the form has the note and the recommendation, are yours to set.",
  settingsLabel_form_comments_description:
    "Comments for the authors: what is written under the field",
  settingsLabel_form_comments_minWords: "Comments for the authors: fewest words",
  settingsLabel_form_comments_maxWords: "Comments for the authors: most words",
  settingsLabel_form_chairNote_enabled: "The form has a note for the chairs only",
  settingsLabel_form_chairNote_description:
    "Note for the chairs only: what is written under the field",
  settingsLabel_form_recommendation_enabled:
    "The form asks for an overall recommendation: accept, unsure or reject",
  settingsLabel_form_recommendation_description: "Recommendation: what is written under its name",
  settingsFormDescriptionHint:
    "Optional. Left empty, reviewers read the standard sentence: “{standard}”",
  settingsFormDescriptionHintNone: "Optional. Left empty, nothing is written there.",
  settingsReviewsDueHint:
    "Optional. Reviewers are shown this day on their list. It locks nothing: reviews can be sent and changed for as long as the conference is in review. For no day, leave the date empty.",
  settingsDeadlineNone: "No day is set.",
  settingsLabel_criterion_min: "Smallest score",
  settingsLabel_criterion_max: "Largest score",
  settingsBlind_double:
    "Anonymized: reviewers do not see who the authors are, or the answers marked as identifying (such as a link to the work)",
  settingsBlind_single: "Reviewers see the authors' names and affiliations",
  settingsBlind_open: "Reviewers see the authors' names, affiliations and bios",
  settingsBlindHint:
    "An anonymized review stays anonymized once a reviewer has been assigned, even if they are removed again: after that, it can no longer be changed to show the authors.",
  settingsGuidelinesHint:
    "Optional. This pool's reviewers see this text above every proposal assigned to them, in their own language where you have written it and otherwise in the conference's main language. Line breaks are kept.",
  settingsEmailsIntro:
    "The app sends these emails to the people on a proposal, to the people a chair invites as reviewers or chairs, to reviewers and chairs while proposals are reviewed, and to a proposal's authors when the chairs send the decisions. You can change their wording in English, Spanish and Portuguese. Each box shows the text that is sent: the standard text, until you change it.",
  settingsEmailsNote:
    "All three languages are here, whichever of them the conference has, because each person gets the email in their own language: someone can be invited in Portuguese to a conference held in English and Spanish. A language you have not changed keeps the standard text. These texts are not private: like the rest of these settings, anyone who can see the conference can read them. The sign-in email is the same for everyone and cannot be changed here.",
  settingsEmail_invitation: "Invitation to a proposal",
  settingsEmail_submission_received: "Receipt for a submitted proposal",
  settingsEmail_submission_withdrawn: "Notice that a proposal was withdrawn",
  settingsEmail_invitation_withdrawn: "Notice to people invited to a withdrawn proposal",
  settingsEmail_invitation_answered: "Answer to an invitation, for the owner",
  settingsEmail_draft_deleted: "Notice to people invited to a deleted draft",
  settingsEmail_reviewer_invitation: "Invitation to be a reviewer",
  settingsEmail_chair_invitation: "Invitation to be a chair",
  settingsEmail_new_assignments: "New assignments, to a reviewer",
  settingsEmail_review_reminder: "Reminder before reviews are due, to a reviewer",
  settingsEmail_reviewer_declined: "A reviewer cannot review a proposal, to the chairs",
  settingsEmail_reviews_complete: "A proposal has all its reviews, to the chairs",
  settingsEmail_decision_accepted: "Decision: accepted, to the authors",
  settingsEmail_decision_waitlisted: "Decision: on the waiting list, to the authors",
  settingsEmail_decision_rejected: "Decision: not accepted, to the authors",
  settingsEmailWhen_invitation:
    "Sent to a person when the owner of a proposal adds them to it, and again if the owner sends the invitation again. That person has not agreed to anything yet.",
  settingsEmailWhen_submission_received:
    "Sent to the owner and to every confirmed contributor when a proposal is submitted.",
  settingsEmailWhen_submission_withdrawn:
    "Sent to the owner, to every confirmed contributor and to the conference's contact email when a submitted proposal is withdrawn.",
  settingsEmailWhen_invitation_withdrawn:
    "Sent to people who were invited to a proposal and have not answered, when its owner withdraws it. It cannot name the proposal: they have not agreed to anything.",
  settingsEmailWhen_invitation_answered:
    "Sent to the owner of a proposal when someone they invited confirms or declines, or when a contributor leaves.",
  settingsEmailWhen_draft_deleted:
    "Sent to people who were invited to a draft and have not answered, when its owner deletes it. It cannot name the proposal: they have not agreed to anything.",
  settingsEmailWhen_reviewer_invitation:
    "Sent to a person when a chair invites them, on the People page, to be a reviewer, and again if a chair sends the invitation again. That person has not agreed to anything yet, so the email names no person: neither the chair who invites, nor the name that chair typed for them.",
  settingsEmailWhen_chair_invitation:
    "Sent to a person when a chair invites them, on the People page, to be a chair, and again if a chair sends the invitation again. That person has not agreed to anything yet, so the email names no person: neither the chair who invites, nor the name that chair typed for them.",
  settingsEmailWhen_new_assignments:
    "Sent to a reviewer when a chair assigns proposals to them while the conference is in review, and for proposals assigned earlier once it is: an email for each one, one summary a day (from {hour} in the conference's time zone), or none, as that reviewer chose under “Your account”. It says how many proposals and never which: it names no proposal and no author.",
  settingsEmailWhen_review_reminder:
    "Sent to each reviewer who has reviews that are not sent, from {hour} in the conference's time zone, some days before the day reviews are due: {days} days, unless you set another number among the deadlines. Sent once for the day you set. Not sent while no day is set, and not to a reviewer who turned reminders off under “Your account”.",
  settingsEmailWhen_reviewer_declined:
    "Sent to the conference's chairs when a reviewer says they cannot review a proposal and gives it back: an email for each one, one summary a day (from {hour} in the conference's time zone), or none, as each chair chose under “Your account”. It names no proposal and no reviewer: who gave it back is on the proposal's page. A chair gets none about their own proposal or one they have a conflict with.",
  settingsEmailWhen_reviews_complete:
    "Sent to the conference's chairs when a proposal has as many sent reviews as its committee asks for: an email for each one, one summary a day (from {hour} in the conference's time zone), or none, as each chair chose under “Your account”. It names no proposal. A chair gets none about their own proposal or one they have a conflict with.",
  settingsEmailWhen_decision_accepted:
    "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is accepted. Nobody can turn this email off. In its standard text it carries the reviewers' comments for the authors. It never carries a reviewer's name, a score, a recommendation or a note for the chairs.",
  settingsEmailWhen_decision_waitlisted:
    "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is put on the waiting list. Nobody can turn this email off. When a new decision is sent for that proposal later, they get the email for that outcome.",
  settingsEmailWhen_decision_rejected:
    "Sent to the owner and to every confirmed co-author of a proposal when the chairs send the decisions and the proposal is not accepted. Nobody can turn this email off. In its standard text it carries the reviewers' comments for the authors. It never carries a reviewer's name, a score, a recommendation or a note for the chairs.",
  settingsEmailPlaceholders:
    "You can put these words, with their braces, in the subject and in the text. Each is replaced when the email is sent:",
  settingsEmailPlaceholder_conference: "the conference's title",
  settingsEmailPlaceholder_format: "the proposal's format",
  settingsEmailPlaceholder_title: "the proposal's title",
  settingsEmailPlaceholder_deadline:
    "the date and time the call closes, in the conference's time zone",
  settingsEmailPlaceholder_link: "the link to the proposal",
  settingsEmailPlaceholder_invitationLink:
    "the link where the person sees the proposal and confirms or declines",
  settingsEmailPlaceholder_roleInvitationLink:
    "the link where the person reads the invitation and accepts or declines",
  settingsEmailPlaceholder_committees:
    "the names of the review pools the person is invited to, with commas between them",
  settingsEmailPlaceholder_owner: "the name of the proposal's owner",
  settingsEmailPlaceholder_role: "the person's role on the proposal",
  settingsEmailPlaceholder_person:
    "the person who answered: their name, or their address, as the owner wrote it",
  settingsEmailPlaceholder_answer: "what that person did",
  settingsEmailPlaceholder_count: "how many the email is about",
  settingsEmailPlaceholder_count_new_assignments:
    "how many proposals were newly assigned to the reviewer",
  settingsEmailPlaceholder_count_review_reminder: "how many reviews the reviewer has not sent yet",
  settingsEmailPlaceholder_count_reviewer_declined: "how many proposals were given back",
  settingsEmailPlaceholder_count_reviews_complete: "how many proposals now have all their reviews",
  settingsEmailPlaceholder_due:
    "a sentence that says when reviews are due, or that the chairs have set no day",
  settingsEmailPlaceholder_reason:
    "why the reviewer cannot review it; in a summary, each reason that was given",
  settingsEmailPlaceholder_choices:
    "the link to the person's own choices about these emails, under “Your account”",
  settingsEmailPlaceholder_reviewsLink: "the link to the reviewer's list, “My reviews”",
  settingsEmailPlaceholder_assignmentsLink: "the link to the conference's Assignments page",
  settingsEmailPlaceholder_comments:
    "the reviewers' comments for the authors, each under “Reviewer 1”, “Reviewer 2” and so on, without names or scores; where there are none, one sentence that says so. You can leave it out: the proposal's page shows them too.",
  settingsEmailWords: "{language}: {words}",
  settingsEmailRequired: "The text must contain it.",
  settingsEmailBodyOnly: "It cannot go in the subject.",
  settingsEmailRequiredBodyOnly: "The text must contain it, and it cannot go in the subject.",
  settingsEmailNameRule:
    "It has to be a word of its own: only brackets, quotation marks and the punctuation that ends a phrase may touch it.",
  settingsLabel_message_subject: "Subject",
  settingsLabel_message_body: "Text",
  settingsEmailIsStandard: "This is the standard text.",
  settingsEmailChanged: "This is not the standard text.",
  settingsEmailUseStandard: "Use the standard text",
  settingsEmailUseStandardFor: "Use the standard text: {email}, {language}",
  settingsEmailUseStandardConfirm:
    "Replace what you typed with the standard text? What you typed in these two boxes and have not saved will be lost.",
  settingsEmailPreview: "The email as it would be sent, with made-up names and titles:",
  settingsEmailSample_owner: "Ana Example",
  settingsEmailSample_person: "Bruno Sample",
  settingsEmailSample_title: "A made-up title",
  settingsEmailSample_comment1:
    "A made-up comment: the argument is clear, and the examples carry it.",
  settingsEmailSample_comment2:
    "Another made-up comment, in two paragraphs.\n\nThe second one asks for a word about the method.",
  settingsStandardText: "the standard text",
  settingsAgreementsIntro:
    "People accept these when they submit a proposal or confirm an invitation. The app records which version of each agreement each person accepted.",
  settingsAgreementHint:
    "If you change what this agreement says (its title, its text or its link), give it a new version. With a new version, everyone who submits a proposal or confirms an invitation from then on accepts the new one. What people have already accepted stays recorded against the old version. Nobody is emailed, and proposals already submitted are not affected.",
  settingsLabel_agreement_title: "Title",
  settingsLabel_agreement_text: "Text",
  settingsLabel_agreement_url: "Link",
  settingsLabel_agreement_version: "Version",
  settingsAgreementTextHint:
    "Optional if the agreement has a link. People read this under the title when they accept, in their own language where you have written it and otherwise in the conference's main language. Line breaks are kept.",
  settingsAgreementUrlHint:
    "Optional if the agreement has a text. A page people can open to read the agreement. It starts with https://",
  settingsAgreementVersionHint:
    "This names what people accept. Change it whenever the title, the text or the link changes. Anything different from the saved version will do: a date such as 2026-12, or a number.",
  settingsQuotedTitle: "“{title}”",
  settingsWarnNewVersion:
    "New version of {agreements}. Everyone who submits a proposal or confirms an invitation from now on accepts the new version. What people have already accepted stays recorded against the old one. Nobody is emailed, and proposals already submitted are not affected. Someone who has a proposal or an invitation open right now has to reload the page before they can accept.",
  settingsLabel_other_name: "Name",
  settingsLabel_other_description: "Description",
  settingsLabel_group_name: "Name",
  settingsLabel_group_summary: "What it includes",
  settingsLabel_track_name: "Name",
  settingsLabel_topic_label: "Name",
  settingsInLanguage: "{label} ({language})",
  settingsOptionalHint: "Optional. Leave it empty for none.",
  settingsNoMinimumHint: "Leave it empty for no minimum: the abstract then only has to be there.",
  settingsDeadlineDate: "Date",
  settingsDeadlineTime: "Time",
  settingsDeadlineOffset: "Offset from UTC",
  settingsDeadlineOffsetHint:
    "The offset says where that time is on the clock: -05:00 for Bogotá, -12:00 for “anywhere on Earth”. It is saved as you write it.",
  settingsDeadlineIncomplete: "Not a complete date, time and offset yet.",
  settingsReview: "Review changes",
  settingsNothingChanged: "Nothing has been changed.",
  settingsUnsaved: "Values changed and not saved yet: {n}.",
  settingsReviewTitle: "Review your changes",
  settingsReviewIntro: "Nothing is saved until you press “Save changes”.",
  settingsChangeFromTo: "from “{before}” to “{after}”",
  settingsInstant: "{when} ({tz}), stored as {stored}",
  settingsEmpty: "empty",
  settingsYes: "yes",
  settingsNo: "no",
  settingsSave: "Save changes",
  settingsSaved: "Settings saved.",
  settingsSavedMore:
    "Settings saved. What you changed while they were being saved is still in the form, not saved yet.",
  settingsNotSaved: "These changes were not saved. Review your changes again.",
  settingsFixFirst: "Please fix the following before these changes can be saved:",
  settingsBlocked:
    "These changes cannot be saved. Submitted proposals that would no longer be valid: {count}.",
  settingsBlockedHelp:
    "Submitted work must stay valid. Choose values that every submitted proposal meets, or ask the owners to change their proposals first.",
  settingsBlockedReason: "{label}: {n}",
  settingsBlockedOpen: "Proposal {n}",
  settingsBlockedHidden:
    "Of these, {n} are your own or ones you have a conflict with; another chair can open them.",
  settingsWarnDrafts:
    "Drafts that would have a new problem to fix before they can be submitted: {n}.",
  settingsWarnCloses:
    "This closes the call as soon as you save: nobody will be able to start, edit or submit a proposal, or confirm an invitation to one.",
  settingsWarnOpens: "This opens the call as soon as you save.",
  settingsWarnPast: "“{deadline}” would be in the past.",
  settingsStale:
    "Someone else has changed these settings since you opened them. Reload them to go on; what you typed stays in the form.",
  settingsReload: "Reload the settings",
  settingsReloaded: "The settings were reloaded. Review your changes again.",
  issue_settings_required: "This is required.",
  issue_settings_default_language_required: "Write this in the conference's main language.",
  issue_settings_whole_number: "Enter a whole number.",
  issue_settings_number_required: "Enter a number.",
  issue_settings_too_small: "Enter {min} or more.",
  issue_settings_too_big: "Enter {max} or less.",
  issue_settings_email: "Enter an email address.",
  issue_settings_url: "Enter a web address that starts with https://",
  issue_settings_date: "Enter a date.",
  issue_settings_datetime: "Enter a date, a time and an offset such as -05:00.",
  issue_settings_min_over_max: "This must not be more than the largest value beside it.",
  issue_settings_min_not_below_max: "This must be less than the largest score beside it.",
  issue_settings_reviewers_assigned:
    "Reviewers have already been assigned to proposals that are reviewed anonymized here. They and the authors were told that the review is anonymized, so the authors cannot be shown now.",
  issue_settings_no_whole_number:
    "There is no whole number between this and the largest value beside it, so nobody could answer.",
  issue_settings_deadline_order: "This must not be before the deadline above it.",
  issue_settings_reviews_due_order:
    "Reviews are due after submissions close and before decisions are sent.",
  issue_settings_reviews_below_scale:
    "Reviews already sent that give a lower score than this: {n}. A review that was sent stays valid, so the smallest score cannot go above a score already given.",
  issue_settings_reviews_above_scale:
    "Reviews already sent that give a higher score than this: {n}. A review that was sent stays valid, so the largest score cannot go below a score already given.",
  issue_settings_reviews_have_scores:
    "Reviews already sent that score a criterion this would remove: {n}. A review that was sent stays valid.",
  issue_settings_reviews_too_short:
    "Reviews already sent whose comments have fewer words than this: {n}. A review that was sent stays valid.",
  issue_settings_reviews_too_long:
    "Reviews already sent whose comments have more words than this: {n}. A review that was sent stays valid.",
  issue_settings_reviews_have_note:
    "Reviews already sent that have a note for the chairs: {n}. The note cannot be taken off the form while a sent review has one.",
  issue_settings_reviews_have_recommendation:
    "Reviews already sent that give a recommendation: {n}. It cannot be taken off the form while a sent review has one.",
  issue_settings_reviews_sent:
    "Reviews were already sent for proposals in this format: {n}. They answered the form of the committee that reviews it now.",
  issue_settings_reviews_hidden:
    "A proposal of your own, or one you have a conflict with, was submitted for this committee, and the conference has been in review. Whether that proposal has reviews, and what they hold, is not yours to know, so narrowing the form they are written on is not yours to do. A chair who has no proposal of their own before this committee, and no conflict with one, can make this change. If there is no such chair, invite one on the People page.",
  issue_settings_dates_order: "The last day must not be before the first day.",
  issue_settings_final_before_conference:
    "Final materials must be due before the conference starts.",
  issue_settings_message_empty: "Write the text, or choose “Use the standard text”.",
  issue_settings_message_not_one_line: "A subject is one line. Remove the line breaks.",
  issue_settings_message_too_long: "This is too long. Use {max} characters or fewer.",
  issue_settings_message_unknown_placeholder:
    "This email has nothing to put in place of {names}. Use only the words in braces listed above, or remove the braces.",
  issue_settings_message_not_in_subject: "The subject cannot contain {names}. Only the text can.",
  issue_settings_message_missing_placeholder: "The text must contain {names}.",
  issue_settings_message_link_touched:
    "Put a space or a line break before and after {names}. Whatever touches the link would become part of its address.",
  issue_settings_agreement_version_required:
    "You changed what this agreement says. People accepted the old words under this version, so enter a new version.",
  issue_settings_agreement_needs_text_or_link: "An agreement needs a text or a link.",
  issue_settings_too_long: "This is too long. Use {max} characters or fewer.",
  issue_settings_message_name_touched:
    "{names} stands for a name a person typed, so it has to be a word of its own. Put a space before and after it. Only brackets, quotation marks and the punctuation that ends a phrase may touch it: anything else could turn the name into part of a link or an address.",
  issue_settings_message_invisible:
    "This text has invisible characters, which can hide or reorder words. Type it again, or paste it as plain text.",
  issue_settings_invalid: "Check this value.",
};
