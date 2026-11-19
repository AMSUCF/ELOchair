import { removeStrayInvisible } from "@elochair/schema/pure";
import { useEffect, useRef } from "react";
import type { Issue } from "./api";
import { isMessageKey, useT } from "./i18n";
import { issueMessageKey } from "./issues";

/**
 * A typed or pasted name as it is sent. Pasting often brings invisible format characters along
 * (direction marks, zero-width spaces, soft hyphens, byte-order marks); they are removed, except
 * joiners inside words and emoji and the standard subdivision flags, which the server accepts
 * too (removeStrayInvisible). Then outer spaces go; a joiner the server keeps (after an Indic
 * virama, as in legacy Malayalam chillus) stays. The server
 * still decides what it accepts; this only spares people a refusal for something they cannot see.
 */
export const cleanName = (typed: string) => removeStrayInvisible(typed).trim();

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
    const key = issueMessageKey(issue);
    return isMessageKey(key) ? t(key, issue.params) : t("issue_generic");
  };
}

/**
 * The GOV.UK-style error summary: a titled list of links to the fields with problems. It takes
 * focus when it appears so screen reader and keyboard users hear what to fix.
 */
export function ErrorSummary({
  issues,
  title,
  where,
}: {
  issues: Issue[];
  title: string;
  /** On a long form: the name of the value at a path, said before its message. */
  where?: (path: string) => string | undefined;
}) {
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
              {where?.(i.path) ? `${where(i.path)}: ${text(i)}` : text(i)}
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

/**
 * Says that unsaved changes kept in this browser (see unsaved.ts) are back in the form, and
 * offers to discard them. The outer element is always rendered, so that the notice is announced
 * when it appears: show it after the first render, not with it.
 */
export function RestoredNotice({
  shown,
  disabled = false,
  onDiscard,
}: {
  shown: boolean;
  disabled?: boolean;
  onDiscard: () => void;
}) {
  const { t } = useT();
  return (
    <div className="restored" aria-live="polite">
      {shown && (
        <div className="notice stack wide">
          <p>{t("unsavedRestored")}</p>
          <button type="button" className="secondary" disabled={disabled} onClick={onDiscard}>
            {t("unsavedDiscard")}
          </button>
        </div>
      )}
    </div>
  );
}
