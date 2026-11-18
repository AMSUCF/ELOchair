import { describe, expect, it } from "vitest";
import {
  clearUnsaved,
  expireUnsaved,
  forgetPerson,
  MAX_AGE_MS,
  openUnsaved,
  readUnsaved,
  SIGN_OUTS_KEY,
  type Store,
  signOutCount,
  sortUnsaved,
  writeUnsaved,
} from "./unsaved";

/**
 * localStorage as a Map. `refuse` makes it throw, as a full or blocked store does; `room` is how
 * many keys it holds before it is full. `beforeSet` runs inside a write, where another tab's
 * write would land between this tab's last look at the store and its own write.
 */
class MemoryStore implements Store {
  readonly items = new Map<string, string>();
  refuse: "nothing" | "writes" | "everything" = "nothing";
  room = Number.POSITIVE_INFINITY;
  beforeSet: ((key: string) => void) | null = null;

  private check(writing: boolean) {
    if (this.refuse === "everything" || (writing && this.refuse === "writes")) {
      throw new DOMException("refused", writing ? "QuotaExceededError" : "SecurityError");
    }
  }
  get length() {
    this.check(false);
    return this.items.size;
  }
  key(index: number) {
    this.check(false);
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    this.check(false);
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.check(true);
    const between = this.beforeSet;
    this.beforeSet = null;
    between?.(key);
    if (!this.items.has(key) && this.items.size >= this.room) {
      throw new DOMException("full", "QuotaExceededError");
    }
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.check(false);
    this.items.delete(key);
  }
}

const ANA = "0b7c5a52-0000-4000-8000-000000000001";
const BRUNO = "0b7c5a52-0000-4000-8000-000000000002";
const NOW = Date.UTC(2027, 0, 20, 12);
const DAY = 24 * 60 * 60 * 1000;
const VALUES = { title: "Poems that read", "fields.needs": null, topicKeys: ["a", "b"] };

/** The buffers in the store, by key: everything but the count of sign-outs. */
const bufferKeys = (store: MemoryStore) =>
  [...store.items.keys()].filter((k) => k !== SIGN_OUTS_KEY);

/** The one key in the store (tests that write a single buffer). */
function onlyKey(store: MemoryStore) {
  expect(store.items.size).toBe(1);
  return [...store.items.keys()][0]!;
}

describe("unsaved changes kept in the browser", () => {
  it("returns what was written, with its version and time", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 4, VALUES, NOW);
    expect(readUnsaved(store, ANA, "submission:1", NOW + DAY)).toEqual({
      version: 4,
      at: NOW,
      values: VALUES,
    });
  });

  it("keeps each person's buffers apart, and each scope's", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "profile", null, { "bios.en": "Ana writes poems." }, NOW);
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    expect(readUnsaved(store, BRUNO, "profile", NOW)).toBeNull();
    expect(readUnsaved(store, BRUNO, "submission:1", NOW)).toBeNull();
    expect(readUnsaved(store, ANA, "submission:2", NOW)).toBeNull();
    expect(readUnsaved(store, ANA, "profile", NOW)?.values).toEqual({
      "bios.en": "Ana writes poems.",
    });
    expect(readUnsaved(store, ANA, "submission:1", NOW)?.values).toEqual({ title: "One" });
  });

  it("does not let one person's id reach into another's buffers", () => {
    const store = new MemoryStore();
    writeUnsaved(store, "ana:profile", "x", null, { title: "Hers" }, NOW);
    expect(readUnsaved(store, "ana", "profile:x", NOW)).toBeNull();
    forgetPerson(store, "ana");
    expect(bufferKeys(store)).toHaveLength(1);
  });

  it("removes the buffer when no unsaved changes are left", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    writeUnsaved(store, ANA, "submission:1", 3, {}, NOW);
    expect(store.items.size).toBe(0);
  });

  it("keeps a buffer's age when the same changes are written again", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW + 10 * DAY);
    expect(readUnsaved(store, ANA, "submission:1", NOW + 10 * DAY)?.at).toBe(NOW);
    // A new version or new text is a new buffer.
    writeUnsaved(store, ANA, "submission:1", 3, { title: "One" }, NOW + 11 * DAY);
    expect(readUnsaved(store, ANA, "submission:1", NOW + 11 * DAY)?.at).toBe(NOW + 11 * DAY);
    writeUnsaved(store, ANA, "submission:1", 3, { title: "Two" }, NOW + 12 * DAY);
    expect(readUnsaved(store, ANA, "submission:1", NOW + 12 * DAY)?.at).toBe(NOW + 12 * DAY);
  });

  it("clears one buffer, and on sign-out everything of that person only", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    writeUnsaved(store, ANA, "profile", null, { pronouns: "she" }, NOW);
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    writeUnsaved(store, ANA, "submission:2", 5, { title: "Two" }, NOW);
    writeUnsaved(store, BRUNO, "profile", null, { pronouns: "he" }, NOW);

    clearUnsaved(store, ANA, "submission:1");
    expect(readUnsaved(store, ANA, "submission:1", NOW)).toBeNull();
    expect(readUnsaved(store, ANA, "submission:2", NOW)).not.toBeNull();

    forgetPerson(store, ANA);
    expect(readUnsaved(store, ANA, "profile", NOW)).toBeNull();
    expect(readUnsaved(store, ANA, "submission:2", NOW)).toBeNull();
    expect(readUnsaved(store, BRUNO, "profile", NOW)?.values).toEqual({ pronouns: "he" });
    expect(store.items.get("theme")).toBe("dark");
  });
});

