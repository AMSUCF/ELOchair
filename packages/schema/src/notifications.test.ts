import { describe, expect, it } from "vitest";
import { REVIEW_EMAILS } from "./limits";
import {
  DEFAULT_NOTIFICATION_CHOICES,
  dailyHourAtOrBefore,
  hourOnDay,
  NOTICE_FREQUENCIES,
  NOTIFICATION_KINDS,
  reviewReminderWindow,
} from "./notifications";

/*
 * The emails of the review phase (spec 03, §1.7): the choices a person has, and the two moments
 * the server works out from a conference's clock: when a day's summary is due, and from when
 * the reminder before reviews are due.
 */

const at = (iso: string) => new Date(iso);
const hour = (instant: string, timeZone: string) =>
  dailyHourAtOrBefore(at(instant), timeZone, 8).toISOString();

describe("a person's choices", () => {
  it("are each one, one summary a day, or none; and a summary and the reminder by default", () => {
    expect(NOTICE_FREQUENCIES).toEqual(["each", "daily", "none"]);
    expect(DEFAULT_NOTIFICATION_CHOICES).toEqual({
      assignments: "daily",
      reminder: true,
      chairNotices: "daily",
    });
  });

  it("are about three things that happen, by names that are stored", () => {
    expect(NOTIFICATION_KINDS).toEqual(["assigned", "declined", "reviews_complete"]);
  });
});

describe("the hour a day's summary goes out", () => {
  it("is eight in the morning", () => {
    expect(REVIEW_EMAILS.dailyHour).toBe(8);
  });

  it("is today's, once the conference's clock has reached it", () => {
    // Bogotá is five hours behind UTC all year: eight there is 13:00 UTC.
    expect(hour("2031-03-10T13:00:00Z", "America/Bogota")).toBe("2031-03-10T13:00:00.000Z");
    expect(hour("2031-03-10T13:00:01Z", "America/Bogota")).toBe("2031-03-10T13:00:00.000Z");
    expect(hour("2031-03-11T04:59:59Z", "America/Bogota")).toBe("2031-03-10T13:00:00.000Z");
  });

  it("is yesterday's until then", () => {
    expect(hour("2031-03-10T12:59:59Z", "America/Bogota")).toBe("2031-03-09T13:00:00.000Z");
    // Just after midnight in Bogotá, which is already the next day in UTC.
    expect(hour("2031-03-10T05:00:00Z", "America/Bogota")).toBe("2031-03-09T13:00:00.000Z");
  });

  it("is read on the conference's own clock, east or west of UTC", () => {
    expect(hour("2031-03-10T12:00:00Z", "UTC")).toBe("2031-03-10T08:00:00.000Z");
    expect(hour("2031-03-10T07:59:00Z", "UTC")).toBe("2031-03-09T08:00:00.000Z");
    // Tokyo is nine hours ahead: eight there is 23:00 UTC the day before.
    expect(hour("2031-03-10T12:00:00Z", "Asia/Tokyo")).toBe("2031-03-09T23:00:00.000Z");
    expect(hour("2031-03-10T23:30:00Z", "Asia/Tokyo")).toBe("2031-03-10T23:00:00.000Z");
    // Kolkata is five and a half hours ahead.
    expect(hour("2031-03-10T03:00:00Z", "Asia/Kolkata")).toBe("2031-03-10T02:30:00.000Z");
  });

  it("follows the clock through a change of the hour", () => {
    // Lisbon is on UTC in winter and an hour ahead from the last Sunday of March (the 30th in
    // 2031): eight in the morning is 08:00 UTC before, and 07:00 UTC after.
    expect(hour("2031-03-29T12:00:00Z", "Europe/Lisbon")).toBe("2031-03-29T08:00:00.000Z");
    expect(hour("2031-03-30T12:00:00Z", "Europe/Lisbon")).toBe("2031-03-30T07:00:00.000Z");
    expect(hour("2031-03-31T06:59:00Z", "Europe/Lisbon")).toBe("2031-03-30T07:00:00.000Z");
    // The morning of the change itself, before eight: still the day before's, on winter time.
    expect(hour("2031-03-30T06:30:00Z", "Europe/Lisbon")).toBe("2031-03-29T08:00:00.000Z");
  });

  it("is never after the instant asked about, and never more than a day and an hour before", () => {
    for (const timeZone of ["America/Bogota", "Europe/Lisbon", "Asia/Tokyo", "Pacific/Auckland"]) {
      for (let h = 0; h < 24 * 400; h += 7) {
        const instant = Date.UTC(2031, 0, 1) + h * 3_600_000 + 123_456;
        const got = dailyHourAtOrBefore(new Date(instant), timeZone, 8).getTime();
        expect(got, `${timeZone} ${new Date(instant).toISOString()}`).toBeLessThanOrEqual(instant);
        expect(instant - got).toBeLessThan(25 * 3_600_000);
      }
    }
  });
});

