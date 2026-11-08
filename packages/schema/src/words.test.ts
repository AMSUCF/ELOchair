import { describe, expect, it } from "vitest";
import { countWords } from "./words";

describe("countWords", () => {
  it("ignores punctuation and extra whitespace", () => {
    expect(countWords("  Hello, world!  It's   e-lit.  ")).toBe(5);
  });

  it("counts Spanish and Portuguese with accents and contractions", () => {
    expect(countWords("La literatura electrónica, ¿qué es?", "es")).toBe(5);
    expect(countWords("Não é só código: é poesia.", "pt")).toBe(6);
  });

  it("counts languages written without spaces", () => {
    expect(countWords("電子文学の未来", "ja")).toBeGreaterThan(1);
  });

  it("returns zero for empty text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords(" … — ")).toBe(0);
  });
});
