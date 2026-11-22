import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ConferenceDetail, Me } from "../api";
import {
  clockName,
  daysUntil,
  deadlineText,
  formatCoordinates,
  formatDateRange,
  formatDateTime,
  statedWhen,
  themeClass,
  viewerTimeZone,
} from "../format";
import { two } from "../formats";
import { FormatsView } from "../formatsView";
import { useT } from "../i18n";
import { invites } from "../invitation";
import { AlreadyInvolved, InvitationHero, WaysToContribute } from "../invitationParts";
import { deadlineKey, modalityKey } from "../labels";
import {
  Eyebrow,
  FooterLink,
  Localized,
  LocalizedEcho,
  PageHeading,
  partnerLang,
  SectionHeading,
  Sheet,
  useHashTarget,
} from "../ui";
import { useApi } from "../useApi";

const DEADLINES = [
  "submissionsOpen",
  "submissionsClose",
  "notification",
  "finalMaterials",
] as const;

export function ConferencePage() {
  const { slug } = useParams();
  const { lang, t } = useT();
  const res = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const moveTo = useHashTarget(Boolean(res?.ok));

  if (!res) {
    return (
      <Sheet>
        <p role="status">{t("loading")}</p>
      </Sheet>
    );
  }
  if (!res.ok) {
    return (
      <Sheet>
        <PageHeading>{res.status === 404 ? t("confNotFound") : t("errorGeneric")}</PageHeading>
        <p>
          <Link className="block-link" to={`/${lang}/`}>
            {t("navConferences")}
          </Link>
        </p>
      </Sheet>
    );
  }
  const c = res.data.config;
  const fb = c.defaultLanguage;
  // A conference whose configuration holds an invitation begins with it; another begins as
  // it always did.
  const inviting = invites(c);
  // Sections are numbered as on the conference's site. The ways to contribute come first
  // where there are any; tracks and topics are numbered only when present.
  const ways = c.contributionGroups.length > 0 ? 1 : 0;
  const numbers = {
    formats: ways + 1,
    deadlines: ways + 2,
    tracks: ways + 3,
    topics: ways + (c.tracks.length > 0 ? 4 : 3),
  };

  return (
    <article className="conference">
      {inviting ? (
        <InvitationHero detail={res.data} own>
          <ManageLink slug={res.data.slug} />
        </InvitationHero>
      ) : (
        <Hero detail={res.data} />
      )}
      <Sheet wide>
        {c.placeholder && (
          <p className="notice" role="note">
            {t("confPlaceholder")}
          </p>
        )}
        {/* The invitation has the link to the full call already: it is not shown twice. */}
        {c.website && !inviting && (
          <div className="call-link">
            <p>
              <a className="button secondary" href={c.website} rel="noreferrer">
                {t("confFullCall")} <span aria-hidden="true">↗</span>
              </a>
            </p>
            <p className="meta">{t("confFullCallNote")}</p>
          </div>
        )}

        <WaysToContribute detail={res.data} own number="01" />

        <FormatsView detail={res.data} number={two(numbers.formats)} moveTo={moveTo} />

        <Deadlines config={c} number={two(numbers.deadlines)} />

        {c.tracks.length > 0 && (
          <section aria-labelledby="tracks">
            <SectionHeading id="tracks" k="confTracks" number={two(numbers.tracks)} />
            <ul className="plain-list">
              {c.tracks.map((tr) => (
                <li key={tr.key}>
                  <Localized text={tr.name} fallback={fb} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {c.topics.length > 0 && (
          <section aria-labelledby="topics">
            <SectionHeading id="topics" k="confTopics" number={two(numbers.topics)} />
            <ul className="plain-list">
              {c.topics.map((tp) => (
                <li key={tp.key}>
                  <Localized text={tp.label} fallback={fb} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="meta contact">{t("confContact", { email: c.contactEmail })}</p>
        {inviting && <AlreadyInvolved />}
      </Sheet>
      {inviting && c.website && <FooterLink href={c.website} k="inviteWebsite" />}
    </article>
  );
}

/** The top of the page, on the band: what the conference is, where and when, and what to do. */
function Hero({ detail }: { detail: ConferenceDetail }) {
  const { lang, t } = useT();
  const c = detail.config;
  const fb = c.defaultLanguage;
  const theme = localize(c.theme, lang, fb);
  const echo = c.theme[partnerLang(lang)];
  // For display only: the device clock never decides whether the call is open (spec 02 §1.3).
  const [now] = useState(() => Date.now());
  const days = daysUntil(c.deadlines.submissionsClose, now);
  // As the call states it: the date and time as written, and the clock they are on.
  const close = statedWhen(c.deadlines.submissionsClose, lang, c.timezone);

  return (
    <header className="hero">
      <p className="hero-eyebrow">{t("heroEyebrow")}</p>
      {c.coordinates && <p className="hero-coords">{formatCoordinates(c.coordinates)}</p>}
      <PageHeading title={localize(c.title, lang, fb)}>
        <Localized text={c.title} fallback={fb} />
      </PageHeading>
      <p className={themeClass(theme)}>
        <Localized text={c.theme} fallback={fb} />
      </p>
      {echo && echo !== theme && (
        <p className="hero-echo">
          <LocalizedEcho text={c.theme} />
        </p>
      )}

      <div className="hero-facts">
        <div>
          <Eyebrow>{t("confFactDates")}</Eyebrow>
          <p className="fact">{formatDateRange(c.dates.start, c.dates.end, lang)}</p>
          <p className="fact-sub">{t(modalityKey(c.modality))}</p>
        </div>
        <div>
          <Eyebrow>{t("confFactVenue")}</Eyebrow>
          <p className="fact">{c.host}</p>
          <p className="fact-sub">
            <Localized text={c.location} fallback={fb} />
          </p>
        </div>
        <div>
          <Eyebrow>{t(deadlineKey("submissionsClose"))}</Eyebrow>
          <p className="fact">{close.when}</p>
          <p className="fact-sub">{clockName(close, c.timezone, t)}</p>
          {detail.callOpen && (
            <p className="countdown">
              <span className="countdown-number">{days}</span>{" "}
              {new Intl.PluralRules(lang).select(days) === "one"
                ? t("confDaysOne")
                : t("confDaysOther")}
            </p>
          )}
        </div>
        <CallActions slug={detail.slug} open={detail.callOpen} />
      </div>
      <SubmissionStatus config={c} phase={detail.phase} open={detail.callOpen} />
    </header>
  );
}

/** Whether the call is open is the server's answer (`open`); the device clock decides nothing. */
function SubmissionStatus({
  config: c,
  phase,
  open,
}: {
  config: ConferenceConfig;
  phase: ConferenceDetail["phase"];
  open: boolean;
}) {
  const { lang, t } = useT();
  // Always say which clock a deadline is on: the one it was written on.
  const at = (iso: string) => deadlineText(iso, lang, c.timezone, t);
  const text = open
    ? t("confSubmitOpen", { date: at(c.deadlines.submissionsClose) })
    : phase === "draft"
      ? t("confSubmitNotYet", { date: at(c.deadlines.submissionsOpen) })
      : phase === "cfp_open"
        ? t("confSubmitNotOpen", {
            open: at(c.deadlines.submissionsOpen),
            close: at(c.deadlines.submissionsClose),
          })
        : t("confSubmitClosed");
  return <p className="status-line">{text}</p>;
}

/**
 * The four deadlines and the conference itself, as a timeline. Each deadline is shown as the
 * call states it, on the clock it was written on, and then on the visitor's own.
 */
function Deadlines({ config: c, number }: { config: ConferenceConfig; number: string }) {
  const { lang, t } = useT();
  const mine = viewerTimeZone();
  return (
    <section aria-labelledby="deadlines">
      <SectionHeading id="deadlines" k="confDeadlines" number={number} />
      <ol className="timeline">
        {DEADLINES.map((key) => {
          const stated = statedWhen(c.deadlines[key], lang, c.timezone);
          const theirs = stated.when;
          const ours = formatDateTime(c.deadlines[key], lang, mine);
          return (
            <li key={key} className={key === "submissionsClose" ? "key" : undefined}>
              <Eyebrow>{t(deadlineKey(key))}</Eyebrow>
              <p className="when">{theirs}</p>
              <p className="tz">
                {stated.clock === "conference"
                  ? t("confConferenceTime", { tz: c.timezone })
                  : clockName(stated, c.timezone, t)}
              </p>
              {ours !== theirs && (
                <>
                  <p>{ours}</p>
                  <p className="tz">{t("confYourTime", { tz: mine })}</p>
                </>
              )}
            </li>
          );
        })}
        <li className="key">
          <Eyebrow>{t("confDates")}</Eyebrow>
          <p className="when">{formatDateRange(c.dates.start, c.dates.end, lang)}</p>
          <p className="tz">
            <Localized text={c.location} fallback={c.defaultLanguage} />
          </p>
        </li>
      </ol>
    </section>
  );
}

/** Whether the person signed in manages this conference's submissions (its chairs do). */
function useChairs(slug: string): boolean {
  const me = useApi<Me>("/api/me");
  return Boolean(
    me?.ok &&
      me.data.kind === "person" &&
      (me.data.siteAdmin ||
        me.data.roles.some((r) => r.conference === slug && r.role !== "reviewer")),
  );
}

/** "Manage submissions", for the conference's chairs: beside the invitation's main action. */
function ManageLink({ slug }: { slug: string }) {
  const { lang, t } = useT();
  if (!useChairs(slug)) return null;
  return (
    <Link className="button secondary" to={`/${lang}/c/${slug}/manage`}>
      {t("confManageLink")}
    </Link>
  );
}

/** "Submit a proposal" while the call is open; "Manage submissions" for the conference's chairs. */
function CallActions({ slug, open }: { slug: string; open: boolean }) {
  const { lang, t } = useT();
  const chairs = useChairs(slug);
  if (!open && !chairs) return null;
  return (
    <div className="actions">
      {open && (
        <Link className="button" to={`/${lang}/c/${slug}/submit`}>
          {t("confSubmitCta")}
        </Link>
      )}
      {chairs && (
        <Link className="button secondary" to={`/${lang}/c/${slug}/manage`}>
          {t("confManageLink")}
        </Link>
      )}
    </div>
  );
}
