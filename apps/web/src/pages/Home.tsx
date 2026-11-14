import { Link } from "react-router";
import type { ConferenceSummary } from "../api";
import { formatDateRange } from "../format";
import { useT } from "../i18n";
import { modalityKey, phaseKey, phaseTone } from "../labels";
import { Localized, LocalizedEcho, PageHeading, Sheet } from "../ui";
import { useApi } from "../useApi";

/** Later phases of a live conference come first; a draft or an archived one last. */
const PHASE_RANK: Record<ConferenceSummary["phase"], number> = {
  cfp_open: 7,
  reviewing: 6,
  deciding: 5,
  confirming: 4,
  scheduling: 3,
  published: 2,
  draft: 1,
  archived: 0,
};

/**
 * The conference to feature: the one whose call is open (the server says), else the one furthest
 * from the archive, else the most recent.
 */
export function pickFeatured(all: ConferenceSummary[]): ConferenceSummary | undefined {
  return [...all].sort(
    (a, b) =>
      Number(b.callOpen) - Number(a.callOpen) ||
      PHASE_RANK[b.phase] - PHASE_RANK[a.phase] ||
      b.year - a.year,
  )[0];
}

/** A theme of a few words is set large; a sentence reads as prose. */
export const themeClass = (theme: string) => (theme.length > 48 ? "hero-theme long" : "hero-theme");

export function HomePage() {
  const { lang, t } = useT();
  const res = useApi<{ conferences: ConferenceSummary[] }>("/api/conferences");
  const all = res?.ok ? res.data.conferences : [];
  const featured = pickFeatured(all);
  const others = all.filter((k) => k !== featured);
  const quiet = res?.ok && all.length > 0 && others.length === 0;

  return (
    <div className="home">
      <header className="hero hero-home">
        <p className="hero-eyebrow">{t("footerOrg")}</p>
        <PageHeading>{t("homeTitle")}</PageHeading>
        <p className="hero-lede">{t("tagline")}</p>
        {featured && <Featured k={featured} />}
      </header>
      {/* With one conference and nothing else to say, the hero is the page. */}
      {!quiet && (
        <Sheet>
          {!res && <p role="status">{t("loading")}</p>}
          {res && !res.ok && <p role="alert">{t("errorGeneric")}</p>}
          {res?.ok && all.length === 0 && <p>{t("homeEmpty")}</p>}
          {others.length > 0 && (
            <>
              <h2 className="eyebrow">{t("homeOthers")}</h2>
              <ul className="cards">
                {others.map((k) => (
                  <li key={k.slug} className="card">
                    <h3>
                      <Link to={`/${lang}/c/${k.slug}`}>
                        <Localized text={k.title} />
                      </Link>
                    </h3>
                    <p className="meta">
                      <Localized text={k.location} /> · {t(modalityKey(k.modality))}
                    </p>
                    <p className="meta">{formatDateRange(k.dates.start, k.dates.end, lang)}</p>
                    <p>
                      <span className="badge" data-tone={phaseTone(k.phase)}>
                        {t(phaseKey(k.phase))}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

function Featured({ k }: { k: ConferenceSummary }) {
  const { lang, t } = useT();
  const theme = k.theme[lang] ?? Object.values(k.theme)[0] ?? "";
  return (
    <section className="feature" aria-labelledby="featured-title">
      <p>
        <span className="badge" data-tone={phaseTone(k.phase)}>
          {t(phaseKey(k.phase))}
        </span>
      </p>
      <h2 id="featured-title">
        <Link to={`/${lang}/c/${k.slug}`}>
          <Localized text={k.title} />
        </Link>
      </h2>
      <p className={themeClass(theme)}>
        <Localized text={k.theme} />
        <LocalizedEcho text={k.theme} />
      </p>
      <p className="meta">
        {formatDateRange(k.dates.start, k.dates.end, lang)} · <Localized text={k.location} /> ·{" "}
        {t(modalityKey(k.modality))}
      </p>
      <p className="actions">
        {k.callOpen && (
          <Link className="button" to={`/${lang}/c/${k.slug}/submit`}>
            {t("confSubmitCta")}
          </Link>
        )}
        <Link className="button secondary" to={`/${lang}/c/${k.slug}`}>
          {t("homeSeeCall")}
        </Link>
      </p>
    </section>
  );
}
