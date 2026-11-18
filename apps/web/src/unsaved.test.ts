import { describe, expect, it } from "vitest";
import {
  clearUnsaved,
  expireUnsaved,
  forgetPerson,
  MAX_AGE_MS,
  openUnsaved,
  readUnsaved,
  type Store,
  sortUnsaved,
  tokenKey,
  tokenOf,
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
const HOUR = 60 * 60 * 1000;
const VALUES = { title: "Poems that read", "fields.needs": null, topicKeys: ["a", "b"] };

/** The buffers in the store, by key: everything but the people's tokens. */
const bufferKeys = (store: MemoryStore) =>
  [...store.items.keys()].filter((k) => !k.startsWith("elochair:sign-outs:"));
/** The people's tokens in the store, by key. */
const tokenKeys = (store: MemoryStore) =>
  [...store.items.keys()].filter((k) => k.startsWith("elochair:sign-outs:")).sort();
/** A token as the store holds it, for tests that put one there by hand. */
const stored = (digit: string, at: number) => `${digit.repeat(32)}:${at}`;

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
  it("keeps a token for each person under that person's own key: random digits and a time, no text", () => {
    const store = new MemoryStore();
    expect(tokenOf(store, ANA)).toBeNull();
    const form = openUnsaved(store, ANA, "profile", NOW);
    const first = tokenOf(store, ANA);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(store.items.get(tokenKey(ANA))).toBe(`${first}:${NOW}`);
    form.write(null, { "bios.en": "Ana writes poems." }, undefined, NOW);

    // Her sign-out removes what she left unsaved and puts a new token in the place of hers.
    forgetPerson(store, ANA, NOW + 5);
    const second = tokenOf(store, ANA);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(second).not.toBe(first);
    expect([...store.items.entries()]).toEqual([[tokenKey(ANA), `${second}:${NOW + 5}`]]);
    // Bruno's sign-out puts one under his id, and leaves hers as it was.
    forgetPerson(store, BRUNO, NOW + 6);
    expect(tokenOf(store, BRUNO)).toMatch(/^[0-9a-f]{32}$/);
    expect(tokenOf(store, BRUNO)).not.toBe(second);
    expect(tokenOf(store, ANA)).toBe(second);
    // A person's buffers go by their prefix on sign-out: the token is not under it.
    expect(tokenKey(ANA).startsWith("elochair:unsaved:")).toBe(false);
    expect(tokenKeys(store)).toEqual([tokenKey(ANA), tokenKey(BRUNO)].sort());
  });

  it("makes a new token every time, never one it made before", () => {
    const store = new MemoryStore();
    const made = new Set<string>();
    for (let i = 0; i < 200; i++) {
      forgetPerson(store, ANA, NOW);
      made.add(tokenOf(store, ANA) ?? "");
    }
    expect(made.size).toBe(200);
    expect(made.has("")).toBe(false);
  });

  it("reads anything that is not a token as none, and never throws", () => {
    const store = new MemoryStore();
    const a = "a".repeat(32);
    for (const raw of [
      "",
      "1",
      "two",
      "null",
      '{"count":1,"at":5}',
      "abc:5",
      `${"a".repeat(31)}:5`,
      `${"a".repeat(33)}:5`,
      `${"g".repeat(32)}:5`,
      `${"A".repeat(32)}:5`,
      a,
      `${a}:`,
      `${a}:five`,
      `${a}:-5`,
      `${a}:5.5`,
      `${a}:5:6`,
      ` ${a}:5`,
      `${a}:5\n`,
      `${a}:${"9".repeat(16)}`,
    ]) {
      store.items.set(tokenKey(ANA), raw);
      expect(tokenOf(store, ANA)).toBeNull();
    }
    store.items.set(tokenKey(ANA), `${a}:5`);
    expect(tokenOf(store, ANA)).toBe(a);
    store.refuse = "everything";
    expect(tokenOf(store, ANA)).toBeNull();
    expect(tokenOf(null, ANA)).toBeNull();
  });

  it("ends the buffer of a form that is still open in another tab", () => {
    // One store, as two tabs of one browser share it. Tab A has the profile open and dirty.
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    const opened = store.items.get(tokenKey(ANA)) as string;
    expect(tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW)).toBe(true);
    expect(bufferKeys(store)).toHaveLength(1);

    // Ana signs out in tab B. Tab A does not know yet: its next write, of text typed before or
    // after the sign-out, must not put anything of hers back.
    forgetPerson(store, ANA);
    expect(bufferKeys(store)).toEqual([]);
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 1)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
    // It has ended for good: also when the token is gone, when the one it opened under is back
    // in the store (nothing here would put it there), or when the text is cleared.
    store.items.delete(tokenKey(ANA));
    expect(tabA.write(null, { "bios.en": "Ana" }, undefined, NOW + 2)).toBe(false);
    store.items.set(tokenKey(ANA), opened);
    expect(tabA.write(null, { "bios.en": "Ana" }, undefined, NOW + 3)).toBe(false);
    expect(tabA.write(null, {}, undefined, NOW + 4)).toBe(false);
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

    // Bruno signs in after her, in the same browser: his forms open under his own token.
    const next = openUnsaved(store, BRUNO, "profile", NOW + 2);
    expect(next.found).toBeNull();
    expect(next.write(null, { pronouns: "he" }, undefined, NOW + 2)).toBe(true);
    expect(readUnsaved(store, BRUNO, "profile", NOW + 2)?.values).toEqual({ pronouns: "he" });
    expect(readUnsaved(store, ANA, "profile", NOW + 2)).toBeNull();
    // And she is back later: a form of hers opened after her sign-out keeps text again.
    const back = openUnsaved(store, ANA, "profile", NOW + 3);
    expect(back.write(null, { pronouns: "she/her" }, undefined, NOW + 3)).toBe(true);
    expect(profile.write(null, { pronouns: "she" }, undefined, NOW + 4)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 4)?.values).toEqual({ pronouns: "she/her" });
  });

  it("takes back a write that a sign-out overtook", () => {
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    const opened = tokenOf(store, ANA);
    // Tab A has looked at the token and is about to write; in that instant tab B signs out.
    store.beforeSet = () => forgetPerson(store, ANA);
    expect(tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
    expect(tokenOf(store, ANA)).not.toBeNull();
    expect(tokenOf(store, ANA)).not.toBe(opened);
  });

  it("removes a write that lands in the middle of the sign-out", () => {
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    // The sign-out has removed her buffers and is about to put the new token in. In that
    // instant tab A, still under the old one, writes.
    store.beforeSet = (key) => {
      expect(key).toBe(tokenKey(ANA));
      expect(tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW)).toBe(true);
      expect(bufferKeys(store)).toHaveLength(1);
    };
    forgetPerson(store, ANA, NOW + 1);
    expect(bufferKeys(store)).toEqual([]);
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 2)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
  });

  it("writes nothing for a form that the record ended (deleted, withdrawn)", () => {
    const store = new MemoryStore();
    const editor = openUnsaved(store, ANA, "submission:1", NOW);
    editor.end();
    expect(editor.write(2, { title: "One" }, undefined, NOW)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
  });

  it("makes room for the new token in a full store by removing the buffers first", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW);
    // Her token is not in the store (something else removed it), and the store is full.
    store.items.delete(tokenKey(ANA));
    store.room = 2;
    forgetPerson(store, ANA);
    expect(tokenOf(store, ANA)).not.toBeNull();
    expect(bufferKeys(store)).toEqual(["theme"]);
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 1)).toBe(false);
    expect(bufferKeys(store)).toEqual(["theme"]);
  });

  it("removes the token where the store takes no new one at sign-out, which ends her forms too", () => {
    const store = new MemoryStore();
    const tabA = openUnsaved(store, ANA, "profile", NOW);
    tabA.write(null, { "bios.en": "Ana writes" }, undefined, NOW);
    // The store is full for good: it takes no write at all, only removals.
    store.refuse = "writes";
    forgetPerson(store, ANA);
    expect(store.items.size).toBe(0);
    // There is room again later. Her form, still open in the other tab, writes nothing.
    store.refuse = "nothing";
    expect(tabA.write(null, { "bios.en": "Ana writes poems" }, undefined, NOW + 1)).toBe(false);
    expect(store.items.size).toBe(0);
  });

  it("gives back what an earlier visit left, read under the token it is valid under", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "submission:1", 4, VALUES, NOW);
    const editor = openUnsaved(store, ANA, "submission:1", NOW + DAY);
    expect(editor.found).toEqual({ version: 4, at: NOW, values: VALUES });
    expect(openUnsaved(null, ANA, "submission:1", NOW).found).toBeNull();
    expect(openUnsaved(null, ANA, "submission:1", NOW).write(4, VALUES)).toBe(true);
  });
});

