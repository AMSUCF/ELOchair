import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { formatAnchor, headlineParts, invites, languageChoice, mainAction } from "./invitation";

const group = {
  key: "talks",
  name: { en: "Talking" },
  summary: { en: "Talks." },
  formats: ["talk"],
};

describe("whether a conference invites", () => {
  it("goes by what its configuration holds: any of the three", () => {
    expect(invites({ contributionGroups: [] })).toBe(false);
    expect(invites({ invitation: { en: "Come." }, contributionGroups: [] })).toBe(true);
    expect(invites({ distinction: { en: "The first." }, contributionGroups: [] })).toBe(true);
    expect(invites({ contributionGroups: [group] })).toBe(true);
  });
});

describe("the invitation's main action", () => {
  const action = (state: Parameters<typeof mainAction>[0]) => {
    const { label, to } = mainAction(state, "made-up-2031", "es");
    return [en[label], to];
  };

  it("starts a proposal while the call is open", () => {
    expect(action("open")).toEqual(["Start a proposal", "/es/c/made-up-2031/submit"]);
  });

  it("leads to what the formats ask for before the call opens", () => {
    expect(action("upcoming")).toEqual(["Prepare a proposal", "/es/c/made-up-2031#formats"]);
  });

  it("leads to the person's own proposals once the call has closed", () => {
    expect(action("closed")).toEqual(["View my proposals", "/es/my"]);
  });
});

describe("the languages proposals may be in", () => {
  it("are named in the language of the page, as a choice", () => {
    expect(languageChoice(["en", "es"], "en")).toBe("English or Spanish");
    expect(languageChoice(["en", "es"], "es")).toBe("inglés o español");
    expect(languageChoice(["en", "es"], "pt")).toBe("inglês ou espanhol");
  });

  it("may be one, or more than two", () => {
    expect(languageChoice(["en"], "en")).toBe("English");
    expect(languageChoice(["en", "es", "pt"], "es")).toBe("inglés, español o portugués");
  });
});

describe("the headline", () => {
  it("sets a theme's first word apart from the rest", () => {
    expect(headlineParts("Nothing in Particular")).toEqual({
      lead: "Nothing",
      rest: "in Particular",
    });
    expect(headlineParts("  Nada en  particular ")).toEqual({
      lead: "Nada",
      rest: "en particular",
    });
    expect(headlineParts("Nothing")).toEqual({ lead: "Nothing", rest: "" });
    expect(headlineParts("")).toEqual({ lead: "", rest: "" });
  });
});

describe("where a way to contribute leads", () => {
  it("is the card of a format on the conference's page", () => {
    expect(formatAnchor("artist_talk")).toBe("format-artist_talk");
  });
});
