import type { SubmissionType } from "@elochair/schema";
import { describe, expect, it } from "vitest";
import {
  chosenIndex,
  formatAction,
  formatAnchor,
  formatAsks,
  formatFigures,
  listedFormats,
  startAddress,
  startingFormat,
  steppedIndex,
  two,
} from "./formats";
import { en } from "./i18n/en";

/** A made-up format; each test changes what it is about. */
const format = (key: string, change: Partial<SubmissionType> = {}): SubmissionType => ({
  key,
  name: { en: `The ${key}`, es: `El ${key}` },
  description: { en: `What a ${key} is.` },
  reviewPool: "committee",
  abstract: { label: { en: "Summary" }, maxWords: 120 },
  team: { min: 1, max: 3 },
  countsTowardPresenterCap: true,
  fields: [],
  ...change,
});

/** A made-up call: three formats submitted here and one that is sent some other way. */
const call = {
  submissionTypes: [format("talk"), format("talk_long"), format("show")],
  otherFormats: [
    { key: "pitch", name: { en: "The pitch" }, description: { en: "Sent by post, not here." } },
  ],
};
const formats = listedFormats(call);

describe("the formats a call lists", () => {
  it("are those submitted here, in the call's order, and then those that are not", () => {
    expect(formats.map((f) => f.key)).toEqual(["talk", "talk_long", "show", "pitch"]);
    expect(formats.map((f) => f.name.en)).toEqual([
      "The talk",
      "The talk_long",
      "The show",
      "The pitch",
    ]);
    expect(formats.at(-1)?.description).toEqual({ en: "Sent by post, not here." });
  });

  it("carry what the form asks for only when they are submitted here", () => {
    expect(formats.map((f) => f.type?.key)).toEqual(["talk", "talk_long", "show", undefined]);
  });

  it("are numbered with two digits, as the page sets them", () => {
    expect([1, 8, 12].map(two)).toEqual(["01", "08", "12"]);
  });
});

describe("the format an address chooses", () => {
  it("is the one its #format-<key> names, submitted here or not", () => {
    expect(formatAnchor("talk_long")).toBe("format-talk_long");
    expect(chosenIndex(formats, "#format-show")).toBe(2);
    expect(chosenIndex(formats, "#format-pitch")).toBe(3);
    // A key that begins like another is not mistaken for it.
    expect(chosenIndex(formats, "#format-talk")).toBe(0);
    expect(chosenIndex(formats, "#format-talk_long")).toBe(1);
  });

  it("is the first for the section's own address, for none, and for a format the call lacks", () => {
    for (const hash of ["#formats", "", "#", "#deadlines", "#format-", "#format-opera", "show"]) {
      expect(chosenIndex(formats, hash), hash).toBe(0);
    }
    expect(chosenIndex([], "#format-talk")).toBe(0);
  });
});

describe("Previous and Next", () => {
  it("step to the format before or after", () => {
    expect(steppedIndex(4, 1, 1)).toBe(2);
    expect(steppedIndex(4, 1, -1)).toBe(0);
  });

  it("go round at the ends, as the design preview does", () => {
    expect(steppedIndex(4, 3, 1)).toBe(0);
    expect(steppedIndex(4, 0, -1)).toBe(3);
  });

  it("stay where they are in a call of one format", () => {
    expect(steppedIndex(1, 0, 1)).toBe(0);
    expect(steppedIndex(1, 0, -1)).toBe(0);
    expect(steppedIndex(0, 0, 1)).toBe(0);
  });
});

describe("where “Start this proposal” leads", () => {
  it("is the start page, with the format named in the address", () => {
    expect(startAddress("es", "made-up-2031", "talk_long")).toBe(
      "/es/c/made-up-2031/submit?format=talk_long",
    );
  });

  it("begins the form with that format when the call takes it here, and otherwise with the first", () => {
    const types = call.submissionTypes;
    expect(startingFormat(types, "show")).toBe("show");
    expect(startingFormat(types, null)).toBe("talk");
    expect(startingFormat(types, "")).toBe("talk");
    expect(startingFormat(types, "opera")).toBe("talk");
    // A format that is not submitted here cannot be started here.
    expect(startingFormat(types, "pitch")).toBe("talk");
    expect(startingFormat([], "show")).toBe("");
  });
});

