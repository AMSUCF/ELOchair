import { CONFERENCE_PHASES, MESSAGE_KEYS, MESSAGES, REVIEW_EMAILS } from "@elochair/schema/pure";
import { describe, expect, it } from "vitest";
import { LANGS, translate } from "./i18n";
import { en } from "./i18n/en";
import {
  callStateKey,
  chipKey,
  chipTone,
  emailNameKey,
  emailWhenKey,
  phaseKey,
  phaseTone,
  placeholderKey,
} from "./labels";

describe("what a conference's chip says", () => {
  it("says the call is open only while the server says it is", () => {
    expect(en[chipKey({ phase: "cfp_open", callState: "open" })]).toBe("Call for proposals open");
    // The phase is "call for proposals open" from the day the chairs open it, whatever the
    // dates say: before the opening date and after the closing date the chip says so.
    expect(en[chipKey({ phase: "cfp_open", callState: "upcoming" })]).toBe("Call opening soon");
    expect(en[chipKey({ phase: "cfp_open", callState: "closed" })]).toBe("Submissions closed");
  });

  it("is the phase's name in every other phase, as before", () => {
    for (const phase of CONFERENCE_PHASES) {
      if (phase === "cfp_open") continue;
      for (const callState of ["upcoming", "closed"] as const) {
        expect(chipKey({ phase, callState }), phase).toBe(phaseKey(phase));
        expect(chipTone({ phase, callState }), phase).toBe(phaseTone(phase));
      }
    }
    expect(en[chipKey({ phase: "draft", callState: "upcoming" })]).toBe("Draft");
    expect(en[chipKey({ phase: "reviewing", callState: "closed" })]).toBe("In review");
    expect(en[chipKey({ phase: "archived", callState: "closed" })]).toBe("Archived");
  });

  it("is green only for an open call", () => {
    expect(chipTone({ phase: "cfp_open", callState: "open" })).toBe("good");
    expect(chipTone({ phase: "cfp_open", callState: "upcoming" })).toBe("info");
    expect(chipTone({ phase: "cfp_open", callState: "closed" })).toBe("quiet");
  });

  it("names the three states of a call as the invitation does", () => {
    expect(en[callStateKey("open")]).toBe("Call for proposals");
    expect(en[callStateKey("upcoming")]).toBe("Call opening soon");
    expect(en[callStateKey("closed")]).toBe("Submissions closed");
  });
});

describe("what the settings screen says of each email", () => {
  const REVIEW_PHASE = [
    "new_assignments",
    "review_reminder",
    "reviewer_declined",
    "reviews_complete",
  ] as const;
  /** What the screen hands those sentences: the hour and the days the server goes by. */
  const numbers = { hour: `${REVIEW_EMAILS.dailyHour}:00`, days: REVIEW_EMAILS.reminderDays };

  it("has a name, a line about when it is sent, and a meaning for every placeholder, in each language", () => {
    for (const lang of LANGS) {
      for (const key of MESSAGE_KEYS) {
        expect(translate(lang, emailNameKey(key)).trim(), `${lang} ${key}`).not.toBe("");
        // Nothing is left in braces once the numbers are in.
        expect(translate(lang, emailWhenKey(key), numbers), `${lang} ${key}`).not.toMatch(/[{}]/);
        for (const name of MESSAGES[key].placeholders) {
          expect(
            translate(lang, placeholderKey(key, name)).trim(),
            `${lang} ${key} ${name}`,
          ).not.toBe("");
        }
      }
    }
  });

  it("says the hour of a day's summary and the days before the reminder as the server has them", () => {
    expect(numbers).toEqual({ hour: "8:00", days: 3 });
    for (const lang of LANGS) {
      for (const key of REVIEW_PHASE) {
        const line = translate(lang, emailWhenKey(key), numbers);
        expect(line, `${lang} ${key}`).toContain("8:00");
        // The numbers come from the server's constants, never from the catalog.
        expect(translate(lang, emailWhenKey(key)), `${lang} ${key}`).toContain("{hour}");
      }
      expect(translate(lang, emailWhenKey("review_reminder"), numbers)).toMatch(
        /\b3 (days|días|dias)\b/,
      );
      const hint = translate(lang, "settingsReminderDaysHint", numbers);
      expect(hint).toContain("8:00");
      expect(hint).toMatch(/\b3 (days|días|dias)\b/);
      expect(hint).not.toMatch(/[{}]/);
    }
  });

  it("tells what the number counts in each email that has one, and where each link leads", () => {
    const counted = REVIEW_PHASE.map((key) => en[placeholderKey(key, "count")]);
    expect(new Set(counted).size).toBe(4);
    expect(en[placeholderKey("new_assignments", "link")]).toBe(
      "the link to the reviewer's list, “My reviews”",
    );
    expect(en[placeholderKey("review_reminder", "link")]).toBe(
      en[placeholderKey("new_assignments", "link")],
    );
    expect(en[placeholderKey("reviewer_declined", "link")]).toBe(
      "the link to the conference's Assignments page",
    );
    expect(en[placeholderKey("reviews_complete", "link")]).toBe(
      en[placeholderKey("reviewer_declined", "link")],
    );
    // The others are as they were.
    expect(en[placeholderKey("submission_received", "link")]).toBe("the link to the proposal");
    expect(en[placeholderKey("submission_received", "deadline")]).toBe(
      "the date and time the call closes, in the conference's time zone",
    );
  });
});
