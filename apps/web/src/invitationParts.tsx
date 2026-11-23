import { localizeWithLang } from "@elochair/schema/pure";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import type { ConferenceDetail } from "./api";
import {
  daysUntil,
  deadlineText,
  formatCoordinates,
  formatDateRange,
  isShortTheme,
} from "./format";
import { formatAnchor } from "./formats";
import { type Lang, translate, useT } from "./i18n";
import { headlineParts, languageChoice, mainAction } from "./invitation";
import { callStateKey, modalityKey } from "./labels";
import {
  Echo,
  Eyebrow,
  Localized,
  LocalizedEcho,
  PageHeading,
  Pair,
  partnerLang,
  SectionHeading,
} from "./ui";

/*
 * The blocks of an invitation to a conference's call (invitation.ts says when a conference has
 * one). The front page shows them for the conference it features; that conference's own page
 * begins with the same ones. Everything in them comes from the conference's configuration and
 * from what the server says about its call. Like the rest of the public pages they pair two
 * languages: each text is followed by its echo in the conference's other language.
 */

/** Configuration text and, on a line of its own under it, its echo in the other language. */
function Text({ text, fallback }: { text: Record<string, string>; fallback: string }) {
  return (
    <>
      <Localized text={text} fallback={fallback} />
      <LocalizedEcho text={text} below />
    </>
  );
}

/**
 * The top of an invitation, on the band: which conference and where its call stands, the theme
 * as the headline, the action that fits the state of the call, when and where the conference
 * is, and on glass the invitation itself, the way to the full call and when proposals are due.
 *
 * `own` is for the conference's own page: links to its sections stay on the page, and what the
 * page always showed of the conference (its coordinates, the days left) stays with it.
 * `children` are further actions, beside the main one (the chairs' way to their submissions).
 */
