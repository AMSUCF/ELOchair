import { describe, expect, it } from "vitest";
import { cursorsFor } from "./cursor";

const ID = "0ba47ccd-1111-4222-8333-944455556666";
const MS = 1_794_193_867_170;
const LIST = "conference-a:person-1";

describe("paging cursors", () => {
  const codec = cursorsFor("a".repeat(64));

  it("round-trips a position, opaquely and differently each time", () => {
    const a = codec.seal([MS, ID], LIST);
    const b = codec.seal([MS, ID], LIST);
    expect(codec.open(a, LIST)).toEqual([MS, ID]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // Neither the creation time nor the id can be read from it.
    for (const c of [a, b]) {
      expect(c).not.toContain(String(MS));
      expect(c).not.toContain(ID);
      expect(Buffer.from(c, "base64url").toString("latin1")).not.toContain(String(MS));
    }
  });

  it("opens only in the list it was sealed for", () => {
    const real = codec.seal([MS, ID], LIST);
    expect(codec.open(real, "conference-b:person-1")).toBeNull();
    expect(codec.open(real, "conference-a:person-2")).toBeNull();
    expect(codec.open(real, "conference-a:public")).toBeNull();
  });

  it("refuses cursors it did not seal, including near copies of real ones", () => {
    const real = codec.seal([MS, ID], LIST);
    const tampered = `${real.slice(0, 20)}${real[20] === "A" ? "B" : "A"}${real.slice(21)}`;
    const otherKey = cursorsFor("b".repeat(64)).seal([MS, ID], LIST);
    const bad = [
      tampered,
      otherKey,
      `${real}A`,
      `${real}==`,
      `${real.slice(0, -1)}`,
      "",
      "page-2",
      ID,
      `${MS}.${ID}`,
      "A".repeat(120),
    ];
    for (const cursor of bad) expect(codec.open(cursor, LIST)).toBeNull();
  });
});
