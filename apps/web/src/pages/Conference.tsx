import type { ConferenceConfig } from "@elochair/schema";
import { effectiveBlindMode, localize } from "@elochair/schema/pure";
import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ConferenceDetail, Me } from "../api";
import {
  daysUntil,
  formatCoordinates,
  formatDateRange,
  formatDateTime,
  viewerTimeZone,
} from "../format";
import { useT } from "../i18n";
import { deadlineKey, modalityKey, reviewKey } from "../labels";
import {
  Eyebrow,
  Localized,
  LocalizedEcho,
  PageHeading,
  partnerLang,
  SectionHeading,
  Sheet,
  Stat,
} from "../ui";
import { useApi } from "../useApi";
import { themeClass } from "./Home";

const DEADLINES = [
  "submissionsOpen",
  "submissionsClose",
  "notification",
  "finalMaterials",
] as const;

const two = (n: number) => String(n).padStart(2, "0");
const range = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`);

export function ConferencePage() {
  const { slug } = useParams();
  const { lang, t } = useT();
  const res = useApi<ConferenceDetail>(`/api/conferences/${slug}`);

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
  // Sections are numbered as on the conference's site; tracks and topics only when present.
  const numbers = { tracks: 3, topics: c.tracks.length > 0 ? 4 : 3 };

  return (
    <article className="conference">
      <Hero detail={res.data} />
      <Sheet wide>
        {c.placeholder && (
          <p className="notice" role="note">
            {t("confPlaceholder")}
          </p>
        )}
        {c.website && (
          <div className="call-link">
            <p>
              <a className="button secondary" href={c.website} rel="noreferrer">
                {t("confFullCall")} <span aria-hidden="true">↗</span>
              </a>
            </p>
            <p className="meta">{t("confFullCallNote")}</p>
          </div>
        )}

        <section aria-labelledby="formats">
          <SectionHeading id="formats" k="confFormats" number="01" />
          <ol className="formats">
            {c.submissionTypes.map((type, i) => {
              const pool = c.reviewPools.find((p) => p.key === type.reviewPool);
              return (
                <li key={type.key} className="card format">
                  <div className="format-head">
                    <span className="format-number" aria-hidden="true">
                      {two(i + 1)}
                    </span>
                    {pool && (
                      <span className="tag">
                        <Localized text={pool.name} fallback={fb} />
                      </span>
                    )}
                  </div>
                  <h3>
                    <Localized text={type.name} fallback={fb} />
                    <LocalizedEcho text={type.name} />
                  </h3>
                  <p>
                    <Localized text={type.description} fallback={fb} />
                  </p>
                  <p className="meta">
                    <Localized text={type.abstract.label} fallback={fb} />
                  </p>
                  <ul className="stats">
                    <Stat
                      value={range(type.abstract.minWords, type.abstract.maxWords)}
                      label={t("statWords")}
                    />
                    {type.durationMinutes && (
                      <Stat value={type.durationMinutes} label={t("statMinutes")} />
                    )}
                    <Stat
                      value={range(type.team.min, type.team.max)}
                      label={
                        type.team.max === 1 && new Intl.PluralRules(lang).select(1) === "one"
                          ? t("statPerson")
                          : t("statPeople")
                      }
                    />
                  </ul>
                  <p className="meta">{t(reviewKey(effectiveBlindMode(c, type.key)))}</p>
                  {type.fields.length > 0 && (
                    <>
                      <p className="meta">{t("confAlsoAsks")}:</p>
                      <ul className="facts">
                        {type.fields.map((f) => (
                          <li key={f.key}>
                            <Localized text={f.label} fallback={fb} />
                            {f.required && ` (${t("confRequired")})`}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <Deadlines config={c} />

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
      </Sheet>
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
          <p className="fact">{formatDateTime(c.deadlines.submissionsClose, lang, c.timezone)}</p>
          <p className="fact-sub">{c.timezone}</p>
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
  // Always say which clock a deadline is on.
  const at = (iso: string) => `${formatDateTime(iso, lang, c.timezone)} (${c.timezone})`;
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

/** The four deadlines and the conference itself, as a timeline. */
function Deadlines({ config: c }: { config: ConferenceConfig }) {
  const { lang, t } = useT();
  const mine = viewerTimeZone();
  return (
    <section aria-labelledby="deadlines">
      <SectionHeading id="deadlines" k="confDeadlines" number="02" />
      <ol className="timeline">
        {DEADLINES.map((key) => {
          const theirs = formatDateTime(c.deadlines[key], lang, c.timezone);
          const ours = formatDateTime(c.deadlines[key], lang, mine);
          return (
            <li key={key} className={key === "submissionsClose" ? "key" : undefined}>
              <Eyebrow>{t(deadlineKey(key))}</Eyebrow>
              <p className="when">{theirs}</p>
              <p className="tz">{t("confConferenceTime", { tz: c.timezone })}</p>
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

/** "Submit a proposal" while the call is open; "Manage submissions" for the conference's chairs. */
function CallActions({ slug, open }: { slug: string; open: boolean }) {
  const { lang, t } = useT();
  const me = useApi<Me>("/api/me");
  const chairs =
    me?.ok &&
    me.data.kind === "person" &&
    (me.data.siteAdmin ||
      me.data.roles.some((r) => r.conference === slug && r.role !== "reviewer"));
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
