import { useEffect, useRef } from "react";
import type { Issue } from "./api";
import { isMessageKey, useT } from "./i18n";

/**
 * A typed or pasted name as it is sent. Pasting often brings invisible format characters along
 * (direction marks, zero-width spaces, soft hyphens, byte-order marks); they are removed, except
 * the zero-width (non-)joiners some scripts are spelled with. Then outer spaces go. The server
 * still decides what it accepts; this only spares people a refusal for something they cannot see.
 */
export const cleanName = (typed: string) =>
  typed
    .replace(/(?![\u200C\u200D])\p{Cf}/gu, "")
    .replace(/^[\s\u200C\u200D]+|[\s\u200C\u200D]+$/gu, "");

/**
 * Why the server refused the name in an invitation answer: missing (422, code "required"), or
 * given but not accepted (400 from input validation: invisible characters, no letter or digit,
 * too long). Null when the name was not the problem.
 */
export function nameRefusal(issues: Issue[]): "required" | "invalid" | null {
  const issue = issues.find((i) => i.path === "displayName");
  if (!issue) return null;
  return issue.code === "required" ? "required" : "invalid";
}

/** The DOM id of the control for an issue path ("fields.needs" → "field-fields-needs"). */
export const fieldId = (path: string) => `field-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;

/** A localized message for a rule issue (codes come from packages/schema validation). */
export function useIssueText() {
  const { t } = useT();
  return (issue: Issue) => {
    const key = `issue_${issue.code}`;
    return isMessageKey(key) ? t(key, issue.params) : t("issue_generic");
  };
}

/**
 * The GOV.UK-style error summary: a titled list of links to the fields with problems. It takes
 * focus when it appears so screen reader and keyboard users hear what to fix.
 */
export function ErrorSummary({ issues, title }: { issues: Issue[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const text = useIssueText();
  useEffect(() => {
    if (issues.length) ref.current?.focus();
  }, [issues]);
  if (!issues.length) return null;
  return (
    <div
      className="error-summary"
      role="alert"
      tabIndex={-1}
      ref={ref}
      aria-labelledby="error-summary-title"
    >
      <h2 id="error-summary-title">{title}</h2>
      <ul>
        {issues.map((i) => (
          <li key={`${i.path}-${i.code}`}>
            <a
              href={`#${fieldId(i.path)}`}
              onClick={(e) => {
                const el = document.getElementById(fieldId(i.path));
                if (el) {
                  e.preventDefault();
                  el.focus();
                }
              }}
            >
              {text(i)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inline error under a field, linked with aria-describedby. */
export function FieldError({ path, issues }: { path: string; issues: Issue[] }) {
  const text = useIssueText();
  const mine = issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
  if (!mine.length) return null;
  return (
    <p className="field-error" id={`${fieldId(path)}-error`}>
      {mine.map(text).join(" ")}
    </p>
  );
}

export const describedBy = (path: string, issues: Issue[], ...more: string[]) =>
  [...more, issues.some((i) => i.path === path) ? `${fieldId(path)}-error` : ""]
    .filter(Boolean)
    .join(" ") || undefined;
