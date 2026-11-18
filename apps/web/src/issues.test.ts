import { describe, expect, it } from "vitest";
import { isMessageKey, LANGS, translate } from "./i18n";
import { issueMessageKey } from "./issues";

const said = (lang: (typeof LANGS)[number], params: Record<string, number>) => {
  const key = issueMessageKey({ code: "out_of_range", params });
  if (!isMessageKey(key)) throw new Error(`no message ${key}`);
  return translate(lang, key, params);
};

describe("the message for a number outside its range", () => {
  it("names both ends when the field has both", () => {
    expect(said("en", { min: 15, max: 30 })).toBe("Enter a number from 15 to 30.");
    expect(said("es", { min: 15, max: 30 })).toBe("Escribe un número entre 15 y 30.");
    expect(said("pt", { min: 15, max: 30 })).toBe("Escreva um número entre 15 e 30.");
  });

  it("names the one end a field has, in every language", () => {
    expect(said("en", { min: 1 })).toBe("Enter a number that is 1 or more.");
    expect(said("es", { min: 1 })).toBe("Escribe un número igual o mayor que 1.");
    expect(said("pt", { min: 1 })).toBe("Escreva um número igual ou superior a 1.");
    expect(said("en", { max: 30 })).toBe("Enter a number that is 30 or less.");
    expect(said("es", { max: 30 })).toBe("Escribe un número igual o menor que 30.");
    expect(said("pt", { max: 30 })).toBe("Escreva um número igual ou inferior a 30.");
  });

  it("never shows an unfilled placeholder, whatever the shape", () => {
    for (const lang of LANGS) {
      const shapes: Record<string, number>[] = [{ min: 0 }, { max: 0 }, { min: 0, max: 0 }];
      for (const params of shapes) {
        expect(said(lang, params)).not.toMatch(/[{}]/);
      }
    }
  });
});

describe("the message key for other issues", () => {
  it("is the code's own", () => {
    expect(issueMessageKey({ code: "required" })).toBe("issue_required");
    expect(issueMessageKey({ code: "not_integer" })).toBe("issue_not_integer");
    // A code this version does not know has no message; the form then says "Check this value."
    expect(isMessageKey(issueMessageKey({ code: "from_a_newer_server" }))).toBe(false);
  });
});
