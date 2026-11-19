/**
 * Unsaved text, kept in this browser so that a reload, a crashed tab or a phone that closes the
 * browser does not lose it. The server stays the source of truth: a buffer holds only what its
 * owner typed and has not saved yet.
 *
 * Buffers are unpublished work and personal data, possibly on a shared computer:
 * - each is kept under the signed-in person's id, so another account never sees it;
 * - it goes on save, on discard and on sign-out, and expires after 30 days;
 * - a person's sign-out ends that person's buffers in every tab, not only in the tab it
 *   happened in, and nobody else's (the person's token, below);
 * - it holds what this person typed, never data the server sent about other people.
 *
 * Each person has a token in this browser, kept under the person's id beside the time it was
 * made. A form opens under the token it finds there, or makes one, and writes only while the
 * store still holds that very token (tokenOf). The person's sign-out puts a new token in its
 * place, and that ends every form of theirs that is open, in any tab.
 * - No clock takes part in that. A token that is missing, malformed or another one ends the
 *   form, for good, whatever the time is.
 * - The only token ever written is a new, random one. One that is there is never written again,
 *   time and all, so that no write can put back a token that a sign-out has just replaced.
 *
 * The token outlasts a sign-out. It holds an opaque id, random digits and a time, no text, and
 * it goes 30 days after it was made, unless that person still has unsaved text here
 * (expireUnsaved). Its going can only stop a form, never let one write: a form that held no
 * unsaved text then keeps none from then on, and the next form that person opens makes a new
 * token.
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
 * Where each person's token is kept: one key for each person, so that one person's sign-out
 * says nothing about anyone else's forms. The prefix is not the buffers': a person's buffers go
 * by their prefix on sign-out, and the token has to stay.
 */
const TOKENS_PREFIX = "elochair:sign-outs:1:";
/** The key of a person's token. A tab hears of a write to it by another tab (the storage event). */
export const tokenKey = (personId: string) => `${TOKENS_PREFIX}${encodeURIComponent(personId)}`;
/** A token's time this far ahead of the clock is two tabs a moment apart, not a wrong clock. */
const AHEAD_MS = 5 * 60 * 1000;

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

/** A person's token as the store holds it: `<32 hex digits>:<when it was made>`. */
const TOKEN = /^([0-9a-f]{32}):(\d{1,15})$/;

/** A stored token, or null when it is not one (nothing there, or a key somebody edited). */
function parseToken(raw: string | null): { token: string; at: number } | null {
  const found = raw === null ? null : TOKEN.exec(raw);
  return found ? { token: found[1] as string, at: Number(found[2]) } : null;
}

/**
 * A new token: 16 random bytes, as 32 hex digits. Random, and never a count: a count that is
 * made anew after the old one went could come to the very number an old form still holds, and
 * that form would write again.
 */
