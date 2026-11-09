import type { ChairContributor, ChairSubmission } from "@elochair/policy";
import { type ConferenceConfig, findType, localize } from "@elochair/schema";

/*
 * CSV exports for chairs: RFC 4180 quoting, a UTF-8 BOM (so Excel reads "Rodríguez" and
 * "São Paulo" correctly), and protection against formula injection: any cell that a
 * spreadsheet could read as a formula is prefixed with an apostrophe.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : Array.isArray(value)
        ? value.join("; ")
        : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Times in the conference's own time zone, ISO-like with the offset. */
function localTime(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const offset = (parts.timeZoneName ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** A short, stable reference chairs can read out in email: the first 8 characters of the id. */
export const reference = (id: string) => id.slice(0, 8).toUpperCase();

/**
 * Who a contributor row shows. Until someone confirms, only what the owner typed when inviting
 * (spec 1.2), never their own profile, even if they already have one: an invitee or a person who
 * declined never agreed to appear on this proposal.
 */
function shown(c: ChairContributor) {
  if (c.status === "confirmed") {
    return {
      name: c.displayName ?? c.invitedName ?? "",
      email: c.email,
      affiliation: c.affiliation ?? c.invitedAffiliation ?? "",
      country: c.country ?? "",
      pronouns: c.pronouns ?? "",
      hasBio: Object.values(c.bios).some((b) => b.trim()),
    };
  }
  return {
    name: c.invitedName ?? "",
    email: c.invitedEmail ?? c.email,
    affiliation: c.invitedAffiliation ?? "",
    country: "",
    pronouns: "",
    hasBio: false,
  };
}

/**
 * `overCapSubmissionIds`: the submissions that count toward an over-cap person's total
 * (CapCount.submissionIds), so only rows where the cap actually bites are flagged.
 */
export function submissionsCsv(
  config: ConferenceConfig,
  rows: ChairSubmission[],
  overCapSubmissionIds: ReadonlySet<string>,
): string {
  const fieldColumns = config.submissionTypes.flatMap((t) =>
    t.fields.map((f) => ({ type: t.key, field: f.key })),
  );
  const header = [
    "reference",
    "id",
    "status",
    "type",
    "type_label",
    "track",
    "topics",
    "language",
    "participation_mode",
    "title",
    "abstract",
    "abstract_words",
    "created",
    "submitted",
    "updated",
    "contributors",
    "pending_invitations",
    "issue_codes",
    "self_id_warnings",
    "over_presenter_cap",
    ...fieldColumns.map((f) => `${f.type}.${f.field}`),
  ];
  const body = rows.map((s) => {
    const type = findType(config, s.typeKey);
    const live = s.contributors.filter((c) => c.status !== "declined");
    return [
      reference(s.id),
      s.id,
      s.status,
      s.typeKey,
      type ? localize(type.name, config.defaultLanguage) : "",
      s.trackKey ?? "",
      s.topicKeys,
      s.language,
      s.participationMode ?? "",
      s.title,
      s.abstract,
      s.abstract.trim() ? s.abstract.trim().split(/\s+/).length : 0,
      localTime(s.createdAt, config.timezone),
      localTime(s.submittedAt, config.timezone),
      localTime(s.updatedAt, config.timezone),
      live
        .map((c) => {
          const who = shown(c);
          return `${who.name} <${who.email}> (${c.role}, ${c.status})`;
        })
        .join("; "),
      live.filter((c) => c.status === "invited").length,
      s.issueCodes,
      s.selfIdWarningCount,
      overCapSubmissionIds.has(s.id) ? "yes" : "",
      ...fieldColumns.map((f) => (f.type === s.typeKey ? (s.fields[f.field] ?? "") : "")),
    ];
  });
  return toCsv(header, body);
}

export function contributorsCsv(rows: ChairSubmission[]): string {
  const header = [
    "reference",
    "position",
    "role",
    "status",
    "is_owner",
    "name",
    "email",
    "affiliation",
    "country",
    "pronouns",
    "has_bio",
  ];
  const body = rows.flatMap((s) =>
    [...s.contributors]
      .sort((a, b) => a.position - b.position)
      .map((c) => {
        const who = shown(c);
        return [
          reference(s.id),
          c.position,
          c.role,
          c.status,
          c.isOwner ? "yes" : "",
          who.name,
          who.email,
          who.affiliation,
          who.country,
          who.pronouns,
          who.hasBio ? "yes" : "",
        ];
      }),
  );
  return toCsv(header, body);
}
