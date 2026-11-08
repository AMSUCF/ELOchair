import type { BlindMode, ConferenceConfig, SubmissionType } from "./config";

/* Zod-free lookups over a parsed configuration; safe to import in the browser bundle. */

export function findType(config: ConferenceConfig, typeKey: string): SubmissionType | undefined {
  return config.submissionTypes.find((t) => t.key === typeKey);
}

/** The blind mode that applies to a submission type: the type's override, else its pool's. */
export function effectiveBlindMode(config: ConferenceConfig, typeKey: string): BlindMode {
  const type = findType(config, typeKey);
  if (!type) return "double"; // unknown types fail closed
  if (type.blindMode) return type.blindMode;
  return config.reviewPools.find((p) => p.key === type.reviewPool)?.blindMode ?? "double";
}