describe("what the panel offers", () => {
  const [talk] = formats;
  const pitch = formats.at(-1);
  if (!talk || !pitch) throw new Error("the made-up call has no formats");

  it("goes by where the call stands for a format submitted here", () => {
    expect(formatAction(talk, "open")).toBe("start");
    expect(formatAction(talk, "upcoming")).toBe("opens");
    expect(formatAction(talk, "closed")).toBe("closed");
  });

  it("is the way elsewhere for a format that is not, whatever the state of the call", () => {
    for (const state of ["open", "upcoming", "closed"] as const) {
      expect(formatAction(pitch, state)).toBe("elsewhere");
    }
  });
});

describe("a format's figures", () => {
  const shown = (type: SubmissionType, lang = "en") =>
    formatFigures(type, lang).map((figure) => `${figure.value} ${en[figure.label]}`);

  it("are the words of its abstract, the minutes of its slot and the people on a proposal", () => {
    expect(
      shown(
        format("talk", {
          abstract: { label: { en: "Summary" }, minWords: 250, maxWords: 300 },
          durationMinutes: 12,
          team: { min: 1, max: 4 },
        }),
      ),
    ).toEqual(["250–300 words", "12 minutes", "1–4 people"]);
  });

  it("say “at most” where the call gives no fewest words, or lets the abstract be empty", () => {
    expect(shown(format("talk"))[0]).toBe("120 words at most");
    expect(
      shown(format("talk", { abstract: { label: { en: "S" }, minWords: 0, maxWords: 90 } }))[0],
    ).toBe("90 words at most");
  });

  it("leave the minutes out for a format without a slot", () => {
    expect(shown(format("show"))).toEqual(["120 words at most", "1–3 people"]);
  });

  it("say a number once when the fewest and the most are the same", () => {
    expect(
      shown(
        format("duo", {
          abstract: { label: { en: "S" }, minWords: 100, maxWords: 100 },
          team: { min: 2, max: 2 },
        }),
      ),
    ).toEqual(["100 words", "2 people"]);
  });

  it("say “person” for a format of one, in a language that tells one from many", () => {
    const solo = format("solo", { team: { min: 1, max: 1 } });
    expect(shown(solo).at(-1)).toBe("1 person");
    expect(formatFigures(solo, "es").at(-1)?.label).toBe("statPerson");
    expect(formatFigures(solo, "ja").at(-1)?.label).toBe("statPeople");
  });
});

describe("what the form of a format asks for", () => {
  const asked = (type: SubmissionType) =>
    formatAsks(type).map((a) => `${a.label.en}${a.required ? " (required)" : ""}`);
  const field = (key: string, required: boolean) => ({
    key,
    label: { en: `The ${key}` },
    kind: "text" as const,
    required,
    identifying: false,
    public: false,
  });

  it("is the abstract, by what the format calls it, when the format has no fields of its own", () => {
    expect(asked(format("talk"))).toEqual(["Summary (required)"]);
    expect(formatAsks(format("talk")).map((a) => a.id)).toEqual(["abstract"]);
  });

  it("is the abstract and then the format's fields, the required ones marked", () => {
    const type = format("show", {
      abstract: { label: { en: "Statement" }, maxWords: 200 },
      fields: [field("needs", true), field("link", false)],
    });
    expect(asked(type)).toEqual(["Statement (required)", "The needs (required)", "The link"]);
    // A field may be called what the abstract is called here: the two stay apart.
    const ids = formatAsks(format("odd", { fields: [field("abstract", false)] })).map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("does not call the abstract required when it may be left empty", () => {
    const type = format("loose", {
      abstract: { label: { en: "Note" }, minWords: 0, maxWords: 50 },
    });
    expect(asked(type)).toEqual(["Note"]);
  });
});
