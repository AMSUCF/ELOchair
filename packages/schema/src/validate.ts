import { type ConferenceConfig, type CustomField, findType } from "./config";
import type { Contribution, FieldValue, Submission } from "./domain";
import { countWords } from "./words";

export type SubmissionIssue = {
  path: string;
  code:
    | "unknown_type"
    | "unknown_track"
    | "unknown_topic"
    | "too_few_words"
    | "too_many_words"
    | "required"
    | "wrong_kind"
    | "unknown_option"
    | "team_size"
    | "no_lead"
    | "empty_title";
  params?: Record<string, string | number>;
};

const isUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};

function checkField(f: CustomField, v: FieldValue | undefined, lang: string): SubmissionIssue[] {
  const path = `fields.${f.key}`;
  // A required checkbox (consent, licence) must be ticked; an unticked optional one is fine.
  if (f.kind === "boolean") {
    if (v === undefined || v === false) return f.required ? [{ path, code: "required" }] : [];
    return typeof v === "boolean" ? [] : [{ path, code: "wrong_kind" }];
  }
  const empty =
    v === undefined ||
    (typeof v === "string" && v.trim() === "") ||
    (Array.isArray(v) && v.length === 0);
  if (empty) return f.required ? [{ path, code: "required" }] : [];

  const options = new Set(f.options?.map((o) => o.key));
  switch (f.kind) {
    case "text":
    case "longtext": {
      if (typeof v !== "string") return [{ path, code: "wrong_kind" }];
      const n = countWords(v, lang);
      if (f.maxWords && n > f.maxWords) {
        return [{ path, code: "too_many_words", params: { count: n, max: f.maxWords } }];
      }
      return [];
    }
    case "url":
      return typeof v === "string" && isUrl(v) ? [] : [{ path, code: "wrong_kind" }];
    case "select":
      if (typeof v !== "string") return [{ path, code: "wrong_kind" }];
      return options.has(v) ? [] : [{ path, code: "unknown_option" }];
    case "multiselect":
      if (!Array.isArray(v)) return [{ path, code: "wrong_kind" }];
      return v.every((x) => options.has(x)) ? [] : [{ path, code: "unknown_option" }];
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? [] : [{ path, code: "wrong_kind" }];
  }
}

/**
 * Check a submission against its type's rules. Returns machine-readable issues; the UI turns
 * codes into localized messages. An empty array means the submission can be submitted.
 */
export function validateSubmission(
  config: ConferenceConfig,
  submission: Pick<
    Submission,
    "typeKey" | "trackKey" | "topicKeys" | "language" | "title" | "abstract" | "fields"
  >,
  contributions: Pick<Contribution, "role">[],
): SubmissionIssue[] {
  const type = findType(config, submission.typeKey);
  if (!type) return [{ path: "typeKey", code: "unknown_type" }];

  const issues: SubmissionIssue[] = [];
  if (!submission.title.trim()) issues.push({ path: "title", code: "empty_title" });

  if (submission.trackKey && !config.tracks.some((t) => t.key === submission.trackKey)) {
    issues.push({ path: "trackKey", code: "unknown_track" });
  }
  const topics = new Set(config.topics.map((t) => t.key));
  submission.topicKeys.forEach((k, i) => {
    if (!topics.has(k)) issues.push({ path: `topicKeys.${i}`, code: "unknown_topic" });
  });

  const words = countWords(submission.abstract, submission.language);
  if (words < type.abstract.minWords) {
    issues.push({
      path: "abstract",
      code: "too_few_words",
      params: { count: words, min: type.abstract.minWords },
    });
  }
  if (words > type.abstract.maxWords) {
    issues.push({
      path: "abstract",
      code: "too_many_words",
      params: { count: words, max: type.abstract.maxWords },
    });
  }

  for (const f of type.fields) {
    issues.push(...checkField(f, submission.fields[f.key], submission.language));
  }

  const n = contributions.length;
  if (n < type.team.min || n > type.team.max) {
    issues.push({
      path: "contributions",
      code: "team_size",
      params: { count: n, min: type.team.min, max: type.team.max },
    });
  }
  if (!contributions.some((c) => c.role === "lead")) {
    issues.push({ path: "contributions", code: "no_lead" });
  }
  return issues;
}
