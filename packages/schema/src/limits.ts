/** Size limits shared by input schemas, validation and the browser. Zod-free. */
export const LIMITS = {
  title: 300,
  fieldText: 10_000,
  fieldItems: 50,
  name: 200,
  affiliation: 300,
  pronouns: 60,
  bio: 5_000,
  query: 200,
  /** Machine keys (types, tracks, topics, custom fields...). */
  key: 64,
  /** Abstract characters allowed per allowed word (checked per type on the server). */
  abstractCharsPerWord: 8,
  abstractCeiling: 40_000,
  /** A conference's own wording of an email (messages.ts), before placeholders are filled. */
  messageSubject: 200,
  messageBody: 5_000,
} as const;

/**
 * Invitations to a role at a conference (spec 03, §1.2): how long a link works, how many emails
 * may go out, and what a reviewer may say they will take. Zod-free, so that the pages can say
 * the same numbers the server enforces.
 */
export const ROLE_INVITATIONS = {
  /** Days an invitation's link works, counted from the last time it was sent. */
  days: 30,
  /** Invitation emails one person may send in 24 hours, resends included, at all conferences. */
  perInviterPerDay: 200,
  /** Invitation emails one address may be sent in 24 hours, resends included, at all conferences. */
  perRecipientPerDay: 3,
  /** Minutes before the same invitation can be sent again. */
  resendMinutes: 60,
  /** The fewest and the most proposals a reviewer may offer to take, and what the form starts at. */
  minLoad: 1,
  maxLoad: 30,
  defaultLoad: 8,
} as const;
