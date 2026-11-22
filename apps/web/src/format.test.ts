import { describe, expect, it } from "vitest";
import {
  clockName,
  deadlineText,
  formatDateTime,
  isShortTheme,
  numberLimits,
  ownTime,
  statedWhen,
  themeClass,
} from "./format";
import { type Lang, translate } from "./i18n";

const LANGS = ["en", "es", "pt"] as const;
/** The catalog of one language, as a page passes it. */
const said =
  (lang: Lang): Parameters<typeof deadlineText>[3] =>
  (key, vars) =>
    translate(lang, key, vars);

describe("a deadline written on the conference's own clock", () => {
  // Winter and summer in New York, both sides of both changes of the clocks, a place without
  // daylight saving and one half an hour off.
  const written = [
    ["2031-02-28T23:59:00-05:00", "America/New_York"],
    ["2031-04-30T23:59:00-04:00", "America/New_York"],
    ["2031-03-09T01:59:00-05:00", "America/New_York"],
    ["2031-03-09T03:00:00-04:00", "America/New_York"],
    ["2031-11-02T01:30:00-04:00", "America/New_York"],
    ["2031-11-02T01:30:00-05:00", "America/New_York"],
    ["2031-01-11T00:00:00-05:00", "America/Bogota"],
    ["2031-06-30T17:00:00+05:30", "Asia/Kolkata"],
    ["2031-06-30T17:00:00Z", "UTC"],
  ] as const;

  it("reads to the letter as it always did: in the conference's time zone, which is named", () => {
    for (const lang of LANGS) {
      for (const [iso, timeZone] of written) {
        const before = formatDateTime(iso, lang, timeZone);
        const stated = statedWhen(iso, lang, timeZone);
        expect(stated, `${lang} ${iso}`).toMatchObject({ when: before, clock: "conference" });
        expect(clockName(stated, timeZone, said(lang))).toBe(timeZone);
        expect(deadlineText(iso, lang, timeZone, said(lang))).toBe(`${before} (${timeZone})`);
        // The short form is only shorter where there is an abbreviation to use.
        expect(deadlineText(iso, lang, timeZone, said(lang), true)).toBe(`${before} (${timeZone})`);
      }
    }
  });

  it("has the visitor's own time beside it whenever their time zone is another one", () => {
    const iso = "2031-02-28T23:59:00-05:00";
    expect(ownTime(iso, "en", "America/New_York", "America/New_York")).toBeNull();
    expect(ownTime(iso, "en", "America/New_York", "Europe/Lisbon")).toBe(
      formatDateTime(iso, "en", "Europe/Lisbon"),
    );
    // Even where the two clocks agree: that is how it was, and the names differ.
    expect(ownTime(iso, "en", "America/New_York", "America/Toronto")).toBe(
      formatDateTime(iso, "en", "America/Toronto"),
    );
  });
});

describe("a deadline written anywhere on Earth", () => {
  const iso = "2031-02-14T23:59:00-12:00";
  const tz = "America/Bogota";

  it("reads as the call states it, not as the hour it is in the conference's city", () => {
    const stated = statedWhen(iso, "en", tz);
    expect(stated.clock).toBe("aoe");
    // Any space will do between the time and "PM": browsers use a narrow one.
    expect(stated.when).toMatch(/^Feb 14, 2031, 11:59\sPM$/);
    expect(formatDateTime(iso, "en", tz)).toMatch(/^Feb 15, 2031, 6:59\sAM$/);
    expect(statedWhen(iso, "es", tz).when).toBe("14 feb 2031, 23:59");
    expect(statedWhen(iso, "pt", tz).when).toBe("14 de fev. de 2031, 23:59");
  });

  it("is named in the page's language, in a sentence, alone, and short", () => {
    const when = (lang: Lang) => statedWhen(iso, lang, tz).when;
    expect(deadlineText(iso, "en", tz, said("en"))).toBe(`${when("en")}, anywhere on Earth (AoE)`);
    expect(deadlineText(iso, "es", tz, said("es"))).toBe(
      "14 feb 2031, 23:59, en cualquier lugar del mundo (AoE)",
    );
    expect(deadlineText(iso, "pt", tz, said("pt"))).toBe(
      "14 de fev. de 2031, 23:59, em qualquer lugar do mundo (AoE)",
    );
    expect(deadlineText(iso, "en", tz, said("en"), true)).toBe(`${when("en")} AoE`);
    expect(deadlineText(iso, "es", tz, said("es"), true)).toBe("14 feb 2031, 23:59 AoE");
    expect(clockName(statedWhen(iso, "en", tz), tz, said("en"))).toBe("Anywhere on Earth (AoE)");
    expect(clockName(statedWhen(iso, "es", tz), tz, said("es"))).toBe(
      "En cualquier lugar del mundo (AoE)",
    );
  });

  it("has the visitor's own time beside it, wherever they are", () => {
    expect(ownTime(iso, "en", tz, "Europe/Lisbon")).toBe(
      formatDateTime(iso, "en", "Europe/Lisbon"),
    );
    expect(ownTime(iso, "en", tz, tz)).toBe(formatDateTime(iso, "en", tz));
  });
});

