import type { ConferenceConfig } from "@elochair/schema";
import { effectiveBlindMode, localize } from "@elochair/schema/pure";
import { Link, useParams } from "react-router";
import type { ConferenceDetail, Me } from "../api";
import { formatDateRange, formatDateTime, viewerTimeZone } from "../format";
import { useT } from "../i18n";
import { deadlineKey, modalityKey, reviewKey } from "../labels";
import { Localized, PageHeading } from "../ui";
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

  if (!res) return <p role="status">{t("loading")}</p>;
  if (!res.ok) {
    return (
      <>
        <PageHeading>{res.status === 404 ? t("confNotFound") : t("errorGeneric")}</PageHeading>
        <p>
          <Link className="block-link" to={`/${lang}/`}>
            {t("navConferences")}
          </Link>
        </p>
      </>
    );
  }
  const c = res.data.config;
  const fb = c.defaultLanguage;

  return (
    <article className="conference">
      <PageHeading title={localize(c.title, lang, fb)}>
        <Localized text={c.title} fallback={fb} />
      </PageHeading>
      {c.placeholder && (
        <p className="notice" role="note">
          {t("confPlaceholder")}
        </p>
      )}
      <p className="lede">
        <Localized text={c.theme} fallback={fb} />
      </p>
      <p className="meta">
        <Localized text={c.location} fallback={fb} /> · {t(modalityKey(c.modality))} · {c.host}
      </p>

      <SubmissionStatus config={c} phase={res.data.phase} open={res.data.callOpen} />
      <CallActions slug={res.data.slug} open={res.data.callOpen} />

      <section aria-labelledby="dates">
        <h2 id="dates">{t("confDates")}</h2>
        <p>{formatDateRange(c.dates.start, c.dates.end, lang)}</p>
      </section>

      <Deadlines config={c} />

      <section aria-labelledby="formats">
        <h2 id="formats">{t("confFormats")}</h2>
        <ul className="cards">
          {c.submissionTypes.map((type) => (
            <li key={type.key} className="card">
              <h3>
                <Localized text={type.name} fallback={fb} />
              </h3>
              <p>
                <Localized text={type.description} fallback={fb} />
              </p>
              <ul className="facts">
                <li>
                  <Localized text={type.abstract.label} fallback={fb} />:{" "}
                  {t("confWords", { min: type.abstract.minWords, max: type.abstract.maxWords })}
                </li>
                {type.durationMinutes && <li>{t("confMinutes", { n: type.durationMinutes })}</li>}
                <li>
                  {type.team.min !== type.team.max
                    ? t("confPeopleRange", { min: type.team.min, max: type.team.max })
                    : new Intl.PluralRules(lang).select(type.team.min) === "one"
                      ? t("confPeopleOne", { n: type.team.min })
                      : t("confPeopleExact", { n: type.team.min })}
                </li>
                <li>{t(reviewKey(effectiveBlindMode(c, type.key)))}</li>
              </ul>
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
          ))}
        </ul>
      </section>

      {c.tracks.length > 0 && (
        <section aria-labelledby="tracks">
          <h2 id="tracks">{t("confTracks")}</h2>
          <ul>
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
          <h2 id="topics">{t("confTopics")}</h2>
          <ul>
            {c.topics.map((tp) => (
              <li key={tp.key}>
                <Localized text={tp.label} fallback={fb} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>{t("confContact", { email: c.contactEmail })}</p>
    </article>
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

function Deadlines({ config: c }: { config: ConferenceConfig }) {
  const { lang, t } = useT();
  const mine = viewerTimeZone();
  return (
    <section aria-labelledby="deadlines">
      <h2 id="deadlines">{t("confDeadlines")}</h2>
      <dl className="deadlines">
        {DEADLINES.map((key) => {
          const theirs = formatDateTime(c.deadlines[key], lang, c.timezone);
          const ours = formatDateTime(c.deadlines[key], lang, mine);
          return (
            <div key={key}>
              <dt>{t(deadlineKey(key))}</dt>
              <dd>
                <span>{theirs}</span>
                <span className="tz">{t("confConferenceTime", { tz: c.timezone })}</span>
                {ours !== theirs && (
                  <>
                    <span>{ours}</span>
                    <span className="tz">{t("confYourTime", { tz: mine })}</span>
                  </>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
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
    <p className="actions">
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
    </p>
  );
}
