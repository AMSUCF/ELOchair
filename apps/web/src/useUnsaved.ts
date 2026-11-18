import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserStore,
  clearUnsaved,
  forgetPerson,
  readUnsaved,
  type UnsavedValues,
  writeUnsaved,
} from "./unsaved";

/** How long typing pauses before the buffer is written. Leaving the page writes it at once. */
const DELAY_MS = 400;

/** Counts each person's sign-outs, so that a form still on screen cannot write its buffer back. */
const signOuts = new Map<string, number>();
const signOutsOf = (personId: string | null) => (personId ? (signOuts.get(personId) ?? 0) : 0);

/** On sign-out: remove everything this person left unsaved in this browser. */
export function forgetUnsaved(personId: string) {
  signOuts.set(personId, signOutsOf(personId) + 1);
  forgetPerson(browserStore(), personId);
}

/**
 * A form's unsaved changes, kept in this browser (see unsaved.ts). `found` is what an earlier
 * visit left, read once; the form puts it back and says so. `keep` records the changes as they
 * are now (none removes the buffer). `drop` ends it: the record can no longer be edited.
 */
export function useUnsaved(personId: string | null, scope: string) {
  const [found] = useState(() => (personId ? readUnsaved(browserStore(), personId, scope) : null));
  const pending = useRef<{ version: number | null; values: UnsavedValues } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const signedInAt = useRef(signOutsOf(personId));
  const dropped = useRef(false);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || !personId || dropped.current) return;
    if (signedInAt.current !== signOutsOf(personId)) return;
    writeUnsaved(browserStore(), personId, scope, next.version, next.values);
  }, [personId, scope]);

  const keep = useCallback(
    (values: UnsavedValues, version: number | null) => {
      pending.current = { version, values };
      clearTimeout(timer.current);
      if (Object.keys(values).length === 0) flush();
      else timer.current = setTimeout(flush, DELAY_MS);
    },
    [flush],
  );

  const drop = useCallback(() => {
    dropped.current = true;
    pending.current = null;
    clearTimeout(timer.current);
    if (personId) clearUnsaved(browserStore(), personId, scope);
  }, [personId, scope]);

  // A phone may close a hidden tab without another word: write before that can happen.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return { found, keep, drop };
}