describe("expiry after 30 days", () => {
  it("does not restore a buffer older than 30 days, and removes it", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    expect(readUnsaved(store, ANA, "submission:1", NOW + MAX_AGE_MS)).not.toBeNull();
    expect(readUnsaved(store, ANA, "submission:1", NOW + MAX_AGE_MS + 1)).toBeNull();
    expect(store.items.size).toBe(0);
  });

  it("at app start removes old and malformed buffers, and nothing else in the store", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    store.items.set("elochair:unsaved:1:someone:profile", "not json");
    writeUnsaved(store, ANA, "submission:1", 2, { title: "Old" }, NOW - 31 * DAY);
    writeUnsaved(store, ANA, "submission:2", 2, { title: "Recent" }, NOW - 29 * DAY);
    writeUnsaved(store, BRUNO, "profile", null, { pronouns: "he" }, NOW - 40 * DAY);

    expireUnsaved(store, NOW);
    expect([...store.items.keys()].sort()).toEqual(
      [`elochair:unsaved:1:${ANA}:submission:2`, "theme"].sort(),
    );
    expect(readUnsaved(store, ANA, "submission:2", NOW)?.values).toEqual({ title: "Recent" });
  });

  it("counts a buffer written under a wrong clock from the moment it is noticed", () => {
    const store = new MemoryStore();
    const wrong = Date.UTC(2099, 0, 1);
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, wrong);
    expireUnsaved(store, NOW);
    expect(readUnsaved(store, ANA, "submission:1", NOW)).toEqual({
      version: 2,
      at: NOW,
      values: { title: "One" },
    });
    expireUnsaved(store, NOW + MAX_AGE_MS + 1);
    expect(store.items.size).toBe(0);
  });
});

describe("malformed data", () => {
  const cases: [string, string][] = [
    ["not JSON", "{"],
    ["a string", JSON.stringify("title")],
    ["null", "null"],
    ["an array", "[]"],
    ["no values", JSON.stringify({ version: 1, at: NOW })],
    ["empty values", JSON.stringify({ version: 1, at: NOW, values: {} })],
    ["values as an array", JSON.stringify({ version: 1, at: NOW, values: ["title"] })],
    ["no time", JSON.stringify({ version: 1, values: { title: "x" } })],
    ["a time that is not a number", JSON.stringify({ version: 1, at: "now", values: { a: "x" } })],
    [
      "a version that is not an integer",
      JSON.stringify({ version: 1.5, at: NOW, values: { a: 1 } }),
    ],
    ["a version that is text", JSON.stringify({ version: "1", at: NOW, values: { a: 1 } })],
    ["a missing version", JSON.stringify({ at: NOW, values: { a: 1 } })],
    ["an object as a value", JSON.stringify({ version: 1, at: NOW, values: { a: { b: 1 } } })],
    ["a mixed array as a value", JSON.stringify({ version: 1, at: NOW, values: { a: ["x", 1] } })],
    [
      "bases that are not an object",
      JSON.stringify({ version: null, at: NOW, values: { a: "x" }, bases: ["a"] }),
    ],
    [
      "a base for a path that has no change",
      JSON.stringify({ version: null, at: NOW, values: { a: "x" }, bases: { b: "y" } }),
    ],
    [
      "an object as a base",
      JSON.stringify({ version: null, at: NOW, values: { a: "x" }, bases: { a: { b: 1 } } }),
    ],
  ];

  it.each(cases)("discards %s", (_name, raw) => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    store.items.set(onlyKey(store), raw);
    expect(readUnsaved(store, ANA, "submission:1", NOW)).toBeNull();
    expect(store.items.size).toBe(0);
  });

  it("accepts every kind of value a form control holds", () => {
    const store = new MemoryStore();
    const values = { text: "", n: 0, yes: false, many: [], gone: null };
    writeUnsaved(store, ANA, "submission:1", null, values, NOW);
    expect(readUnsaved(store, ANA, "submission:1", NOW)?.values).toEqual(values);
  });

  it("replaces a malformed buffer on the next write", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    store.items.set(onlyKey(store), "{");
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    expect(readUnsaved(store, ANA, "submission:1", NOW)?.values).toEqual({ title: "One" });
  });
});

