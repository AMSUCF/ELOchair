import type { ConferenceConfig } from "./config";
import { zoneMinutes } from "./deadline";
import { REVIEW_EMAILS } from "./limits";

/*
 * The emails of the review phase (spec 03, §1.7): what a person is told about, how often they
 * choose to be, and the two moments the server works out from a conference's clock. Zod-free,
 * so that "Your account" and the server share these definitions.
 *
 * Something that happens (a proposal is assigned, a reviewer gives one back, a proposal has all
 * its reviews) is recorded for each person it concerns, as a notification. Whether and when an
 * email is made of it is decided afterwards, by that person's choice: at once, in one summary a
 * day, or never.
 */

/** How often a person is emailed about something: each time, in one summary a day, or never. */
export const NOTICE_FREQUENCIES = ["each", "daily", "none"] as const;
export type NoticeFrequency = (typeof NOTICE_FREQUENCIES)[number];

/**
 * What a person is told about at a conference:
 * - `assigned`: to a reviewer, a proposal was assigned to them;
 * - `declined`: to a chair, a reviewer said they cannot review a proposal and gave it back;
 * - `reviews_complete`: to a chair, a proposal has as many sent reviews as its committee asks.
 */
export const NOTIFICATION_KINDS = ["assigned", "declined", "reviews_complete"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * One person's choices at one conference. The first two are a reviewer's, the third a chair's;
 * each is kept whether or not the person holds that role now, and read only while they do.
 */
export type NotificationChoices = {
  /** When proposals are assigned to them. */
  assignments: NoticeFrequency;
  /** The one reminder before reviews are due. */
  reminder: boolean;
  /** For a chair: a reviewer cannot review a proposal, or a proposal has all its reviews. */
  chairNotices: NoticeFrequency;
};

/** What holds for someone who has chosen nothing: a summary a day, and the reminder. */
export const DEFAULT_NOTIFICATION_CHOICES: NotificationChoices = {
  assignments: "daily",
  reminder: true,
  chairNotices: "daily",
};

/**
 * The moment the clock of `timeZone` reads `hour` o'clock on the calendar day that clock shows
 * at `instant`, or on the day `daysBefore` days before it. (Where clocks change, the answer may
 * be an hour off on that one day: nothing here needs more.)
 */
export function hourOnDay(instant: Date, timeZone: string, hour: number, daysBefore = 0): Date {
  const t = instant.getTime();
  const offsetAt = (ms: number) => (zoneMinutes(timeZone, ms) ?? 0) * 60_000;
  const offset = offsetAt(t);
  // The calendar day the zone's clock shows at that instant, with the hour on it.
  const local = new Date(t + offset);
  const wall = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysBefore,
    hour,
  );
  // The instant at which the zone's clock shows that: by the offset in force there.
  const guess = wall - offset;
  const there = offsetAt(guess);
  return new Date(there === offset ? guess : wall - there);
}

/**
 * The last moment, at or before `instant`, when the clock of `timeZone` read `hour` o'clock:
 * the same day's, or the day before's if the same day's has not come yet. A summary is due once
 * this moment is later than the oldest thing it holds.
 */
export function dailyHourAtOrBefore(instant: Date, timeZone: string, hour: number): Date {
  const today = hourOnDay(instant, timeZone, hour);
  return today.getTime() <= instant.getTime() ? today : hourOnDay(instant, timeZone, hour, 1);
}

/** How many days before the day reviews are due a conference's reminder goes out. */
export function reviewReminderDays(config: Pick<ConferenceConfig, "rules">): number {
  return config.rules.reviewReminderDays ?? REVIEW_EMAILS.reminderDays;
}

/**
 * From when a conference's reminder is due, and until when: from the summary's hour on the day
 * that is the chairs' number of days before the day reviews are due (both days as the
 * conference's own clock shows them), until the moment reviews are due. Null for a conference
 * whose chairs have set no day: it has no reminder.
 */
export function reviewReminderWindow(
  config: Pick<ConferenceConfig, "deadlines" | "rules" | "timezone">,
): { opens: Date; closes: Date } | null {
  const due = config.deadlines.reviewsDue;
  if (!due) return null;
  const closes = new Date(due);
  return {
    opens: hourOnDay(closes, config.timezone, REVIEW_EMAILS.dailyHour, reviewReminderDays(config)),
    closes,
  };
}