describe("a form writes only under the token it opened with", () => {
  it("takes the token that is there as it is, and never writes it again", () => {
    const store = new MemoryStore();
    openUnsaved(store, ANA, "profile", NOW);
    const raw = store.items.get(tokenKey(ANA));
    // Another form of hers, a day later: the same token, its time untouched. Writing an old
    // token back, even for its time alone, could undo a sign-out that came in between.
    const second = openUnsaved(store, ANA, "submission:1", NOW + DAY);
    expect(store.items.get(tokenKey(ANA))).toBe(raw);
    expect(tokenKeys(store)).toEqual([tokenKey(ANA)]);
    expect(second.write(2, { title: "One" }, undefined, NOW + DAY)).toBe(true);
    expect(store.items.get(tokenKey(ANA))).toBe(raw);
  });

  it("does not undo a sign-out that happens while a form is opening", () => {
    const store = new MemoryStore();
    const old = openUnsaved(store, ANA, "profile", NOW);
    // A second form opens while she signs out in another tab. No write of the opening form
    // can come after the sign-out's: it writes nothing where a token is there.
    store.beforeSet = () => {
      throw new Error("opening a form under a token that is there wrote to the store");
    };
    openUnsaved(store, ANA, "submission:1", NOW + 1);
    store.beforeSet = null;
    forgetPerson(store, ANA, NOW + 2);
    expect(old.write(null, { pronouns: "she" }, undefined, NOW + 3)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
  });

  it("makes a new token where there is none, and where what is there is not one", () => {
    const store = new MemoryStore();
    store.items.set(tokenKey(ANA), '{"count":1,"at":5}');
    const form = openUnsaved(store, ANA, "profile", NOW);
    expect(store.items.get(tokenKey(ANA))).toBe(`${tokenOf(store, ANA)}:${NOW}`);
    expect(form.write(null, { pronouns: "she" }, undefined, NOW)).toBe(true);
  });

  it("keeps nothing for a form that could get no token", () => {
    const store = new MemoryStore();
    writeUnsaved(store, ANA, "profile", null, { pronouns: "she" }, NOW);
    // The store is full: it gives back what is there and takes nothing new.
    store.refuse = "writes";
    const form = openUnsaved(store, ANA, "profile", NOW + 1);
    expect(form.found?.values).toEqual({ pronouns: "she" });
    store.refuse = "nothing";
    // With no token to hold, the form could not tell a sign-out: it writes nothing, for good.
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 2)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 2)?.values).toEqual({ pronouns: "she" });
    expect(tokenKeys(store)).toEqual([]);
  });

  it("ends when the store was emptied, with or without word of it", () => {
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW);
    form.write(null, { pronouns: "she" }, undefined, NOW);
    // The browser's "clear site data", while this tab was asleep: no storage event reached it.
    store.items.clear();
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 1)).toBe(false);
    expect(store.items.size).toBe(0);
    // And for good: a form of hers opened later, under a new token, does not bring it back.
    const later = openUnsaved(store, ANA, "submission:1", NOW + 2);
    expect(later.write(2, { title: "One" }, undefined, NOW + 2)).toBe(true);
    expect(form.write(null, { pronouns: "she" }, undefined, NOW + 3)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 3)).toBeNull();
  });

  it("ends when what is under its person's key is no longer a token", () => {
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW);
    form.write(null, { pronouns: "she" }, undefined, NOW);
    store.items.set(tokenKey(ANA), "not a token");
    expect(form.signedOut()).toBe(true);
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 1)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 1)?.values).toEqual({ pronouns: "she" });
  });

  it("ends when another token is there, whatever its time says", () => {
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW);
    const opened = tokenOf(store, ANA) as string;
    // The same token with another time is still the one it opened under.
    store.items.set(tokenKey(ANA), `${opened}:${NOW - 400 * DAY}`);
    expect(form.write(null, { pronouns: "she" }, undefined, NOW)).toBe(true);
    // Another token is not, with the very time of the first.
    store.items.set(tokenKey(ANA), stored("b", NOW));
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 1)).toBe(false);
  });
});

