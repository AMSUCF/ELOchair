import { describe, expect, it } from "vitest";
import {
  clearUnsaved,
  expireUnsaved,
  forgetPerson,
  MAX_AGE_MS,
  readUnsaved,
  type Store,
  writeUnsaved,
} from "./unsaved";

/** localStorage as a Map. `refuse` makes it throw, as a full or blocked store does. */
class MemoryStore implements Store {
  readonly items = new Map<string, string>();
  refuse: "nothing" | "writes" | "everything" = "nothing";

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
    expect(store.items.size).toBe(1);
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
