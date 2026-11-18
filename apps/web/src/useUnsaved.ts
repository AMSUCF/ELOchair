import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserStore,
  clearUnsaved,
  forgetPerson,
  openUnsaved,
  SIGN_OUTS_KEY,
  type UnsavedValues,
} from "./unsaved";

/** How long typing pauses before the buffer is written. Leaving the page writes it at once. */
const DELAY_MS = 400;

/**
 * Sign-outs in this tab. The count every tab shares is kept in the store (unsaved.ts); this one
 * also ends the forms of this tab where the store could not take the new count.
 */
let signOutsHere = 0;

/** On sign-out: remove everything this person left unsaved in this browser, in every tab. */
export function forgetUnsaved(personId: string) {
  signOutsHere += 1;
  forgetPerson(browserStore(), personId);
}

/**
 * A form's unsaved changes, kept in this browser (see unsaved.ts). `found` is what an earlier
 * visit left, read once; the form puts it back and says so. `keep` records the changes as they
 * are now (none removes the buffer), with the saved values they were made on where the record
 * has no versions. `drop` ends it: the record can no longer be edited.
 *
 * A sign-out in this browser, in this tab or any other, ends it too: what is waiting to be
 * written is dropped, and nothing is written after it.
 */
export function useUnsaved(personId: string | null, scope: string) {
  const [buffer] = useState(() => (personId ? openUnsaved(browserStore(), personId, scope) : null));
  const pending = useRef<{
    version: number | null;
    values: UnsavedValues;
    bases?: UnsavedValues;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const signOutsAtStart = useRef(signOutsHere);

  const end = useCallback(() => {
    buffer?.end();
    pending.current = null;
    clearTimeout(timer.current);
  }, [buffer]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (!next || !buffer) return;
    if (signOutsAtStart.current !== signOutsHere) end();
    // The store's count of sign-outs is read again in here, immediately before the write.
    else if (!buffer.write(next.version, next.values, next.bases)) end();
  }, [buffer, end]);

  const drop = useCallback(() => {
    end();
    if (personId) clearUnsaved(browserStore(), personId, scope);
  }, [end, personId, scope]);

  const keep = useCallback(
    (values: UnsavedValues, version: number | null, bases?: UnsavedValues) => {
      pending.current = { version, values, ...(bases ? { bases } : {}) };
      clearTimeout(timer.current);
      if (Object.keys(values).length === 0) flush();
      else timer.current = setTimeout(flush, DELAY_MS);
    },
    [flush],
  );

  // A phone may close a hidden tab without another word: write before that can happen.
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    // Another tab changed the store. If it counted a sign-out (or the store was emptied), what
    // waits here to be written is dropped at once, and not only at the next attempt to write.
    const stored = (event: StorageEvent) => {
      if (event.key !== null && event.key !== SIGN_OUTS_KEY) return;
      if (buffer?.signedOut()) end();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", flush);
    window.addEventListener("storage", stored);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("storage", stored);
      flush();
    };
  }, [buffer, end, flush]);

  return { found: buffer?.found ?? null, keep, drop };
}
