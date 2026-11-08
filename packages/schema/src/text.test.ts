import { describe, expect, it } from "vitest";
import { localize, localizeWithLang } from "./text";

describe("localize", () => {
  it("prefers the exact language, then the bare language, then a regional variant", () => {
    expect(localize({ en: "Hello", "pt-BR": "Olá" }, "pt")).toBe("Olá");
    expect(localize({ en: "Hello", pt: "Olá" }, "pt-BR")).toBe("Olá");
    expect(localize({ en: "Hello", es: "Hola" }, "pt")).toBe("Hello");
  });

  it("reports which language it used, for lang attributes on fallback text", () => {
    expect(localizeWithLang({ en: "Hello" }, "es")).toEqual({ text: "Hello", lang: "en" });
    expect(localizeWithLang({ es: "Hola", en: "Hello" }, "es")).toEqual({
      text: "Hola",
      lang: "es",
    });
  });
});
