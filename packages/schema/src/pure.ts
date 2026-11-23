export { type CallState, callState, isCallOpen } from "./call";
/**
 * Zod-free entry point for browser code: `import { localize } from "@elochair/schema/pure"`.
 * Type imports from "@elochair/schema" are erased at build time and cost nothing.
 */
export { presenterCapReport } from "./cap";
export { type DeadlineClock, type StatedDeadline, statedDeadline } from "./deadline";
export { DECISION_OUTCOMES, type DecisionOutcome } from "./decisions";
export { dressedAs } from "./dressing";
export { hasStrayInvisible, removeStrayInvisible } from "./invisible";
export { LIMITS, REVIEW_EMAILS, ROLE_INVITATIONS } from "./limits";
export { effectiveBlindMode, findType } from "./lookup";
export {
  ANSWER_WORDS,
  type ConferenceMessages,
  commentsBlock,
  committeeList,
  DECISION_MESSAGES,
  DECLINE_REASON_WORDS,
  filledMessage,
  fillMessage,
  fillPlaceholders,
  formatDeadline,
  type InvitationAnswer,
  isMailLanguage,
  MAIL_LANGUAGES,
  type MailLang,
  type MailMessageKey,
  MESSAGE_KEYS,
  MESSAGE_PARTS,
  MESSAGES,
  type MessagePart,
  type MessagePlaceholder,
  type MessageProblem,
  type MessageProblemCode,
  type MessageValues,
  mailLanguagesFor,
  messageProblems,
  messageText,
  noCommentsSentence,
  placeholdersIn,
  placeholdersOf,
  ROLE_WORDS,
  reasonList,
  reviewerLabel,
  reviewsDueSentence,
  type TextSpan,
  UNNAMED_OWNER,
} from "./messages";
export {
  DEFAULT_NOTIFICATION_CHOICES,
  NOTICE_FREQUENCIES,
  type NoticeFrequency,
  type NotificationChoices,
} from "./notifications";
export {
  CONFERENCE_PHASES,
  canWithdrawIn,
  nextPhase,
  previousPhase,
  reviewersCanRead,
} from "./phases";
export {
  DECLINE_REASONS,
  type DeclineReason,
  EMPTY_REVIEW,
  fitReview,
  RECOMMENDATIONS,
  type Recommendation,
  type ReviewContent,
  type ReviewIssue,
  reviewContentIssues,
  reviewIssues,
  reviewPoolFor,
  SCALE_CHOICES_MAX,
  scaleChoices,
} from "./reviewForm";
export {
  type IdentityHint,
  normalizeWords,
  type SelfIdKind,
  type SelfIdWarning,
  selfIdentificationWarnings,
} from "./selfid";
export {
  type ConfigChange,
  configChanges,
  keyedPath,
  type Setting,
  type SettingId,
  type SettingKind,
  settingAt,
  stageOneSettings,
  withSetting,
} from "./settings";
export { localize, localizeWithLang } from "./text";
export { type SubmissionIssue, sizeIssues, validateSubmission } from "./validate";
export { countWords } from "./words";
