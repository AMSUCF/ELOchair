/** Date and time display, always with an explicit time zone. */
export function formatDateTime(iso: string, lang: string, timeZone: string): string {
  return new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
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