describe("the hour on a day of the conference's calendar", () => {
  const on = (instant: string, timeZone: string, daysBefore?: number) =>
    hourOnDay(at(instant), timeZone, 8, daysBefore).toISOString();

  it("is eight in the morning of the day the conference's clock shows, before or after the instant", () => {
    expect(on("2031-03-10T05:00:00Z", "America/Bogota")).toBe("2031-03-10T13:00:00.000Z");
    expect(on("2031-03-11T04:59:59Z", "America/Bogota")).toBe("2031-03-10T13:00:00.000Z");
    // The same instant is already the 11th in Tokyo.
    expect(on("2031-03-10T20:00:00Z", "Asia/Tokyo")).toBe("2031-03-10T23:00:00.000Z");
  });

  it("counts whole days back on that calendar, across a month's end and a change of the hour", () => {
    expect(on("2031-03-02T15:00:00Z", "America/Bogota", 3)).toBe("2031-02-27T13:00:00.000Z");
    // Lisbon moves its clocks on 30 March 2031: three days before 1 April is on winter time.
    expect(on("2031-04-01T12:00:00Z", "Europe/Lisbon", 3)).toBe("2031-03-29T08:00:00.000Z");
    expect(on("2031-04-01T12:00:00Z", "Europe/Lisbon", 1)).toBe("2031-03-31T07:00:00.000Z");
  });
});

describe("when a conference's reminder is due", () => {
  const conference = (reviewsDue?: string, reviewReminderDays?: number) => ({
    timezone: "America/Bogota",
    deadlines: {
      submissionsOpen: "2031-01-11T00:00:00-05:00",
      submissionsClose: "2031-02-14T23:59:00-12:00",
      notification: "2031-04-30T23:59:00-05:00",
      finalMaterials: "2031-05-31T23:59:00-05:00",
      ...(reviewsDue ? { reviewsDue } : {}),
    },
    rules: { presenterCap: null, ...(reviewReminderDays ? { reviewReminderDays } : {}) },
  });
  const window = (reviewsDue?: string, days?: number) => {
    const w = reviewReminderWindow(conference(reviewsDue, days));
    return w && { opens: w.opens.toISOString(), closes: w.closes.toISOString() };
  };

  it("is never, for a conference whose chairs have set no day", () => {
    expect(window()).toBeNull();
    expect(window(undefined, 5)).toBeNull();
  });

  it("is from eight in the morning three days before the day reviews are due, until that day", () => {
    // Due at the end of 31 March, Bogotá time: the reminder goes out on the morning of the 28th.
    expect(window("2031-03-31T23:59:00-05:00")).toEqual({
      opens: "2031-03-28T13:00:00.000Z",
      closes: "2031-04-01T04:59:00.000Z",
    });
  });

  it("is the chairs' number of days before, where they set one", () => {
    expect(window("2031-03-31T23:59:00-05:00", 1)?.opens).toBe("2031-03-30T13:00:00.000Z");
    expect(window("2031-03-31T23:59:00-05:00", 7)?.opens).toBe("2031-03-24T13:00:00.000Z");
  });

  it("counts the days on the conference's own calendar, whatever clock the day was written on", () => {
    // Noon UTC on the 31st is seven in the morning of the 31st in Bogotá: the reminder goes
    // out on the morning of the 28th there, at eight, though that is less than three days.
    expect(window("2031-03-31T12:00:00Z")?.opens).toBe("2031-03-28T13:00:00.000Z");
    // Anywhere on Earth: the end of the 31st at UTC-12 is 06:59 on 1 April in Bogotá, so the
    // day reviews are due is 1 April there, and the reminder's is 29 March.
    expect(window("2031-03-31T23:59:00-12:00")).toEqual({
      opens: "2031-03-29T13:00:00.000Z",
      closes: "2031-04-01T11:59:00.000Z",
    });
    // The reminder always goes out before the moment reviews are due.
    for (const due of ["2031-03-31T00:00:00-05:00", "2031-03-31T08:00:00-05:00"]) {
      const w = window(due, 1);
      expect(Date.parse(w?.opens ?? "")).toBeLessThan(Date.parse(w?.closes ?? ""));
      expect(w?.opens).toBe("2031-03-30T13:00:00.000Z");
    }
  });
});