describe("storage that cannot be used", () => {
  it("does nothing without a store", () => {
    expect(readUnsaved(null, ANA, "profile", NOW)).toBeNull();
    expect(() => {
      writeUnsaved(null, ANA, "profile", null, { pronouns: "she" }, NOW);
      clearUnsaved(null, ANA, "profile");
      forgetPerson(null, ANA);
      expireUnsaved(null, NOW);
    }).not.toThrow();
  });

  it("goes on without a buffer when the store is full, keeping what was there", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    store.refuse = "writes";
    expect(() => writeUnsaved(store, ANA, "submission:1", 2, { title: "Two" }, NOW)).not.toThrow();
    expect(() => writeUnsaved(store, ANA, "submission:2", 1, { title: "New" }, NOW)).not.toThrow();
    expect(readUnsaved(store, ANA, "submission:1", NOW)?.values).toEqual({ title: "One" });
    expect(readUnsaved(store, ANA, "submission:2", NOW)).toBeNull();
  });

  it("never throws when the store refuses everything", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 2, { title: "One" }, NOW);
    store.refuse = "everything";
    expect(readUnsaved(store, ANA, "submission:1", NOW)).toBeNull();
    expect(() => {
      writeUnsaved(store, ANA, "submission:1", 2, { title: "Two" }, NOW);
      clearUnsaved(store, ANA, "submission:1");
      forgetPerson(store, ANA);
      expireUnsaved(store, NOW);
    }).not.toThrow();
  });
});

describe("a sign-out reaches every tab", () => {
  it("counts sign-outs in the store, under a key that names nobody and holds no text", () => {
    const store = new MemoryStore();
    expect(signOutCount(store)).toBe(0);
    writeUnsaved(store, ANA, "profile", null, { "bios.en": "Ana writes poems." }, NOW);
    forgetPerson(store, ANA);
    expect(signOutCount(store)).toBe(1);
    expect([...store.items.entries()]).toEqual([[SIGN_OUTS_KEY, "1"]]);
    forgetPerson(store, BRUNO);
    expect(store.items.get(SIGN_OUTS_KEY)).toBe("2");
    expect(SIGN_OUTS_KEY.startsWith("elochair:unsaved:")).toBe(false);
  });

  it("reads anything that is not a count as 0, and never throws", () => {
    const store = new MemoryStore();
    for (const raw of ["", "-1", "1.5", "two", "1e3", " 4", "9".repeat(16)]) {
      store.items.set(SIGN_OUTS_KEY, raw);
      expect(signOutCount(store)).toBe(0);
    }
    store.refuse = "everything";
    expect(signOutCount(store)).toBe(0);
    expect(signOutCount(null)).toBe(0);
  });

  it("ends the buffer of a form that is still open in another tab", () => {
    // One store, as two tabs of one browser share it. Tab A has the profile open and dirty.
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    expect(tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW)).toBe(true);
    expect(bufferKeys(store)).toHaveLength(1);

    // Ana signs out in tab B. Tab A does not know yet: its next write, of text typed before or
    // after the sign-out, must not put anything of hers back.
    forgetPerson(store, ANA);
    expect(bufferKeys(store)).toEqual([]);
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 1)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
    // It has ended for good: also when the count is back where it was, or the text is cleared.
    store.items.set(SIGN_OUTS_KEY, "0");
    expect(tabA.write(null, { "bios.en": "Ana" }, undefined, NOW + 2)).toBe(false);
    expect(tabA.write(null, {}, undefined, NOW + 3)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
  });

  it("ends every form that was open, in both tabs, and lets a form opened afterwards keep text", () => {
    const store = new MemoryStore();
    const profile = openUnsaved(store, ANA, "profile", NOW);
    const proposal = openUnsaved(store, ANA, "submission:1", NOW);
    profile.write(null, { pronouns: "she" }, undefined, NOW);
    proposal.write(3, { title: "One" }, undefined, NOW);
    expect(profile.signedOut()).toBe(false);

    forgetPerson(store, ANA);
    // What a tab asks when the store tells it that another tab changed something.
    expect(profile.signedOut()).toBe(true);
    expect(proposal.write(3, { title: "Two" }, undefined, NOW + 1)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);

    // Bruno signs in after her, in the same browser: his forms start from the new count.
    const next = openUnsaved(store, BRUNO, "profile", NOW + 2);
    expect(next.found).toBeNull();
    expect(next.write(null, { pronouns: "he" }, undefined, NOW + 2)).toBe(true);
    expect(readUnsaved(store, BRUNO, "profile", NOW + 2)?.values).toEqual({ pronouns: "he" });
    expect(readUnsaved(store, ANA, "profile", NOW + 2)).toBeNull();
  });

  it("takes back a write that a sign-out overtook", () => {
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    // Tab A has looked at the count and is about to write; in that instant tab B signs out.
    store.beforeSet = () => forgetPerson(store, ANA);
    expect(tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
    expect(signOutCount(store)).toBe(1);
  });

  it("writes nothing for a form that the record ended (deleted, withdrawn)", () => {
    const store = new MemoryStore();
    const editor = openUnsaved(store, ANA, "submission:1", NOW);
    editor.end();
    expect(editor.write(2, { title: "One" }, undefined, NOW)).toBe(false);
    expect(store.items.size).toBe(0);
  });

  it("counts the sign-out in a full store once the buffers are gone", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW);
    store.room = 2;
    forgetPerson(store, ANA);
    expect(signOutCount(store)).toBe(1);
    expect(bufferKeys(store)).toEqual(["theme"]);
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 1)).toBe(false);
    expect(bufferKeys(store)).toEqual(["theme"]);
  });

  it("gives back what an earlier visit left, read with the count it is valid under", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 4, VALUES, NOW);
    const editor = openUnsaved(store, ANA, "submission:1", NOW + DAY);
    expect(editor.found).toEqual({ version: 4, at: NOW, values: VALUES });
    expect(openUnsaved(null, ANA, "submission:1", NOW).found).toBeNull();
    expect(openUnsaved(null, ANA, "submission:1", NOW).write(4, VALUES)).toBe(true);
  });
});

