import { dressedAs } from "@elochair/schema/pure";
import { Link } from "react-router";
import type { ConferenceDetail, ConferenceSummary } from "../api";
import { formatDateRange, themeClass } from "../format";
import { useT } from "../i18n";
import { invites } from "../invitation";
import { AlreadyInvolved, InvitationHero, WaysToContribute } from "../invitationParts";
import { chipKey, chipTone, modalityKey } from "../labels";
import { FooterLink, Localized, LocalizedEcho, PageHeading, Sheet } from "../ui";
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

/**
 * The front page. For the conference it features it is that conference's invitation to its
 * call, where the conference's configuration holds one (invitation.ts); the other conferences
 * follow, compactly. A featured conference without an invitation is a card under the page's
 * own heading, as before.
 */
export function HomePage() {
  const { t } = useT();
  const res = useApi<{ conferences: ConferenceSummary[] }>("/api/conferences");
  const all = res?.ok ? res.data.conferences : [];
  const featured = pickFeatured(all);
  // What the featured conference's own page reads: an invitation shows more than the list has.
  const detail = useApi<ConferenceDetail>(featured ? `/api/conferences/${featured.slug}` : null);
  const others = all.filter((k) => k !== featured);

  // The page has one heading, and which one depends on what it features: nothing is headed
  // until that is known, so that the heading takes focus once and keeps it.
  if (!res || (featured && !detail)) {
    return (
      <div className="home">
        <Sheet>
          <p role="status">{t("loading")}</p>
        </Sheet>
      </div>
    );
  }

  if (featured && detail?.ok && invites(detail.data.config)) {
    const website = detail.data.config.website;
    return (
      // The page wears the identity of the conference it invites to, if that one has any.
      <div className="home" data-dressed={dressedAs(featured.slug)}>
        <InvitationHero detail={detail.data} />
        <Sheet wide>
          <WaysToContribute detail={detail.data} number="01" />
          <AlreadyInvolved />
          <Others list={others} />
        </Sheet>
        {website && <FooterLink href={website} k="inviteWebsite" />}
      </div>
    );
  }

  const quiet = res.ok && all.length > 0 && others.length === 0;
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
          {!res.ok && <p role="alert">{t("errorGeneric")}</p>}
          {res.ok && all.length === 0 && <p>{t("homeEmpty")}</p>}
          <Others list={others} />
        </Sheet>
      )}
    </div>
  );
}

/** The conferences the page does not feature, as compact cards. */
function Others({ list }: { list: ConferenceSummary[] }) {
  const { lang, t } = useT();
  if (list.length === 0) return null;
  return (
    <>
      <h2 className="eyebrow">{t("homeOthers")}</h2>
      <ul className="cards">
        {list.map((k) => (
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
              <span className="badge" data-tone={chipTone(k)}>
                {t(chipKey(k))}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function Featured({ k }: { k: ConferenceSummary }) {
  const { lang, t } = useT();
  const theme = k.theme[lang] ?? Object.values(k.theme)[0] ?? "";
  return (
    <section className="feature" aria-labelledby="featured-title">
      <p>
        <span className="badge" data-tone={chipTone(k)}>
          {t(chipKey(k))}
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
