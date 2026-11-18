import type { Issue } from "./api";

/**
 * The catalog key of the message for a rule issue (codes come from packages/schema validation).
 * A number field's range may have one end only, and the validator then sends only that end:
 * each shape has its own sentence, so that none shows an unfilled "{max}".
 */
export function issueMessageKey(issue: Pick<Issue, "code" | "params">): string {
  if (issue.code === "out_of_range") {
    const hasMin = issue.params?.min !== undefined;
    const hasMax = issue.params?.max !== undefined;
    if (hasMin && !hasMax) return "issue_out_of_range_min";
    if (hasMax && !hasMin) return "issue_out_of_range_max";
  }
  return `issue_${issue.code}`;
}
