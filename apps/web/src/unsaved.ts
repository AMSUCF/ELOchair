/**
 * Unsaved text, kept in this browser so that a reload, a crashed tab or a phone that closes the
 * browser does not lose it. The server stays the source of truth: a buffer holds only what its
 * owner typed and has not saved yet.
 *
 * Buffers are unpublished work and personal data, possibly on a shared computer:
 * - each is kept under the signed-in person's id, so another account never sees it;
 * - it goes on save, on discard and on sign-out, and expires after 30 days;
 * - a sign-out ends the buffers of every tab, not only of the tab it happened in (signOutCount);
 * - it holds what this person typed, never data the server sent about other people.
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
 * Where the browser counts sign-outs. One key for the whole app: it names nobody and holds no
 * text, only a number that every tab can read.
 */
export const SIGN_OUTS_KEY = "elochair:sign-outs";

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

/**
 * How many sign-outs this browser has counted. A form remembers the count it opened with and
 * writes nothing once the count has moved: the store is shared by every tab, so a sign-out in
 * one tab reaches the forms that are still open in the others. Anything that is not a count
 * (nothing yet, a blocked store, a key somebody edited) reads as 0.
 */
export function signOutCount(store: Store | null): number {
  if (!store) return 0;
  try {
    const raw = store.getItem(SIGN_OUTS_KEY);
    return raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

/** Count one more sign-out. False when the store refused the new count (it is full). */
function countSignOut(store: Store): boolean {
  try {
    store.setItem(SIGN_OUTS_KEY, String(signOutCount(store) + 1));
    return true;
  } catch {
    return false;
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
 * `since` is the sign-out count the form opened with (signOutCount). Once the count has moved,
 * nothing is written and the answer is false: someone signed out in this browser, and the form
 * must stop keeping text. The count is read just before the write and again just after it, and a
 * buffer that a sign-out overtook is taken out again: two tabs cannot lock the store between them.
 */
export function writeUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  version: number | null,
  values: UnsavedValues,
  now = Date.now(),
  more: { since?: number; bases?: UnsavedValues } = {},
): boolean {
  if (!store) return true;
  const { since, bases } = more;
  const signedOut = () => since !== undefined && signOutCount(store) !== since;
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
 * On sign-out: count it, and remove everything this person left unsaved in this browser. The
 * count comes first, so that from then on no form still open in another tab writes its text
 * back (writeUnsaved). A full store may refuse the count until the buffers are gone: it is then
 * counted afterwards, and the buffers are removed once more for a write that came in between.
 */
export function forgetPerson(store: Store | null, personId: string): void {
  if (!store) return;
  const remove = () => {
    try {
      for (const key of keysWith(store, personPrefix(personId))) store.removeItem(key);
    } catch {
      // Blocked storage: nothing was kept.
    }
  };
  const counted = countSignOut(store);
  remove();
  if (!counted && countSignOut(store)) remove();
}

/**
 * One form's buffer for as long as the form is open: what an earlier visit left (`found`), and
 * the writing of what is unsaved now. It ends, for good, when someone signs out in this browser
 * (in any tab) or when the form says its record can no longer be edited. Once ended it writes
 * nothing. The page wraps this in useUnsaved.
 */
export function openUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  now = Date.now(),
) {
  // Read together: the buffer, and the sign-out count it is read under.
  const since = signOutCount(store);
  const found = readUnsaved(store, personId, scope, now);
  let ended = false;
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
      if (!writeUnsaved(store, personId, scope, version, values, at, { since, bases })) {
        ended = true;
      }
      return !ended;
    },
    /** Asked when the store changed under another tab: has a sign-out ended this buffer? */
    signedOut(): boolean {
      if (!ended && signOutCount(store) !== since) ended = true;
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
 * When the app starts: remove buffers older than 30 days, and anything under our prefix that is
 * not a buffer. A time in the future (the clock was wrong when it was written) counts from now.
 */
export function expireUnsaved(store: Store | null, now = Date.now()): void {
  if (!store) return;
  try {
    for (const key of keysWith(store, PREFIX)) {
      const found = parse(store.getItem(key));
      if (!found || expired(found, now)) store.removeItem(key);
      else if (found.at > now) store.setItem(key, JSON.stringify({ ...found, at: now }));
    }
  } catch {
    // Blocked storage: nothing was kept.
  }
}
