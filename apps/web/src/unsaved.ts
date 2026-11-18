/**
 * Unsaved text, kept in this browser so that a reload, a crashed tab or a phone that closes the
 * browser does not lose it. The server stays the source of truth: a buffer holds only what its
 * owner typed and has not saved yet.
 *
 * Buffers are unpublished work and personal data, possibly on a shared computer:
 * - each is kept under the signed-in person's id, so another account never sees it;
 * - it goes on save, on discard and on sign-out, and expires after 30 days;
 * - a person's sign-out ends that person's buffers in every tab, not only in the tab it
 *   happened in, and nobody else's (signOutsOf);
 * - it holds what this person typed, never data the server sent about other people.
 *
 * One thing outlasts a sign-out: a count of that person's sign-outs with the time of the last,
 * kept under the person's id. It is how a form still open in another tab learns of the
 * sign-out. It holds an opaque id and numbers, no text, and it goes 30 days after that person
 * last signed out of this browser or opened a form in it (expireUnsaved).
 *
 * Storage that is missing, full or blocked is never an error: the form works without a buffer.
 */

/** What a form control can hold. `null` records that a value was cleared. */
export type UnsavedValue = string | number | boolean | string[] | null;
/** Form path ("title", "fields.needs", "bios.es") → the unsaved value there. */
export type UnsavedValues = Record<string, UnsavedValue>;

export type Unsaved = {
  /** The server's version the changes were made on; null where records have no versions. */
  version: number | null;
  /** When the buffer was written, in milliseconds since the epoch. */
  at: number;
  values: UnsavedValues;
  /**
   * Where records have no versions (the profile): the saved value each change was made on, by
   * the same paths. A change whose saved value has changed since is not put back silently (see
   * sortUnsaved).
   */
  bases?: UnsavedValues;
};

/** The part of `Storage` used here, so that tests can pass their own. */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The trailing number is the format: a later format ignores these keys instead of misreading them. */
const PREFIX = "elochair:unsaved:1:";
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Where the browser counts sign-outs: one key for each person, so that one person's sign-out
 * says nothing about anyone else's forms. The prefix is not the buffers': a person's buffers go
 * by their prefix on sign-out, and the count has to stay.
 */
const SIGN_OUTS_PREFIX = "elochair:sign-outs:1:";
/** The key of a person's count. A tab hears of a write to it by another tab (the storage event). */
export const signOutsKey = (personId: string) =>
  `${SIGN_OUTS_PREFIX}${encodeURIComponent(personId)}`;
/** Beside a count: when a form was last opened under it (see expireSignOuts). No id holds ":". */
const SEEN = ":seen";