describe("one person's sign-out is not another's", () => {
  it("leaves another person's open form keeping text", () => {
    // A shared computer. Ana left a tab open and never signed out; Bruno uses another tab.
    const store = new MemoryStore();
    const ana = openUnsaved(store, ANA, "profile", NOW);
    const bruno = openUnsaved(store, BRUNO, "profile", NOW);
    expect(ana.write(1, { displayName: "Ana, a draft" }, undefined, NOW)).toBe(true);
    expect(bruno.write(1, { displayName: "Bruno, a draft" }, undefined, NOW)).toBe(true);

    // Only Ana signs out.
    forgetPerson(store, ANA, NOW + 1);
    expect(ana.signedOut()).toBe(true);
    expect(ana.write(1, { displayName: "Ana, again" }, undefined, NOW + 2)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 2)).toBeNull();

    // Bruno never signed out: his form goes on keeping what he types, and gives it back.
    expect(bruno.signedOut()).toBe(false);
    expect(bruno.changedElsewhere(tokenKey(ANA))).toBe(false);
    expect(bruno.write(1, { displayName: "Bruno, a second draft" }, undefined, NOW + 2)).toBe(true);
    expect(readUnsaved(store, BRUNO, "profile", NOW + 2)?.values).toEqual({
      displayName: "Bruno, a second draft",
    });

    // His own sign-out ends it, as before.
    forgetPerson(store, BRUNO, NOW + 3);
    expect(bruno.changedElsewhere(tokenKey(BRUNO))).toBe(true);
    expect(bruno.write(1, { displayName: "Bruno, a third" }, undefined, NOW + 4)).toBe(false);
    expect(bufferKeys(store)).toEqual([]);
  });

  it("ends a form when another tab empties the store, and for nothing else that tab does", () => {
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW);
    form.write(null, { pronouns: "she" }, undefined, NOW);
    // Another tab wrote something of its own, a buffer of hers, or opened a form of hers.
    expect(form.changedElsewhere("theme")).toBe(false);
    expect(form.changedElsewhere(`elochair:unsaved:1:${ANA}:submission:1`)).toBe(false);
    expect(form.changedElsewhere(tokenKey(ANA))).toBe(false);
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 1)).toBe(true);
    // It emptied the store (the browser's "clear site data"): nothing of hers goes back in.
    store.items.clear();
    expect(form.changedElsewhere(null)).toBe(true);
    expect(form.write(null, { pronouns: "she" }, undefined, NOW + 2)).toBe(false);
    expect(store.items.size).toBe(0);
  });
});

