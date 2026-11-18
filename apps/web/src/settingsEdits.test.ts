import type { Setting } from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { restoredEdits } from "./settingsEdits";

/** Settings as the screen lists them: only what restoring looks at is filled in. */
const setting = (path: string, kind: Setting["kind"]) =>
  ({ path, kind, id: "title", optional: false, value: undefined }) satisfies Setting;

const settings: Setting[] = [
  setting("title.en", "text"),
  setting("placeholder", "bool"),
  setting("deadlines.submissionsClose", "datetime"),
  setting("submissionTypes.paper.abstract.maxWords", "int"),
  setting("submissionTypes.workshop.fields.people.min", "number"),
];

describe("restoredEdits", () => {
  it("puts back what was typed, as it was typed: numbers are still text here", () => {
    const stored = {
      "title.en": "ELO 2027 (draft)",
      placeholder: false,
      "submissionTypes.paper.abstract.maxWords": "320",
      "submissionTypes.workshop.fields.people.min": "15.5",
      "deadlines.submissionsClose#date": "2027-02-15",
      "deadlines.submissionsClose#offset": "-12:00",
    };
    expect(restoredEdits(stored, settings)).toEqual(stored);
  });

  it("is empty when nothing was kept", () => {
    expect(restoredEdits(undefined, settings)).toEqual({});
    expect(restoredEdits({}, settings)).toEqual({});
  });

  it("leaves out an edit to a value that is no longer a setting", () => {
    expect(
      restoredEdits(
        {
          "submissionTypes.experimental.abstract.maxWords": "500",
          "title.pt": "ELO 2027",
          "deadlines.reviewsDue#date": "2027-03-01",
          "title.en": "ELO 2027",
        },
        settings,
      ),
    ).toEqual({ "title.en": "ELO 2027" });
  });

  it("leaves out an edit of the wrong kind or shape", () => {
    expect(
      restoredEdits(
        {
          "title.en": true,
          placeholder: "yes",
          "submissionTypes.paper.abstract.maxWords": 320,
          // A deadline is only ever typed in its parts, and nothing else has parts.
          "deadlines.submissionsClose": "2027-02-15T23:59:00-12:00",
          "deadlines.submissionsClose#seconds": "30",
          "deadlines.submissionsClose#time": 2359,
          "title.en#date": "2027-02-15",
        },
        settings,
      ),
    ).toEqual({});
  });
});