describe("a deadline written in any other offset", () => {
  const tz = "America/Bogota";

  it("reads as written, with the offset named", () => {
    const utc = "2031-04-30T23:59:00Z";
    expect(deadlineText(utc, "es", tz, said("es"))).toBe("30 abr 2031, 23:59 (UTC)");
    const pacific = "2031-04-30T23:59:00-08:00";
    const stated = statedWhen(pacific, "es", tz);
    expect(stated).toMatchObject({ when: "30 abr 2031, 23:59", clock: "offset" });
    expect(clockName(stated, tz, said("es"))).toBe(stated.offset);
    expect(deadlineText(pacific, "es", tz, said("es"))).toBe(
      `30 abr 2031, 23:59 (${stated.offset})`,
    );
    expect(stated.offset).toMatch(/^UTC.08:00$/);
  });

  it("has the visitor's own time beside it only where that says something else", () => {
    const utc = "2031-04-30T23:59:00Z";
    expect(ownTime(utc, "en", tz, "UTC")).toBeNull();
    expect(ownTime(utc, "en", tz, "Atlantic/Reykjavik")).toBeNull();
    expect(ownTime(utc, "en", tz, tz)).toBe(formatDateTime(utc, "en", tz));
  });
});

describe("how a theme is set", () => {
  it("large when it is a few words, as prose when it is a sentence", () => {
    expect(isShortTheme("Nothing in Particular")).toBe(true);
    expect(themeClass("Nothing in Particular")).toBe("hero-theme");
    const sentence = "Who makes the things nobody asked for, and who reads them afterwards.";
    expect(isShortTheme(sentence)).toBe(false);
    expect(themeClass(sentence)).toBe("hero-theme long");
  });
});

describe("the limits a number input shows", () => {
  it("are the field's own for a number that may have a fraction", () => {
    expect(numberLimits({ min: 0.5, max: 2.5 })).toEqual({ min: 0.5, max: 2.5, step: "any" });
    expect(numberLimits({})).toEqual({ min: undefined, max: undefined, step: "any" });
  });

  it("are whole numbers for a whole-number field, as the call's workshop has them", () => {
    expect(numberLimits({ min: 15, max: 30, integer: true })).toEqual({
      min: 15,
      max: 30,
      step: 1,
    });
  });

  it("are the whole numbers inside a range whose ends have fractions", () => {
    // 15 is the one answer the server takes; the control must offer it and nothing beside it.
    expect(numberLimits({ min: 14.5, max: 15.5, integer: true })).toEqual({
      min: 15,
      max: 15,
      step: 1,
    });
    expect(numberLimits({ min: -2.5, max: 2.5, integer: true })).toEqual({
      min: -2,
      max: 2,
      step: 1,
    });
  });

  it("leave an end that is not set open", () => {
    expect(numberLimits({ min: 0.2, integer: true })).toEqual({ min: 1, max: undefined, step: 1 });
    expect(numberLimits({ max: 9.9, integer: true })).toEqual({ min: undefined, max: 9, step: 1 });
    expect(numberLimits({ integer: true })).toEqual({ min: undefined, max: undefined, step: 1 });
  });
});