describe("a token does not stay for ever, and its going never lets a form write", () => {
  it("goes 30 days after it was made, with nothing else of the store", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    forgetPerson(store, ANA, NOW);
    forgetPerson(store, BRUNO, NOW + 2 * DAY);
    expireUnsaved(store, NOW + MAX_AGE_MS);
    expect(tokenKeys(store)).toEqual([tokenKey(ANA), tokenKey(BRUNO)].sort());
    expireUnsaved(store, NOW + MAX_AGE_MS + 1);
    expect(tokenKeys(store)).toEqual([tokenKey(BRUNO)]);
    expireUnsaved(store, NOW + 2 * DAY + MAX_AGE_MS + 1);
    expect([...store.items.keys()]).toEqual(["theme"]);
  });

  it("stays past 30 days while that person has unsaved text here, and is never rewritten", () => {
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW);
    const raw = store.items.get(tokenKey(ANA));
    expect(form.write(null, { pronouns: "she" }, undefined, NOW + 20 * DAY)).toBe(true);
    // Bruno's token is as old as hers, and he left nothing unsaved.
    openUnsaved(store, BRUNO, "profile", NOW);

    expireUnsaved(store, NOW + 31 * DAY);
    expect(tokenKeys(store)).toEqual([tokenKey(ANA)]);
    expect(store.items.get(tokenKey(ANA))).toBe(raw);
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW + 31 * DAY)).toBe(true);

    // She saves: nothing unsaved is left, and the token goes the next time the app starts. A
    // form that was open through that keeps nothing from then on.
    expect(form.write(null, {}, undefined, NOW + 32 * DAY)).toBe(true);
    expireUnsaved(store, NOW + 32 * DAY);
    expect(store.items.size).toBe(0);
    expect(form.write(null, { pronouns: "they" }, undefined, NOW + 33 * DAY)).toBe(false);
    expect(store.items.size).toBe(0);
  });

  it("does not let a signed-out form write once a clock put right has aged the token away", () => {
    // The clock was at 2099 when Ana opened the form and signed out in another tab. It is put
    // right, and the app starts twice, 30 days and a millisecond apart.
    const store = new MemoryStore();
    const wrong = Date.UTC(2099, 0, 1);
    const right = Date.UTC(2026, 0, 1);
    const form = openUnsaved(store, ANA, "profile", wrong);
    forgetPerson(store, ANA, wrong);
    expireUnsaved(store, right);
    expireUnsaved(store, right + MAX_AGE_MS + 1);
    expect(tokenOf(store, ANA)).toBeNull();
    const at = right + MAX_AGE_MS + 2;
    expect(form.write(null, { "bios.en": "Ana secret draft" }, undefined, at)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", at)).toBeNull();
    expect(store.items.size).toBe(0);
  });

  it("does not let it write after a clock was put back by an hour, either", () => {
    // The clock was an hour fast when the form opened, and right when she signed out a minute
    // later. By its own times the form is younger than the token's 30 days when that goes.
    const store = new MemoryStore();
    const form = openUnsaved(store, ANA, "profile", NOW + HOUR);
    forgetPerson(store, ANA, NOW + 60_000);
    const gone = NOW + 60_000 + MAX_AGE_MS + 1;
    expireUnsaved(store, gone);
    expect(tokenOf(store, ANA)).toBeNull();
    expect(form.write(null, { "bios.en": "Ana secret draft" }, undefined, gone + 1)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", gone + 1)).toBeNull();
    expect(store.items.size).toBe(0);
  });

  it("keeps a form ended when its token went and a new form of that person made another", () => {
    const store = new MemoryStore();
    const old = openUnsaved(store, ANA, "profile", NOW);
    forgetPerson(store, ANA, NOW + DAY);
    expireUnsaved(store, NOW + DAY + MAX_AGE_MS + 1);
    expect(tokenKeys(store)).toEqual([]);
    // She is back, and a new form of hers makes a new token: not the one the old form holds.
    const next = openUnsaved(store, ANA, "submission:1", NOW + 40 * DAY);
    expect(next.write(2, { title: "One" }, undefined, NOW + 40 * DAY)).toBe(true);
    expect(old.signedOut()).toBe(true);
    expect(old.write(null, { pronouns: "she" }, undefined, NOW + 40 * DAY)).toBe(false);
    expect(readUnsaved(store, ANA, "profile", NOW + 40 * DAY)).toBeNull();
  });

  it("removes what is not a token", () => {
    const store = new MemoryStore();
    store.items.set(tokenKey(ANA), "not a token");
    store.items.set(`${tokenKey(BRUNO)}:seen`, String(NOW));
    store.items.set("theme", "dark");
    expireUnsaved(store, NOW);
    expect([...store.items.keys()]).toEqual(["theme"]);
  });

  it("removes a token whose time is ahead of the clock, and never puts its time right", () => {
    const store = new MemoryStore();
    const wrong = Date.UTC(2099, 0, 1);
    // A moment ahead is two tabs a moment apart: it stays.
    store.items.set(tokenKey(BRUNO), stored("b", NOW + 60_000));
    // Years ahead is a clock that was wrong. With unsaved text of hers here it stays, as it is.
    const form = openUnsaved(store, ANA, "profile", wrong);
    const raw = store.items.get(tokenKey(ANA));
    form.write(null, { pronouns: "she" }, undefined, wrong);
    expireUnsaved(store, NOW);
    expect(store.items.get(tokenKey(ANA))).toBe(raw);
    expect(store.items.get(tokenKey(BRUNO))).toBe(stored("b", NOW + 60_000));
    expect(form.write(null, { pronouns: "she/her" }, undefined, NOW)).toBe(true);
    // Without it, the token goes at once.
    form.write(null, {}, undefined, NOW);
    expireUnsaved(store, NOW);
    expect(tokenKeys(store)).toEqual([tokenKey(BRUNO)]);
  });

  it("leaves a token that a sign-out puts there while the old one is being removed", () => {
    const store = new MemoryStore();
    store.items.set("theme", "dark");
    forgetPerson(store, ANA, NOW);
    // The app starts in one tab 31 days on; in that instant she signs out in another.
    const get = store.getItem.bind(store);
    let reads = 0;
    store.getItem = (key: string) => {
      const value = get(key);
      if (key === tokenKey(ANA) && ++reads === 1) forgetPerson(store, ANA, NOW + 31 * DAY);
      return value;
    };
    expireUnsaved(store, NOW + 31 * DAY);
    expect(tokenOf(store, ANA)).not.toBeNull();
  });

  it("never throws when the store refuses everything", () => {
    const store = new MemoryStore();
    forgetPerson(store, ANA, NOW);
    store.refuse = "everything";
    expect(() => {
      expireUnsaved(store, NOW + 40 * DAY);
      openUnsaved(store, ANA, "profile", NOW).write(null, { pronouns: "she" }, undefined, NOW);
    }).not.toThrow();
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
