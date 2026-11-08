import { localize } from "@elochair/schema/pure";
import { Link } from "react-router";
import type { ConferenceSummary } from "../api";
import { formatDateRange } from "../format";
import { type MessageKey, useT } from "../i18n";
import { useApi } from "../useApi";

export function HomePage() {
  const { lang, t } = useT();
  const res = useApi<{ conferences: ConferenceSummary[] }>("/api/conferences");

  return (
    <>
      <h1>{t("homeTitle")}</h1>
      <p className="lede">{t("tagline")}</p>
      {!res && <p role="status">{t("loading")}</p>}
      {res && !res.ok && <p role="alert">{t("errorGeneric")}</p>}
      {res?.ok && res.data.conferences.length === 0 && <p>{t("homeEmpty")}</p>}
      {res?.ok && (
        <ul className="cards">
          {res.data.conferences.map((k) => (
            <li key={k.slug} className="card">
              <h2>
                <Link to={`/${lang}/c/${k.slug}`}>{localize(k.title, lang)}</Link>
              </h2>
              <p className="meta">
                {localize(k.location, lang)} · {t(`modality_${k.modality}` as MessageKey)}
              </p>
              <p className="meta">{formatDateRange(k.dates.start, k.dates.end, lang)}</p>
              <p>
                <span className="badge">{t(`phase_${k.phase}` as MessageKey)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