describe("changes kept with the saved value they were made on", () => {
  const BIO = { "bios.en": "Ana writes poems for machines." };

  it("returns the bases that were written, and keeps them apart from the values", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "profile", null, BIO, NOW, { bases: { "bios.en": "Ana writes." } });
    expect(readUnsaved(store, ANA, "profile", NOW)).toEqual({
      version: null,
      at: NOW,
      values: BIO,
      bases: { "bios.en": "Ana writes." },
    });
    // The same changes on another saved value are another buffer: its age starts again.
    writeUnsaved(store, ANA, "profile", null, BIO, NOW + DAY, { bases: { "bios.en": "Ana." } });
    expect(readUnsaved(store, ANA, "profile", NOW + DAY)?.at).toBe(NOW + DAY);
    writeUnsaved(store, ANA, "profile", null, BIO, NOW + 2 * DAY, { bases: { "bios.en": "Ana." } });
    expect(readUnsaved(store, ANA, "profile", NOW + 2 * DAY)?.at).toBe(NOW + DAY);
  });

  it("puts a change back when the saved value is still the one it was made on", () => {
    const found = { version: null, at: NOW, values: BIO, bases: { "bios.en": "Ana writes." } };
    expect(sortUnsaved(found, { "bios.en": "Ana writes.", pronouns: "she" })).toEqual({
      restore: BIO,
      conflicts: {},
    });
  });

  it("makes a conflict of a change whose saved value has changed since, and restores the rest", () => {
    // Typed on this device on top of "Ana writes."; saved as something else on another device.
    const found = {
      version: null,
      at: NOW,
      values: { ...BIO, pronouns: "she/her", affiliation: "" },
      bases: { "bios.en": "Ana writes.", pronouns: "she", affiliation: "Uni Norte" },
    };
    const saved = { "bios.en": "Ana builds machines.", pronouns: "she", affiliation: "Uni Sur" };
    expect(sortUnsaved(found, saved)).toEqual({
      restore: { pronouns: "she/her" },
      conflicts: {
        "bios.en": { mine: BIO["bios.en"], base: "Ana writes." },
        affiliation: { mine: "", base: "Uni Norte" },
      },
    });
  });

  it("is done with a change that is what is saved now", () => {
    const found = { version: null, at: NOW, values: BIO, bases: { "bios.en": "Ana writes." } };
    expect(sortUnsaved(found, BIO)).toEqual({ restore: {}, conflicts: {} });
  });

  it("leaves out a change with no recorded base, and one for a value that is not there", () => {
    const found = {
      version: null,
      at: NOW,
      values: { pronouns: "she", "bios.fr": "Ana écrit.", orcid: "0000-0002-1825-0097" },
      bases: { "bios.fr": "", orcid: "" },
    };
    expect(sortUnsaved(found, { pronouns: "", orcid: "" })).toEqual({
      restore: { orcid: "0000-0002-1825-0097" },
      conflicts: {},
    });
    expect(sortUnsaved(null, { pronouns: "" })).toEqual({ restore: {}, conflicts: {} });
  });
});
