export { isCallOpen } from "./call";
/**
 * Zod-free entry point for browser code: `import { localize } from "@elochair/schema/pure"`.
 * Type imports from "@elochair/schema" are erased at build time and cost nothing.
 */
export { presenterCapReport } from "./cap";
export { dressedAs } from "./dressing";
export { hasStrayInvisible, removeStrayInvisible } from "./invisible";
export { LIMITS } from "./limits";
export { effectiveBlindMode, findType } from "./lookup";
export {
  ANSWER_WORDS,
  type ConferenceMessages,
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
  placeholdersIn,
  placeholdersOf,
  ROLE_WORDS,
  UNNAMED_OWNER,
} from "./messages";
export { CONFERENCE_PHASES, canWithdrawIn, nextPhase, previousPhase } from "./phases";
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
