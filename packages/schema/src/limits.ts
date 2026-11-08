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
  /** Abstract characters allowed per allowed word (checked per type on the server). */
  abstractCharsPerWord: 8,
  abstractCeiling: 40_000,
} as const;