function newToken(): string {
  const bytes = new Uint8Array(16);
  const random: Crypto | undefined = globalThis.crypto;
  if (typeof random?.getRandomValues === "function") random.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The token this person's forms are open under in this browser, or null when there is none to
 * read: none yet, a blocked store, or something under the key that is not a token. A form
 * remembers the one it opened under and writes nothing once the store holds anything else: the
 * store is shared by every tab, so a sign-out in one tab reaches that person's forms in the
 * others. Only that person's: someone else signing out of the same browser replaces another
 * token.
 */
export function tokenOf(store: Store | null, personId: string): string | null {
  if (!store) return null;
  try {
    return parseToken(store.getItem(tokenKey(personId)))?.token ?? null;
  } catch {
    return null;
  }
}

/** Put a new token in the place of this person's. Null when the store refused it (it is full). */
function renewToken(store: Store, personId: string, now: number): string | null {
  const token = newToken();
  try {
    store.setItem(tokenKey(personId), `${token}:${now}`);
    return token;
  } catch {
    return null;
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
 * `token` is the one the form opened under (openUnsaved). Once the store holds anything else
 * for this person, nothing is written and the answer is false: this person signed out of this
 * browser, or the token went, and the form must stop keeping text. The token is read just
 * before the write and again just after it, and a buffer that a sign-out overtook is taken out
 * again: two tabs cannot lock the store between them. Without `token` (not a form) nothing is
 * watched.
 */
export function writeUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  version: number | null,
  values: UnsavedValues,
  now = Date.now(),
  more: { token?: string; bases?: UnsavedValues } = {},
): boolean {
  if (!store) return true;
  const { token, bases } = more;
  const replaced = () => token !== undefined && tokenOf(store, personId) !== token;
  if (replaced()) return false;
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
    if (replaced()) {
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
 * On sign-out: remove everything this person left unsaved in this browser, and put a new token
 * in the place of theirs, so that from then on no form of theirs still open in another tab
 * writes its text back (writeUnsaved). The buffers go first, which makes room for the token in
 * a full store. If the store refuses the token all the same, theirs is removed instead: that
 * needs no room, and ends those forms as well. Then the buffers go once more, for a write that
 * came in between. Nobody else's token or buffers are touched.
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
  remove();
  if (renewToken(store, personId, now) === null) {
    try {
      store.removeItem(tokenKey(personId));
    } catch {
      // Blocked storage: nothing was kept, and no form of theirs can write to it.
    }
  }
  remove();
}

/**
 * One form's buffer for as long as the form is open: what an earlier visit left (`found`), and
 * the writing of what is unsaved now. It ends, for good, when the store no longer holds the
 * token it opened under (its person signed out of this browser, in any tab, or the token went),
 * when the store is emptied, or when the form says its record can no longer be edited. Someone
 * else's sign-out does not end it. Once ended it writes nothing. The page wraps this in
 * useUnsaved.
 */
export function openUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  now = Date.now(),
) {
  // In this order: the token, then the buffer that is read under it. The other way round, a
  // sign-out in between would leave this form with the old text and the new token.
  //
  // A token that is there is taken as it is and not written again. Where there is none, or
  // what is there is not one, a new one is made. Where none can be had (a full store), this
  // form keeps nothing: with no token to hold, it could not tell a sign-out.
  const token = store ? (tokenOf(store, personId) ?? renewToken(store, personId, now)) : null;
  const found = readUnsaved(store, personId, scope, now);
  let ended = store !== null && token === null;
  const replaced = () => store !== null && tokenOf(store, personId) !== token;
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
      const more = { ...(token === null ? {} : { token }), ...(bases ? { bases } : {}) };
      if (!writeUnsaved(store, personId, scope, version, values, at, more)) ended = true;
      return !ended;
    },
    /** Has the store stopped holding this form's token (a sign-out of this person, in any tab)? */
    signedOut(): boolean {
      if (!ended && replaced()) ended = true;
      return ended;
    },
    /**
     * Told that another tab changed the store under `key` (null when it emptied the store): has
     * that ended this buffer? An emptied store ends it, whoever emptied it: nothing goes back
     * into it from a form that was open. So does this person's token being replaced or removed.
     * Nothing else does, another person's sign-out included.
     */
    changedElsewhere(key: string | null): boolean {
      if (!ended && (key === null || (key === tokenKey(personId) && replaced()))) {
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
 * A person's token goes 30 days after it was made, and at once when its time is ahead of the
 * clock (the clock was wrong when it was made), but never while that person still has a buffer
 * here: a form that holds unsaved text goes on keeping it. Anything under the tokens' prefix
 * that is not a token goes too. A token is only ever removed here, never written: a removal can
 * only stop a form, and the next form that person opens makes a new token.
 */
function expireTokens(store: Store, now: number): void {
  for (const key of keysWith(store, TOKENS_PREFIX)) {
    const raw = store.getItem(key);
    const found = parseToken(raw);
    if (found) {
      const age = now - found.at;
      if (age <= MAX_AGE_MS && -age <= AHEAD_MS) continue;
      // The key ends in the person's id as the buffers' keys have it (personPrefix).
      const buffers = `${PREFIX}${key.slice(TOKENS_PREFIX.length)}:`;
      if (keysWith(store, buffers).length > 0) continue;
    }
    // Only what was just read: a token that a sign-out puts there in this instant stays.
    if (store.getItem(key) === raw) store.removeItem(key);
  }
}

/**
 * When the app starts: remove buffers older than 30 days, and anything under our prefix that is
 * not a buffer. A time in the future (the clock was wrong when it was written) counts from now:
 * the buffer is written back with its time put right. That is a write of a person's text, so it
 * is made as a form makes one (writeUnsaved): the person's token is read just before and just
 * after, and a buffer that a sign-out overtook is taken out again. Then the tokens that are no
 * longer needed (expireTokens).
 */
export function expireUnsaved(store: Store | null, now = Date.now()): void {
  if (!store) return;
  try {
    for (const key of keysWith(store, PREFIX)) {
      const raw = store.getItem(key);
      const found = parse(raw);
      if (!found || expired(found, now)) {
        // Only what was just read: text a form writes there in this instant stays.
        if (store.getItem(key) === raw) store.removeItem(key);
        continue;
      }
      if (found.at <= now) continue;
      // The key is the buffers' prefix, the person's id as the keys have it, ":" and the scope.
      const token = `${TOKENS_PREFIX}${key.slice(PREFIX.length).split(":", 1)[0]}`;
      const before = store.getItem(token);
      if (store.getItem(key) !== raw) continue;
      store.setItem(key, JSON.stringify({ ...found, at: now }));
      if (store.getItem(token) !== before) store.removeItem(key);
    }
    expireTokens(store, now);
  } catch {
    // Blocked storage: nothing was kept.
  }
}
