/**
 * Unsaved text, kept in this browser so that a reload, a crashed tab or a phone that closes the
 * browser does not lose it. The server stays the source of truth: a buffer holds only what its
 * owner typed and has not saved yet.
 *
 * Buffers are unpublished work and personal data, possibly on a shared computer:
 * - each is kept under the signed-in person's id, so another account never sees it;
 * - it goes on save, on discard and on sign-out, and expires after 30 days;
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
};

/** The part of `Storage` used here, so that tests can pass their own. */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The trailing number is the format: a later format ignores these keys instead of misreading them. */
const PREFIX = "elochair:unsaved:1:";
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const personPrefix = (personId: string) => `${PREFIX}${encodeURIComponent(personId)}:`;
const keyOf = (personId: string, scope: string) => `${personPrefix(personId)}${scope}`;

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

/** A stored buffer, or null when it is not one (edited by hand, cut short, another format). */
function parse(raw: string | null): Unsaved | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { version, at, values } = data as Record<string, unknown>;
  if (version !== null && !Number.isSafeInteger(version)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const entries = Object.entries(values);
  if (entries.length === 0 || !entries.every(([, v]) => isValue(v))) return null;
  return { version: version as number | null, at, values: Object.fromEntries(entries) };
}

const expired = (found: Unsaved, now: number) => now - found.at > MAX_AGE_MS;

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

/** Keep `values` as this person's unsaved changes in `scope`; none left removes the buffer. */
export function writeUnsaved(
  store: Store | null,
  personId: string,
  scope: string,
  version: number | null,
  values: UnsavedValues,
  now = Date.now(),
): void {
  if (!store) return;
  try {
    const key = keyOf(personId, scope);
    if (Object.keys(values).length === 0) {
      store.removeItem(key);
      return;
    }
    // Unchanged since it was written (the page was only opened again): its age stays.
    const before = parse(store.getItem(key));
    if (
      before &&
      before.version === version &&
      JSON.stringify(before.values) === JSON.stringify(values)
    ) {
      return;
    }
    store.setItem(key, JSON.stringify({ version, at: now, values } satisfies Unsaved));
  } catch {
    // Full or blocked storage: the form goes on without a buffer.
  }
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

/** On sign-out: remove everything this person left unsaved in this browser. */
export function forgetPerson(store: Store | null, personId: string): void {
  if (!store) return;
  try {
    for (const key of keysWith(store, personPrefix(personId))) store.removeItem(key);
  } catch {
    // Blocked storage: nothing was kept.
  }
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
