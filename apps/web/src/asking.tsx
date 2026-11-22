import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useT } from "./i18n";

/*
 * What the chairs' pages share when a press changes something (the People page, and the
 * reviewers of a proposal): a status line that says, where it was done, what was done; and a
 * question asked in place of the button that was pressed, which says what would happen.
 */

export type Said = {
  ref: RefObject<HTMLParagraphElement | null>;
  text: string;
  /** Say what happened in this part of the page; the line takes focus once it shows. */
  say: (text: string) => void;
};

/** One status line: what was last done in a part of the page, said where it was done. */
export function useSaid(): Said {
  const ref = useRef<HTMLParagraphElement>(null);
  // Counted, so that the same sentence said twice is still said (and focused) twice.
  const [said, setSaid] = useState({ text: "", n: 0 });
  const focus = useRef(false);
  // After every render: the line can take focus only once it holds the new text.
  useEffect(() => {
    if (!focus.current) return;
    focus.current = false;
    ref.current?.focus();
  });
  const say = useCallback((text: string) => {
    focus.current = text !== "";
    setSaid((was) => ({ text, n: was.n + 1 }));
  }, []);
  return { ref, text: said.text, say };
}

export function StatusLine({ said }: { said: Said }) {
  return (
    <p className="status-line" role="status" tabIndex={-1} ref={said.ref}>
      {said.text}
    </p>
  );
}

/** A confirmation that is open: which button opened it, to give focus back if it is dismissed. */
export type Asking = { key: string; opener: string } | null;

export type Outcome = { ok: true } | { ok: false; keep: boolean; text: string };

/**
 * A question asked in place of the button that was pressed: what would happen, "yes" and "no".
 * Its heading takes focus when it opens. What goes wrong while it stays open is said under it.
 */
export function Ask({
  level: Heading,
  question,
  yes,
  busy,
  note,
  onYes,
  onNo,
  children,
}: {
  level: "h3" | "h4";
  question: string;
  yes: string;
  busy: boolean;
  note: string;
  onYes: () => void;
  onNo: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  function confirm(e: FormEvent) {
    e.preventDefault();
    onYes();
  }
  return (
    <form className="confirm" onSubmit={confirm} noValidate>
      <Heading tabIndex={-1} ref={ref}>
        {question}
      </Heading>
      {children}
      <p className="actions">
        {/* aria-disabled while the request is on its way, so focus stays on the button. */}
        <button type="submit" aria-disabled={busy ? "true" : undefined}>
          {yes}
        </button>
        <button
          type="button"
          className="secondary"
          aria-disabled={busy ? "true" : undefined}
          onClick={onNo}
        >
          {t("peopleGoBack")}
        </button>
      </p>
      <p className="status-line" role="status">
        {note}
      </p>
    </form>
  );
}
