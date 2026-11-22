/*
 * A deadline as its call states it. A deadline is stored with the offset it was written with
 * ("2027-02-14T23:59:00-12:00"; spec 02, §1.9), and people set what a page shows beside what
 * the call says. So a page shows the date and the time as written, and says which clock that
 * is, instead of turning every deadline into the conference's time zone. Zod-free.
 */

/**
 * The clock a deadline was written on:
 * - "conference": the conference's own time zone, whose offset at that instant is the one
 *   written. This is how deadlines were always shown.
 * - "aoe": anywhere on Earth, which is UTC−12. A deadline written so has passed everywhere
 *   once it has passed.
 * - "offset": any other offset.
 */
export type DeadlineClock = "conference" | "aoe" | "offset";

export type StatedDeadline = {
  /**
   * The date and the time as written. It is an instant to format with `timeZone: "UTC"`: the
   * written offset is already applied. (A fixed-offset time zone would say the same, but only
   * recent browsers take one.)
   */
  wallClock: Date;
  clock: DeadlineClock;
  /** The written offset, for a label: "UTC−05:00", "UTC+05:30", and "UTC" for none. */
  offset: string;
};

const WRITTEN_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
/** Anywhere on Earth: twelve hours behind UTC. */
const AOE_MINUTES = -12 * 60;

/** The minutes east of UTC that a written offset stands for ("-05:00" is -300). */
function minutesOf(offset: string): number {
  if (offset === "Z") return 0;
  const [hours = "0", minutes = "0"] = offset.slice(1).split(":");
  return (offset.startsWith("-") ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/** The minutes east of UTC of a time zone at an instant, or null for a zone that is not one. */
function zoneMinutes(timeZone: string, instant: number): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const there = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    return Math.round((there - Math.floor(instant / 1000) * 1000) / 60_000);
  } catch {
    return null;
  }
}

/** "UTC−05:00" for -300. The minus is the minus sign (U+2212), not a hyphen. */
function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const two = (n: number) => String(n).padStart(2, "0");
  const size = Math.abs(minutes);
  return `UTC${minutes < 0 ? "\u2212" : "+"}${two(Math.floor(size / 60))}:${two(size % 60)}`;
}

/**
 * How a stored deadline reads as it was written, for a conference in `timeZone`.
 *
 * The conference's own clock is asked first: a deadline written in the offset its time zone
 * has at that instant (daylight saving included) is on "conference" time, and reads as it
 * always did. Otherwise an offset of twelve hours behind UTC is "aoe", and anything else is
 * its "offset".
 *
 * A text without a written offset cannot be a stored deadline (the schema refuses it): it is
 * read on the conference's clock.
 */
export function statedDeadline(iso: string, timeZone: string): StatedDeadline {
  const instant = Date.parse(iso);
  const zone = zoneMinutes(timeZone, instant);
  const written = WRITTEN_OFFSET.exec(iso)?.[1];
  const minutes = written === undefined ? (zone ?? 0) : minutesOf(written);
  const clock: DeadlineClock =
    written === undefined || minutes === zone
      ? "conference"
      : minutes === AOE_MINUTES
        ? "aoe"
        : "offset";
  return {
    wallClock: new Date(instant + minutes * 60_000),
    clock,
    offset: offsetLabel(minutes),
  };
}
