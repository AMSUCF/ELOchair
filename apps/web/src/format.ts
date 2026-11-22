import { type DeadlineClock, statedDeadline } from "@elochair/schema/pure";
import type { MessageKey } from "./i18n";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Date and time display, always with an explicit time zone. */
export function formatDateTime(iso: string, lang: string, timeZone: string): string {
  return new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** A deadline as its call states it: its date and time as written, and the clock they are on. */
export type Stated = { when: string; clock: DeadlineClock; offset: string };

/**
 * A deadline's date and time as they were written (statedDeadline; spec 02, §1.9), in the
 * page's language. On the conference's own clock this is formatDateTime in its time zone,
 * to the letter.
 */
export function statedWhen(iso: string, lang: string, timeZone: string): Stated {
  const { wallClock, clock, offset } = statedDeadline(iso, timeZone);
  return { when: formatDateTime(wallClock.toISOString(), lang, "UTC"), clock, offset };
}

/**
 * The name of the clock a deadline is stated on: the conference's time zone, "Anywhere on
 * Earth (AoE)", or the offset it was written in ("UTC−08:00").
 */
export const clockName = (stated: Stated, timeZone: string, t: Translate): string =>
  stated.clock === "conference" ? timeZone : stated.clock === "aoe" ? t("clockAoe") : stated.offset;

/**
 * A deadline with its clock, for a sentence or a line: "Feb 28, 2031, 11:59 PM
 * (America/New_York)" on the conference's clock, as always; "Feb 14, 2031, 11:59 PM, anywhere
 * on Earth (AoE)"; "Apr 30, 2031, 11:59 PM (UTC−08:00)". `short` says "… AoE", for the line
 * where the invitation says when proposals are due.
 */
export function deadlineText(
  iso: string,
  lang: string,
  timeZone: string,
  t: Translate,
  short = false,
): string {
  const stated = statedWhen(iso, lang, timeZone);
  if (stated.clock === "aoe") {
    return t(short ? "deadlineAoeShort" : "deadlineAoe", { when: stated.when });
  }
  return `${stated.when} (${clockName(stated, timeZone, t)})`;
}

/**
 * The same instant on the visitor's own clock, to show beside a stated deadline; null where
 * that would only repeat it. Beside conference time it is shown whenever the visitor's time
 * zone is another one, as it always was.
 */
export function ownTime(
  iso: string,
  lang: string,
  timeZone: string,
  mine = viewerTimeZone(),
): string | null {
  const stated = statedWhen(iso, lang, timeZone);
  const ours = formatDateTime(iso, lang, mine);
  const repeats = stated.clock === "conference" ? mine === timeZone : ours === stated.when;
  return repeats ? null : ours;
}

/** A calendar date ("2027-07-14") shown without shifting across time zones. */
export function formatDate(isoDate: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate}T12:00:00Z`),
  );
}

export function formatDateRange(start: string, end: string, lang: string): string {
  const f = new Intl.DateTimeFormat(lang, { dateStyle: "long", timeZone: "UTC" });
  return f.formatRange(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));
}

export const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A theme of a few words is set large; a sentence reads as prose. */
export const isShortTheme = (theme: string) => theme.length <= 48;
export const themeClass = (theme: string) =>
  isShortTheme(theme) ? "hero-theme" : "hero-theme long";

/** "10.96° N 74.80° W": coordinates the way the conference's site writes them. */
export function formatCoordinates({ lat, lon }: { lat: number; lon: number }): string {
  const part = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, "N", "S")} ${part(lon, "E", "W")}`;
}

/** Whole days from `now` until `iso`, rounded up; never negative. For display only. */
export function daysUntil(iso: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 86_400_000));
}

/**
 * Whether a format's abstract has a minimum length to show. Some calls give only a maximum:
 * their configuration then has no `minWords`, and the abstract only has to be there.
 */
export const hasMinimum = (minWords: number | undefined): minWords is number =>
  minWords !== undefined && minWords > 0;

/**
 * The limits and the step a number input shows for a field. For a whole-number field they are
 * the whole numbers its range holds (14.5 to 15.5 takes 15 and nothing else): the control then
 * steps only to values the server accepts.
 */
export function numberLimits(field: {
  min?: number | undefined;
  max?: number | undefined;
  integer?: boolean | undefined;
}): { min: number | undefined; max: number | undefined; step: number | "any" } {
  if (!field.integer) return { min: field.min, max: field.max, step: "any" };
  return {
    min: field.min === undefined ? undefined : Math.ceil(field.min),
    max: field.max === undefined ? undefined : Math.floor(field.max),
    step: 1,
  };
}
