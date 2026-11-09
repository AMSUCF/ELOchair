import { describe, expect, it } from "vitest";
import { cursorsFor } from "./cursor";

const ID = "0ba47ccd-1111-4222-8333-944455556666";
const MS = 1_794_193_867_170;

describe("paging cursors", () => {
  const codec = cursorsFor("a".repeat(64));

  it("round-trips a position, opaquely and differently each time", () => {
    const a = codec.seal([MS, ID]);
    const b = codec.seal([MS, ID]);
    expect(codec.open(a)).toEqual([MS, ID]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // Neither the creation time nor the id can be read from it.
    for (const c of [a, b]) {
      expect(c).not.toContain(String(MS));
      expect(c).not.toContain(ID);
      expect(Buffer.from(c, "base64url").toString("latin1")).not.toContain(String(MS));
    }
  });

  it("refuses cursors it did not seal", () => {
    const real = codec.seal([MS, ID]);
    const tampered = `${real.slice(0, 20)}${real[20] === "A" ? "B" : "A"}${real.slice(21)}`;
    const otherKey = cursorsFor("b".repeat(64)).seal([MS, ID]);
    for (const bad of [tampered, otherKey, "", "page-2", ID, `${MS}.${ID}`, "A".repeat(120)]) {
      expect(codec.open(bad)).toBeNull();
    }
  });
});
