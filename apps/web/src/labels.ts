import type {
  BlindMode,
  ConferenceConfig,
  ConferencePhase,
  ConferenceRole,
  ContributionRole,
  ContributionStatus,
  ParticipationMode,
  SelfIdKind,
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
export const roleKey = (r: ContributionRole): MessageKey => `contrib_${r}`;
export const contribStatusKey = (s: ContributionStatus): MessageKey => `contrib_status_${s}`;
export const modeKey = (m: ParticipationMode): MessageKey => `mode_${m}`;
export const modalityKey = (m: ConferenceConfig["modality"]): MessageKey => `modality_${m}`;
export const reviewKey = (b: BlindMode): MessageKey => `review_${b}`;
export const selfIdKey = (k: SelfIdKind): MessageKey => `selfId_${k}`;
export const conferenceRoleKey = (r: ConferenceRole): MessageKey => `role_${r}`;
export const deadlineKey = (d: keyof ConferenceConfig["deadlines"]): MessageKey => `deadline_${d}`;