export function InvitationHero({
  detail,
  own = false,
  children,
}: {
  detail: ConferenceDetail;
  own?: boolean;
  children?: ReactNode;
}) {
  const { lang, t } = useT();
  const c = detail.config;
  const fb = c.defaultLanguage;
  const partner = partnerLang(lang);
  const state = detail.callState;
  const title = localizeWithLang(c.title, lang, fb).text;
  const theme = localizeWithLang(c.theme, lang, fb);
  const short = isShortTheme(theme.text);
  const { lead, rest } = headlineParts(theme.text);
  const action = mainAction(state, detail.slug, lang);
  /** A section of the conference's page: on that page itself, only the part after the "#". */
  const section = (id: string) => (own ? `#${id}` : `/${lang}/c/${detail.slug}#${id}`);
  // For display only: the device clock never decides whether the call is open (spec 02 §1.3).
  const [now] = useState(() => Date.now());
  const days = daysUntil(c.deadlines.submissionsClose, now);
  const due = (language: Lang) =>
    deadlineText(
      c.deadlines.submissionsClose,
      language,
      c.timezone,
      (key, vars) => translate(language, key, vars),
      true,
    );

  return (
    <header className="hero invitation">
      <p className="hero-eyebrow">
        <Localized text={c.title} fallback={fb} /> · {t(callStateKey(state))}
        <Echo text={translate(partner, callStateKey(state))} lang={partner} />
      </p>
      {own && c.coordinates && <p className="hero-coords">{formatCoordinates(c.coordinates)}</p>}
      <div className="invitation-grid">
        <div className="invitation-lead">
          {/* The theme is the headline, as on the conference's site; the conference is named
              in the line above it and in the document's title. */}
          <PageHeading
            title={short ? `${title}: ${theme.text}` : title}
            className={short ? "headline" : "headline long"}
          >
            <span lang={theme.lang.split("-")[0] === lang ? undefined : theme.lang}>
              {short ? (
                <>
                  <span className="headline-lead">{lead}</span>
                  {rest && " "}
                  {rest && <span className="headline-rest">{rest}</span>}
                </>
              ) : (
                theme.text
              )}
            </span>
          </PageHeading>
          {c.theme[partner] && c.theme[partner] !== theme.text && (
            <p className="hero-echo">
              <LocalizedEcho text={c.theme} />
            </p>
          )}
          <div className="actions">
            <Link className="button" to={state === "upcoming" ? section("formats") : action.to}>
              <Pair k={action.label} />
              {state === "open" && <span aria-hidden="true">→</span>}
            </Link>
            {children}
          </div>
          <div className="invitation-event">
            <p>
              {formatDateRange(c.dates.start, c.dates.end, lang)}
              <Echo
                text={formatDateRange(c.dates.start, c.dates.end, partner)}
                lang={partner}
                below
              />
            </p>
            <p>
              <Localized text={c.location} fallback={fb} /> · {t(modalityKey(c.modality))}
            </p>
            <p>{c.host}</p>
            {c.distinction && (
              <p>
                <Text text={c.distinction} fallback={fb} />
              </p>
            )}
          </div>
        </div>

        <div className="invitation-card">
          {c.invitation && (
            <p className="invitation-text">
              <Text text={c.invitation} fallback={fb} />
            </p>
          )}
          {c.website && (
            <p className="actions">
              <a className="button secondary" href={c.website} rel="noreferrer">
                <Pair k="inviteCfp" />
                <span aria-hidden="true">↗</span>
              </a>
            </p>
          )}
          {state === "closed" ? (
            <p className="invitation-closed">
              <Pair k="inviteWindowClosed" />
            </p>
          ) : (
            <div className="invitation-due">
              <Eyebrow>
                {t("inviteDue")}
                <Echo text={translate(partner, "inviteDue")} lang={partner} />
              </Eyebrow>
              {/* As the call states it; the conference's page has it on the visitor's own
                  clock as well, among the deadlines. */}
              <p className="fact">
                <Link className="paired" to={section("deadlines")}>
                  <span className="pair">
                    <span className="pair-text">{due(lang)}</span>
                    <Echo text={due(partner)} lang={partner} below />
                  </span>
                </Link>
              </p>
              {own && state === "open" && (
                <p className="countdown">
                  <span className="countdown-number">{days}</span>{" "}
                  {new Intl.PluralRules(lang).select(days) === "one"
                    ? t("confDaysOne")
                    : t("confDaysOther")}
                </p>
              )}
              {state === "upcoming" && (
                <p className="status-line">
                  {t("confSubmitNotYet", {
                    date: deadlineText(c.deadlines.submissionsOpen, lang, c.timezone, t),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * "Proposals in English or Spanish.": the languages a proposal may be written in, named in the
 * language of the page, with the same line in the other language under it when there is a
 * choice to tell of.
 */
export function ProposalLanguages({ languages }: { languages: readonly string[] }) {
  const { lang } = useT();
  const partner = partnerLang(lang);
  const line = (language: Lang) =>
    translate(language, "inviteLanguages", { languages: languageChoice(languages, language) });
  return (
    <p className="meta">
      {line(lang)}
      {languages.length > 1 && <Echo text={line(partner)} lang={partner} below />}
    </p>
  );
}

/**
 * "Ways to contribute": the languages proposals may be in, then the call's formats in their
 * groups, each leading to its first format on the conference's page. Nothing for a conference
 * whose configuration has no groups.
 */
export function WaysToContribute({
  detail,
  own = false,
  number,
}: {
  detail: ConferenceDetail;
  own?: boolean;
  number?: string;
}) {
  const { lang, t } = useT();
  const c = detail.config;
  const fb = c.defaultLanguage;
  if (c.contributionGroups.length === 0) return null;
  return (
    <section aria-labelledby="ways" className="ways">
      <SectionHeading id="ways" k="inviteWays" number={number} />
      <ProposalLanguages languages={c.languages} />
      <ul className="cards">
        {c.contributionGroups.map((group) => {
          // One format: the link goes to what it asks for. Several: to the first of them.
          const label = group.formats.length === 1 ? "inviteRequirements" : "inviteExplore";
          const target = formatAnchor(group.formats[0] ?? "");
          return (
            <li key={group.key} className="card way">
              <h3>
                <Text text={group.name} fallback={fb} />
              </h3>
              <p>
                <Text text={group.summary} fallback={fb} />
              </p>
              <p>
                {/* Each card has this link: its name goes on to say which group it is for. */}
                <Link
                  className="block-link paired"
                  to={own ? `#${target}` : `/${lang}/c/${detail.slug}#${target}`}
                >
                  <Pair
                    k={label}
                    mark="→"
                    more={t("inviteLinkAbout", {
                      name: localizeWithLang(group.name, lang, fb).text,
                    })}
                  />
                </Link>
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Already involved?": the ways back in for people who have a proposal, review or organize.
 * Everyone signs in the same way; what a person may do follows from their roles, not from the
 * link they took.
 */
export function AlreadyInvolved() {
  const { lang, t } = useT();
  const partner = partnerLang(lang);
  return (
    <nav className="involved" aria-labelledby="involved-title">
      <p className="eyebrow" id="involved-title">
        {t("inviteAlready")}
        <Echo text={translate(partner, "inviteAlready")} lang={partner} />
      </p>
      <ul>
        <li>
          <Link className="block-link paired" to={`/${lang}/my`}>
            <Pair k="inviteContinue" />
          </Link>
        </li>
        <li>
          <Link className="block-link paired" to={`/${lang}/sign-in`}>
            <Pair k="inviteReviewers" />
          </Link>
        </li>
        <li>
          <Link className="block-link paired" to={`/${lang}/sign-in`}>
            <Pair k="inviteOrganizers" />
          </Link>
        </li>
      </ul>
      <p className="meta">{t("inviteSignInNote")}</p>
    </nav>
  );
}
