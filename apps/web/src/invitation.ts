import type { CallState, ConferenceConfig } from "@elochair/schema";
import type { MessageKey } from "./i18n";

/*
 * The invitation to a conference's call: what the front page is for the conference it
 * features, and how that conference's own page begins (docs/design/visitor-preview is the
 * design it follows). This file holds what an invitation says and where it leads; the blocks
 * that show it are in invitationParts.tsx.
 */

/**
 * Whether a conference invites: its configuration holds the invitation, the line about what
 * sets the edition apart, or ways to contribute. That is what a conference's pages go by,
 * never its slug: a conference with none of them is shown as it always was.
 */
export const invites = (
  c: Pick<ConferenceConfig, "invitation" | "distinction" | "contributionGroups">,
): boolean => Boolean(c.invitation || c.distinction) || c.contributionGroups.length > 0;

/**
 * The invitation's main action, by where the call stands (the server says: `callState`).
 * - open: start a proposal.
 * - upcoming: prepare one, by reading what each format asks for on the conference's page.
 * - closed: nothing more can be sent in; people who did send something find it under their
 *   own proposals.
 */
export function mainAction(
  state: CallState,
  slug: string,
  lang: string,
): { label: MessageKey; to: string } {
  if (state === "open") return { label: "inviteStart", to: `/${lang}/c/${slug}/submit` };
  if (state === "upcoming") return { label: "invitePrepare", to: `/${lang}/c/${slug}#formats` };
  return { label: "inviteMyProposals", to: `/${lang}/my` };
}

/** The id of a format's card on the conference's page, which a way to contribute leads to. */
export const formatAnchor = (key: string) => `format-${key}`;

/**
 * "English or Spanish": the languages proposals may be written in, named in the language of
 * the page (`lang`), for the line under "Ways to contribute".
 */
export function languageChoice(languages: readonly string[], lang: string): string {
  const names = new Intl.DisplayNames([lang], { type: "language" });
  const named = languages.map((code) => names.of(code) ?? code);
  return new Intl.ListFormat(lang, { style: "long", type: "disjunction" }).format(named);
}

/**
 * A theme of a few words, as the headline sets it: the first word heavy and the rest light,
 * as on the conference's site ("Ecologies / of Attention"). A theme of one word has no rest.
 */
export function headlineParts(theme: string): { lead: string; rest: string } {
  const words = theme.trim().split(/\s+/);
  return { lead: words[0] ?? "", rest: words.slice(1).join(" ") };
}
