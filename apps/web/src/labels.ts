import type {
  BlindMode,
  CallState,
  ConferenceConfig,
  ConferencePhase,
  ConferenceRole,
  ContributionRole,
  ContributionStatus,
  MailMessageKey,
  MessagePlaceholder,
  ParticipationMode,
  SelfIdKind,
  SubmissionIssue,
  SubmissionStatus,
} from "@elochair/schema";
import type { MessageKey } from "./i18n";

/*
 * Message keys for enumerations. Each helper's return type is MessageKey, so a value without a
 * message in the catalogs (such as a new status) fails the typecheck instead of crashing a page.
 * Never build these keys with a cast.
 */

export const statusKey = (s: SubmissionStatus): MessageKey => `status_${s}`;
export const phaseKey = (p: ConferencePhase): MessageKey => `phase_${p}`;
/** The sentence that says what a phase does, for the chair about to move a conference into it. */
export const phaseDoesKey = (p: ConferencePhase): MessageKey => `phaseDoes_${p}`;
export const roleKey = (r: ContributionRole): MessageKey => `contrib_${r}`;
export const contribStatusKey = (s: ContributionStatus): MessageKey => `contrib_status_${s}`;
export const modeKey = (m: ParticipationMode): MessageKey => `mode_${m}`;
export const modalityKey = (m: ConferenceConfig["modality"]): MessageKey => `modality_${m}`;
export const reviewKey = (b: BlindMode): MessageKey => `review_${b}`;
/** A blind mode as a chair chooses it for a review pool (reviewKey is the sentence for authors). */
export const blindChoiceKey = (b: BlindMode): MessageKey => `settingsBlind_${b}`;
/** The sentence that says a format has a blind mode of its own, whatever its pool's is. */
export const ownModeKey = (b: BlindMode): MessageKey => `settingsPoolOwnMode_${b}`;
/** The name of an email the app sends, as chairs read it on the settings screen. */
export const emailNameKey = (k: MailMessageKey): MessageKey => `settingsEmail_${k}`;
/** The sentence that says when that email is sent, and to whom. */
export const emailWhenKey = (k: MailMessageKey): MessageKey => `settingsEmailWhen_${k}`;
/** What a placeholder of an email stands for. An invitation's link is not a proposal's. */
export const placeholderKey = (k: MailMessageKey, name: MessagePlaceholder): MessageKey =>
  k === "invitation" && name === "link"
    ? "settingsEmailPlaceholder_invitationLink"
    : `settingsEmailPlaceholder_${name}`;
export const selfIdKey = (k: SelfIdKind): MessageKey => `selfId_${k}`;
export const conferenceRoleKey = (r: ConferenceRole): MessageKey => `role_${r}`;
export const deadlineKey = (d: keyof ConferenceConfig["deadlines"]): MessageKey => `deadline_${d}`;

/**
 * Codes a chair sees on a proposal: the validation issues (issueCodes in the chair and metadata
 * projections) plus self-identification, which the server counts separately.
 */
export type IssueCode = SubmissionIssue["code"] | "self_identification";
/** A short label for an issue code, for lists. A code without one fails the typecheck. */
export const issueLabelKey = (c: IssueCode): MessageKey => `issueLabel_${c}`;

/** The chip tone for a conference phase. The chip's text carries the meaning; this only supports it. */
export const phaseTone = (p: ConferencePhase): "good" | "info" | "quiet" =>
  p === "cfp_open" ? "good" : p === "archived" || p === "draft" ? "quiet" : "info";

/** Where a call stands, as the invitation says it: "Call for proposals", "Call opening soon". */
export const callStateKey = (s: CallState): MessageKey => `callState_${s}`;

/** The two things a conference's chip is decided by: its phase, and where its call stands. */
type Standing = { phase: ConferencePhase; callState: CallState };

/** A call that its phase calls open while nobody can submit: before it opens, or after it closes. */
const notOpenYetOrAnyMore = (k: Standing) => k.phase === "cfp_open" && k.callState !== "open";

/**
 * What a conference's chip says. It is the phase's name, except that "Call for proposals open"
 * is said only while the server says the call is open: before the opening date the call is
 * opening soon, and after the closing date submissions are closed.
 */
export const chipKey = (k: Standing): MessageKey =>
  notOpenYetOrAnyMore(k) ? callStateKey(k.callState) : phaseKey(k.phase);

/** The tone that goes with chipKey. */
export const chipTone = (k: Standing): "good" | "info" | "quiet" =>
  notOpenYetOrAnyMore(k) ? (k.callState === "upcoming" ? "info" : "quiet") : phaseTone(k.phase);

/** The chip tone for a contributor's status; the text still says which it is. */
export const contribTone = (s: ContributionStatus): "good" | "warn" | "quiet" =>
  s === "confirmed" ? "good" : s === "invited" ? "warn" : "quiet";
