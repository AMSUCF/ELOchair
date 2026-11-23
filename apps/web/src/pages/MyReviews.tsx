import { localize } from "@elochair/schema/pure";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import type { MyReviews, OwnReviewStatus } from "../api";
import { deadlineText } from "../format";
import { LANG_NAMES, type Lang, useT } from "../i18n";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

/*
 * "My reviews" (spec 03, §1.4): a reviewer's own list. For each conference where they review
 * and reviewers can read: the day reviews are due where the chairs set one, how many of their
 * own reviews are sent, drafts and not started, the chairs' guidelines for each committee they
 * review for, and every proposal assigned to them with its format, the language of its
 * abstract and where their review of it stands.
 *
 * The server sends only this person's assignments (projectMyReviews in packages/policy):
 * nothing here says who else reviews anything.
 */

const TONE: Record<OwnReviewStatus, "good" | "warn" | undefined> = {
  sent: "good",
  draft: "warn",
  not_started: undefined,
};

/** What "I cannot review this proposal" hands over, to be said once on the list. */
export type LeftList = { left: string };

export function MyReviewsPage() {
  const { lang, t } = useT();
  const location = useLocation();
  const res = useApi<{ conferences: MyReviews[] }>("/api/me/reviews");
  /** The proposal that has just left the list: "I cannot review this proposal" led here. */
  const left = (location.state as LeftList | null)?.left ?? null;
  const saidRef = useRef<HTMLParagraphElement>(null);
  const loaded = res !== null;

  // Said once the list is there, in a line that takes focus: it is what was just done.
  useEffect(() => {
    if (loaded && left !== null) saidRef.current?.focus();
  }, [loaded, left]);

  if (!res) return <p role="status">{t("loading")}</p>;
  if (!res.ok) {
    return (
      <>
        <PageHeading>{t("myReviewsTitle")}</PageHeading>
        {res.status === 401 ? (
          <p>
            {t("myReviewsNeedSignIn")} <Link to={`/${lang}/sign-in`}>{t("navSignIn")}</Link>
          </p>
        ) : (
          // Signed in, and the list did not arrive: asking them to sign in would be wrong.
          <p role="alert">{t(res.status === 0 ? "verifyNetwork" : "errorGeneric")}</p>
        )}
      </>
    );
  }
  const conferences = res.data.conferences;
  return (
    <div className="my-reviews">
      <PageHeading>{t("myReviewsTitle")}</PageHeading>
      <p className="status-line" role="status" tabIndex={-1} ref={saidRef}>
        {left !== null && t("myReviewsLeft", { title: left || t("editUntitled") })}
      </p>
      {conferences.length === 0 && <p>{t("myReviewsNone")}</p>}
      {conferences.map((k) => (
        <Conference key={k.conference.slug} k={k} />
      ))}
      {conferences.length > 0 && <p className="meta">{t("myReviewsOnlyYours")}</p>}
    </div>
  );
}

function Conference({ k }: { k: MyReviews }) {
  const { lang, t } = useT();
  const fallback = k.conference.defaultLanguage;
  const text = (value: Record<string, string>) => localize(value, lang, fallback);
  const headingId = `reviews-${k.conference.slug}`;
  const total = k.proposals.length;
  const counts = [
    t("myReviewsCountSent", { sent: k.counts.sent, total }),
    k.counts.draft === 1
      ? t("myReviewsCountDraftOne")
      : t("myReviewsCountDraftMany", { n: k.counts.draft }),
    t("myReviewsCountNotStarted", { n: k.counts.notStarted }),
  ].join(" · ");
  const guided = k.committees.filter((c) => c.guidelines);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>
        <Localized text={k.conference.title} fallback={fallback} />
      </h2>
      <p className="meta">
        {t("myReviewsCommittees", {
          committees: k.committees.map((c) => text(c.name)).join(", "),
        })}
      </p>
      <div className="due">
        {k.open && k.reviewsDue && (
          <p>
            <strong>
              {t("myReviewsDue", {
                date: deadlineText(k.reviewsDue, lang, k.conference.timezone, t),
              })}
            </strong>
          </p>
        )}
        {total > 0 && <p>{counts}</p>}
        <p className="meta">{t(k.open ? "myReviewsDueNote" : "myReviewsClosed")}</p>
      </div>
      {guided.map((c) => (
        <details key={c.key} className="guidelines-box" open>
          <summary>
            {guided.length > 1 || k.committees.length > 1
              ? t("myReviewsGuidelinesFor", { committee: text(c.name) })
              : t("reviewGuidelines")}
          </summary>
          {/* As the chairs wrote them: their line breaks are kept (.guidelines). */}
          <p className="guidelines">
            {c.guidelines && <Localized text={c.guidelines} fallback={fallback} />}
          </p>
        </details>
      ))}
      {total === 0 ? (
        <p>{t("myReviewsEmpty")}</p>
      ) : (
        <ul className="cards" aria-label={t("myReviewsProposals")}>
          {k.proposals.map((p) => {
            const format = k.formats[p.typeKey];
            return (
              <li key={p.submissionId} className="card">
                <h3>
                  <Link to={`/${lang}/s/${p.submissionId}`} lang={p.language}>
                    {p.title || t("editUntitled")}
                  </Link>
                </h3>
                <p className="row">
                  <span className="meta">
                    {[
                      format ? text(format) : p.typeKey,
                      LANG_NAMES[p.language as Lang] ?? p.language,
                    ].join(" · ")}
                  </span>
                  <span className="badge" data-tone={TONE[p.status]}>
                    {t(`reviewStatus_${p.status}`)}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
