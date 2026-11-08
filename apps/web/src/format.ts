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
