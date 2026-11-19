import { describe, expect, it } from "vitest";
import { answerOf } from "./answers";

const words = { lang: "es", fallback: "en", yes: "Sí", no: "No" };
const options: { key: string; label: Record<string, string> }[] = [
  { key: "online", label: { en: "Online", es: "En línea" } },
  { key: "onsite", label: { en: "On site" } },
];

describe("an answer shown to someone who is only reading", () => {
  it("is the text as written", () => {
    expect(answerOf({ kind: "longtext" }, "Una obra generativa.", words)).toEqual({
      text: "Una obra generativa.",
    });
    expect(answerOf({ kind: "text" }, "Sala 2", words)).toEqual({ text: "Sala 2" });
  });

  it("is nothing for a field left empty", () => {
    expect(answerOf({ kind: "text" }, undefined, words)).toBeNull();
    expect(answerOf({ kind: "longtext" }, "  \n ", words)).toBeNull();
    expect(answerOf({ kind: "multiselect", options }, [], words)).toBeNull();
  });

  it("names the option chosen, in the reader's language or the conference's", () => {
    expect(answerOf({ kind: "select", options }, "online", words)).toEqual({ text: "En línea" });
    expect(answerOf({ kind: "select", options }, "onsite", words)).toEqual({ text: "On site" });
    expect(answerOf({ kind: "multiselect", options }, ["online", "onsite"], words)).toEqual({
      text: "En línea, On site",
    });
  });

  it("shows the key of an option the conference no longer offers", () => {
    expect(answerOf({ kind: "select", options }, "hybrid", words)).toEqual({ text: "hybrid" });
  });

  it("says yes or no for a tick box, and writes a number out, zero included", () => {
    expect(answerOf({ kind: "boolean" }, true, words)).toEqual({ text: "Sí" });
    expect(answerOf({ kind: "boolean" }, false, words)).toEqual({ text: "No" });
    expect(answerOf({ kind: "number" }, 0, words)).toEqual({ text: "0" });
    expect(answerOf({ kind: "number" }, 22.5, words)).toEqual({ text: "22.5" });
  });

  it("links a web address, and only a web address", () => {
    expect(answerOf({ kind: "url" }, "https://example.org/works/7", words)).toEqual({
      text: "https://example.org/works/7",
      href: "https://example.org/works/7",
    });
    for (const notAWebAddress of ["javascript:alert(1)", "data:text/html,x", "example.org/x"]) {
      expect(answerOf({ kind: "url" }, notAWebAddress, words)).toEqual({ text: notAWebAddress });
    }
    // An address typed into a plain text field stays text.
    expect(answerOf({ kind: "text" }, "https://example.org/", words)).toEqual({
      text: "https://example.org/",
    });
  });
});
