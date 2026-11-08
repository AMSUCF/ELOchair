import type { ConferenceConfig } from "@elochair/schema";
import { effectiveBlindMode, localize } from "@elochair/schema/pure";
import { useParams } from "react-router";
import type { ConferenceDetail } from "../api";
import { formatDateRange, formatDateTime, viewerTimeZone } from "../format";
import { type MessageKey, useT } from "../i18n";
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
        <PageHeading>{t("appName")}</PageHeading>
        <p role="alert">{res.status === 404 ? t("confNotFound") : t("errorGeneric")}</p>
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
        <Localized text={c.location} fallback={fb} /> · {t(`modality_${c.modality}` as MessageKey)}{" "}
        · {c.host}
      </p>

      <SubmissionStatus config={c} />

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
                <li>{t(`review_${effectiveBlindMode(c, type.key)}` as MessageKey)}</li>
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

function SubmissionStatus({ config: c }: { config: ConferenceConfig }) {
  const { lang, t } = useT();
  const now = Date.now();
  const open = Date.parse(c.deadlines.submissionsOpen);
  const close = Date.parse(c.deadlines.submissionsClose);
  // Always say which clock a deadline is on.
  const at = (iso: string) => `${formatDateTime(iso, lang, c.timezone)} (${c.timezone})`;
  const text =
    now < open
      ? t("confSubmitNotYet", { date: at(c.deadlines.submissionsOpen) })
      : now < close
        ? t("confSubmitOpen", { date: at(c.deadlines.submissionsClose) })
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
              <dt>{t(`deadline_${key}` as MessageKey)}</dt>
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