const personPrefix = (personId: string) => `${PREFIX}${encodeURIComponent(personId)}:`;
const keyOf = (personId: string, scope: string) => `${personPrefix(personId)}${scope}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The browser's own storage, or null where it is switched off or blocked (private windows). */
export function browserStore(): Store | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const isValue = (v: unknown): v is UnsavedValue =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v)) ||
  (Array.isArray(v) && v.every((x) => typeof x === "string"));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A stored buffer, or null when it is not one (edited by hand, cut short, another format). */
function parse(raw: string | null): Unsaved | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { version, at, values, bases } = data;
  if (version !== null && !Number.isSafeInteger(version)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (!isRecord(values)) return null;
  const entries = Object.entries(values);
  if (entries.length === 0 || !entries.every(([, v]) => isValue(v))) return null;
  const found: Unsaved = {
    version: version as number | null,
    at,
    values: Object.fromEntries(entries) as UnsavedValues,
  };
  if (bases === undefined) return found;
  // A base belongs to a change: one for a path that has no change is not ours.
  if (!isRecord(bases)) return null;
  const based = Object.entries(bases);
  if (!based.every(([path, v]) => Object.hasOwn(values, path) && isValue(v))) return null;
  return { ...found, bases: Object.fromEntries(based) as UnsavedValues };
}

const expired = (found: Unsaved, now: number) => now - found.at > MAX_AGE_MS;

/** A person's sign-outs in this browser: how many, and when the last one was. */
export type SignOuts = { count: number; at: number };

/** A stored count, or null when it is not one (nothing yet, or a key somebody edited). */
function parseSignOuts(raw: string | null): SignOuts | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { count, at } = data;
  if (!Number.isSafeInteger(count) || (count as number) < 1) return null;
  if (!Number.isSafeInteger(at) || (at as number) < 0) return null;
  return { count: count as number, at: at as number };
}

/**
 * This person's sign-outs in this browser, or null when it has none on record. A form remembers
 * what it opened under and writes nothing once that has moved: the store is shared by every
 * tab, so a sign-out in one tab reaches that person's forms in the others. Only that person's:
 * someone else signing out of the same browser moves another count. Anything that is not a
 * count (a blocked store, a key somebody edited) reads as none.
 */
export function signOutsOf(store: Store | null, personId: string): SignOuts | null {
  if (!store) return null;
  try {
    return parseSignOuts(store.getItem(signOutsKey(personId)));
  } catch {
    return null;
  }
}

/** How many times this person has signed out of this browser, as far as it has on record. */
export const signOutCount = (store: Store | null, personId: string): number =>
  signOutsOf(store, personId)?.count ?? 0;

/** Whether a person's sign-outs are no longer what a form opened under. */
const moved = (now: SignOuts | null, since: SignOuts | null) =>
  now?.count !== since?.count || now?.at !== since?.at;

/** Count one more sign-out of this person. False when the store refused it (it is full). */
function countSignOut(store: Store, personId: string, now: number): boolean {
  try {
    const next: SignOuts = { count: signOutCount(store, personId) + 1, at: now };
    store.setItem(signOutsKey(personId), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/**
 * Note that a form was opened under this person's count now. Its own key, written without
 * reading: the count itself is only ever written by a sign-out, so no note can undo one.
 */
function markSeen(store: Store, personId: string, now: number): void {
  try {
    store.setItem(`${signOutsKey(personId)}${SEEN}`, String(now));
  } catch {
    // Full or blocked: the count may go early, which can only end a form, never keep one going.
  }
}

/** What this person left unsaved in `scope`. A buffer that is malformed or too old is removed. */
export function readUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  now = Date.now(),
): Unsaved | null {
  if (!store) return null;
  try {
    const key = keyOf(personId, scope);
    const raw = store.getItem(key);
    if (raw === null) return null;
    const found = parse(raw);
    if (found && !expired(found, now)) return found;
    store.removeItem(key);
  } catch {
    // Blocked storage: there is nothing to restore.
  }
  return null;
}

/**
 * Keep `values` as this person's unsaved changes in `scope`; none left removes the buffer.
 *
 * `since` is what this person's sign-outs were when the form opened (signOutsOf; null for none).
 * Once they have moved, nothing is written and the answer is false: this person signed out of
 * this browser, and the form must stop keeping text. They are read just before the write and
 * again just after it, and a buffer that a sign-out overtook is taken out again: two tabs
 * cannot lock the store between them. Without `since` (not a form) nothing is watched.
 */
export function writeUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  version: number | null,
  values: UnsavedValues,
  now = Date.now(),
  more: { since?: SignOuts | null; bases?: UnsavedValues } = {},
): boolean {
  if (!store) return true;
  const { since, bases } = more;
  const signedOut = () => since !== undefined && moved(signOutsOf(store, personId), since);
  if (signedOut()) return false;
  try {
    const key = keyOf(personId, scope);
    if (Object.keys(values).length === 0) {
      store.removeItem(key);
      return true;
    }
    // Unchanged since it was written (the page was only opened again): its age stays.
    const before = parse(store.getItem(key));
    if (
      before &&
      before.version === version &&
      same(before.values, values) &&
      same(before.bases, bases)
    ) {
      return true;
    }
    const next: Unsaved = { version, at: now, values, ...(bases ? { bases } : {}) };
    store.setItem(key, JSON.stringify(next));
    if (signedOut()) {
      store.removeItem(key);
      return false;
    }
  } catch {
    // Full or blocked storage: the form goes on without a buffer.
  }
  return true;
}

export function clearUnsaved(store: Store | null, personId: string, scope: string): void {
  if (!store) return;
  try {
    store.removeItem(keyOf(personId, scope));
  } catch {
    // Blocked storage: nothing was kept.
  }
}

/** Every key of ours that starts with `prefix`. Collected first: removing shifts the indexes. */
function keysWith(store: Store, prefix: string): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

/**
 * On sign-out: count it for this person, and remove everything this person left unsaved in this
 * browser. The count comes first, so that from then on no form of theirs still open in another
 * tab writes its text back (writeUnsaved). A full store may refuse the count until the buffers
 * are gone: it is then counted afterwards, and the buffers are removed once more for a write
 * that came in between. Nobody else's count or buffers are touched.
 */
export function forgetPerson(store: Store | null, personId: string, now = Date.now()): void {
  if (!store) return;
  const remove = () => {
    try {
      for (const key of keysWith(store, personPrefix(personId))) store.removeItem(key);
    } catch {
      // Blocked storage: nothing was kept.
    }
  };
  const counted = countSignOut(store, personId, now);
  remove();
  if (!counted && countSignOut(store, personId, now)) remove();
}

/**
 * One form's buffer for as long as the form is open: what an earlier visit left (`found`), and
 * the writing of what is unsaved now. It ends, for good, when its person signs out of this
 * browser (in any tab), when the store is emptied, or when the form says its record can no
 * longer be edited. Someone else's sign-out does not end it. Once ended it writes nothing. The
 * page wraps this in useUnsaved.
 */
export function openUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  now = Date.now(),
) {
  // Read together: the buffer, and the sign-outs it is read under.
  const since = signOutsOf(store, personId);
  // A count with a form open under it is in use: it does not go while that form may write.
  if (store && since) markSeen(store, personId, now);
  const found = readUnsaved(store, personId, scope, now);
  let ended = false;
  const signedOut = () => moved(signOutsOf(store, personId), since);
  return {
    found,
    /** Keep the changes as they are now (none removes the buffer). False once the buffer has ended. */
    write(
      version: number | null,
      values: UnsavedValues,
      bases?: UnsavedValues,
      at = Date.now(),
    ): boolean {
      if (ended) return false;
      // A count is kept for 30 days (expireSignOuts). A form open for longer could have missed
      // a sign-out whose count is gone again, so it stops there, as its buffer would.
      const tooOld = store !== null && at - now > MAX_AGE_MS;
      if (tooOld || !writeUnsaved(store, personId, scope, version, values, at, { since, bases })) {
        ended = true;
      }
      return !ended;
    },
    /** Has a sign-out of this person, in any tab, ended this buffer? */
    signedOut(): boolean {
      if (!ended && signedOut()) ended = true;
      return ended;
    },
    /**
     * Told that another tab changed the store under `key` (null when it emptied the store): has
     * that ended this buffer? An emptied store ends it, whoever emptied it: nothing goes back
     * into it from a form that was open. So does a sign-out of this person. Nothing else does,
     * another person's sign-out included.
     */
    changedElsewhere(key: string | null): boolean {
      if (!ended && (key === null || (key === signOutsKey(personId) && signedOut()))) {
        ended = true;
      }
      return ended;
    },
    /** The record can no longer be edited, or this tab signed out: nothing more is written. */
    end(): void {
      ended = true;
    },
  };
}

export type OpenUnsaved = ReturnType<typeof openUnsaved>;

/** What became of the changes in a buffer, set against what is saved now. */
export type SortedUnsaved = {
  /** Made on the value that is still the saved one: these go back into the form. */
  restore: UnsavedValues;
  /** The saved value has changed since: the person chooses between theirs and the saved one. */
  conflicts: Record<string, { mine: UnsavedValue; base: UnsavedValue }>;
};

/**
 * For records without versions: sort a buffer's changes by what is saved now (`saved`, by the
 * same paths). A change is put back only when the saved value is still the one it was made on.
 * When the saved value has changed since (another device saved in between), the change is a
 * conflict, never an overlay. A change equal to what is saved now is done with; one without a
 * recorded base, or for a path that is no longer there, is left out.
 */
export function sortUnsaved(found: Unsaved | null, saved: UnsavedValues): SortedUnsaved {
  const sorted: SortedUnsaved = { restore: {}, conflicts: {} };
  if (!found) return sorted;
  for (const [path, mine] of Object.entries(found.values)) {
    if (!Object.hasOwn(saved, path) || !found.bases || !Object.hasOwn(found.bases, path)) continue;
    const base = found.bases[path] as UnsavedValue;
    if (same(mine, saved[path])) continue;
    if (same(base, saved[path])) sorted.restore[path] = mine;
    else sorted.conflicts[path] = { mine, base };
  }
  return sorted;
}

/**
 * A person's count goes 30 days after that person last signed out of this browser or opened a
 * form in it, whichever is later, and so does anything under the counts' prefix that is not a
 * count. That is as long as a buffer lives, and as long as an open form writes (openUnsaved):
 * a form that could still write was opened, and so noted, within those 30 days, and its count
 * stays. A time ahead of the clock (it was wrong when the time was written) is not one to
 * count from: the count is noted as seen now, and goes 30 days from now. A count is never
 * rewritten here, only removed.
 */
function expireSignOuts(store: Store, now: number): void {
  for (const key of keysWith(store, SIGN_OUTS_PREFIX)) {
    if (key.endsWith(SEEN)) {
      // A note of a form opened under a count that is gone notes nothing.
      if (store.getItem(key.slice(0, -SEEN.length)) === null) store.removeItem(key);
      continue;
    }
    const raw = store.getItem(key);
    const counted = parseSignOuts(raw);
    if (counted) {
      const seenRaw = store.getItem(`${key}${SEEN}`);
      let seen = seenRaw !== null && /^\d{1,15}$/.test(seenRaw) ? Number(seenRaw) : null;
      if ((seen ?? counted.at) > now) {
        seen = now;
        store.setItem(`${key}${SEEN}`, String(now));
      }
      const last = Math.max(counted.at > now ? 0 : counted.at, seen ?? 0);
      if (now - last <= MAX_AGE_MS) continue;
    }
    // Only what was just read: a sign-out that another tab counts in this instant stays.
    if (store.getItem(key) === raw) store.removeItem(key);
    store.removeItem(`${key}${SEEN}`);
  }
}

/**
 * When the app starts: remove buffers older than 30 days, and anything under our prefix that is
 * not a buffer. A time in the future (the clock was wrong when it was written) counts from now.
 * Then the counts of sign-outs that are no longer needed (expireSignOuts).
 */
export function expireUnsaved(store: Store | null, now = Date.now()): void {
  if (!store) return;
  try {
    for (const key of keysWith(store, PREFIX)) {
      const found = parse(store.getItem(key));
      if (!found || expired(found, now)) store.removeItem(key);
      else if (found.at > now) store.setItem(key, JSON.stringify({ ...found, at: now }));
    }
    expireSignOuts(store, now);
  } catch {
    // Blocked storage: nothing was kept.
  }
}
