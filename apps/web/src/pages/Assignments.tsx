import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type Assignments,
  type AssignmentsPool,
  type AssignmentsProposal,
  api,
  type ConferenceDetail,
} from "../api";
import { useT } from "../i18n";
import { Localized, PageHeading, useHashTarget } from "../ui";
import { useApi } from "../useApi";

/*
 * The chairs' Assignments page (spec 03, §1.3): by committee, every proposal that can be given
 * reviewers, with who reviews it, those that still need reviewers first. It is for looking: a
 * proposal's reviewers are assigned and removed on the proposal's own page, which each title
 * leads to. Nothing here assigns anyone, and nothing is suggested.
 */

/** How many of a committee's proposals arrive at a time ("Show more" follows the server's cursor). */
const PAGE_SIZE = 50;

/** Whether a committee's list says how much of it is shown: when it is, or was, more than a page. */
const paged = (proposals: number, shown: number) => proposals > shown || shown > PAGE_SIZE;

export function AssignmentsPage() {
  const { slug = "" } = useParams();
  const { lang, t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const page = useApi<Assignments>(`/api/conferences/${slug}/assignments?limit=${PAGE_SIZE}`);
  // A committee's link at the top of the page leads to its part of it.
  useHashTarget(Boolean(conf?.ok && page?.ok));

  if (!conf || !page) return <p role="status">{t("loading")}</p>;
  if (!conf.ok) return <PageHeading>{t("confNotFound")}</PageHeading>;
  if (!page.ok) {
    return (
      <>
        <PageHeading>{t("assignmentsTitle")}</PageHeading>
        <p role="alert">{t(page.status === 403 ? "assignmentsNoAccess" : "errorGeneric")}</p>
      </>
    );
  }
  const config = conf.data.config;
  const data = page.data;
  const committee = (key: string) => {
    const pool = config.reviewPools.find((p) => p.key === key);
    return pool ? localize(pool.name, lang, config.defaultLanguage) : key;
  };

  return (
    <div className="assignments-page">
      <PageHeading title={t("assignmentsTitle")}>{t("assignmentsTitle")}</PageHeading>
      <p className="meta">
        <Localized text={config.title} fallback={config.defaultLanguage} />
      </p>
      <p>{t("assignmentsIntro")}</p>
      {!data.callClosed && <p className="notice">{t("assignmentsCallOpen")}</p>}
      {data.excluded > 0 && (
        <p className="meta">
          {data.excluded === 1
            ? t("assignmentsExcludedOne")
            : t("assignmentsExcludedMany", { n: data.excluded })}
        </p>
      )}
      <p>
        <Link className="block-link" to={`/${lang}/c/${slug}/manage`}>
          {t("settingsBackToManage")}
        </Link>
      </p>
      {data.pools.length > 1 && (
        <nav aria-label={t("assignmentsCommittees")}>
          <ul className="jump">
            {data.pools.map((pool) => (
              <li key={pool.key}>
                <Link className="block-link" to={{ hash: `#committee-${pool.key}` }}>
                  {committee(pool.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {data.pools.map((pool) => (
        <Committee
          key={`${slug}:${pool.key}`}
          slug={slug}
          first={pool}
          name={committee(pool.key)}
          config={config}
        />
      ))}
    </div>
  );
}

/**
 * One committee: its totals, and its proposals a page at a time. The first page came with the
 * page itself; "Show more" asks for the next one, from where this one ended.
 */
function Committee({
  slug,
  first,
  name,
  config,
}: {
  slug: string;
  first: AssignmentsPool;
  name: string;
  config: ConferenceConfig;
}) {
  const { lang, t } = useT();
  const [pool, setPool] = useState(first);
  const [loading, setLoading] = useState(false);
  /**
   * "Show more" failed: the list so far stays, with a message by the button. "changed": the
   * server no longer knows where the list ended (400 at path "cursor").
   */
  const [failed, setFailed] = useState<"error" | "changed" | null>(null);
  /** Repeat taps on "Show more" while a page is on its way do nothing. */
  const inFlight = useRef(false);
  /** After "Show more", the first new proposal takes focus so keyboard users continue there. */
  const focusAfter = useRef<string | null>(null);
  const showing = `committee-${first.key}-showing`;

  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  async function more() {
    if (!pool.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(null);
    const r = await api<AssignmentsPool>(
      `/api/conferences/${slug}/assignments/pools/${first.key}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(pool.nextCursor)}`,
    );
    inFlight.current = false;
    setLoading(false);
    if (!r.ok) {
      setFailed(
        r.status === 400 && r.issues.some((i) => i.path === "cursor") ? "changed" : "error",
      );
      return;
    }
    // A proposal is listed once, even if a page repeats one already shown: it stays where it
    // is, as the newest answer describes it, so that no card contradicts the totals above it.
    const newest = new Map(r.data.items.map((x) => [x.id, x]));
    const listed = new Set(pool.items.map((x) => x.id));
    const added = r.data.items.filter((x) => !listed.has(x.id));
    const items = [...pool.items.map((x) => newest.get(x.id) ?? x), ...added];
    // Focus goes to the first new proposal. With none, and the button gone, to the count if
    // the page still shows one, or else to the committee's heading: never nowhere.
    focusAfter.current = added[0]
      ? `proposal-${added[0].id}`
      : r.data.nextCursor
        ? null
        : paged(r.data.proposals, items.length)
          ? showing
          : `committee-${first.key}`;
    // The totals are the newest the server gave.
    setPool({ ...r.data, items });
  }

  const formatName = (typeKey: string) => {
    const type = config.submissionTypes.find((x) => x.key === typeKey);
    return type ? localize(type.name, lang, config.defaultLanguage) : typeKey;
  };
  const totals =
    pool.proposals === 0
      ? t("assignmentsProposalsNone")
      : [
          pool.proposals === 1
            ? t("assignmentsProposalsOne")
            : t("assignmentsProposalsMany", { n: pool.proposals }),
          pool.short === 0
            ? t("assignmentsShortNone")
            : pool.short === 1
              ? t("assignmentsShortOne")
              : t("assignmentsShortMany", { n: pool.short }),
        ].join(" ");
  const missing = (item: AssignmentsProposal) => pool.needed - item.reviewers.length;

  return (
    <section aria-labelledby={`committee-${first.key}`}>
      <h2 id={`committee-${first.key}`} tabIndex={-1}>
        {name}
      </h2>
      <p>
        {totals}{" "}
        {pool.needed === 1
          ? t("assignmentsAsksOne")
          : t("assignmentsAsksMany", { needed: pool.needed })}
      </p>
      {/* Those that have their reviewers and not yet their reviews: listed after the first. */}
      {pool.waiting > 0 && (
        <p>
          {pool.waiting === 1
            ? t("assignmentsWaitingOne")
            : t("assignmentsWaitingMany", { n: pool.waiting })}
        </p>
      )}
      {paged(pool.proposals, pool.items.length) ? (
        <p className="meta" role="status" id={showing} tabIndex={-1}>
          {t("manageShowing", { shown: pool.items.length, total: pool.proposals })}
        </p>
      ) : null}
      <ul className="cards">
        {pool.items.map((item) => (
          <li key={item.id} className="card">
            <h3>
              {/* To the proposal's page, at the part where its reviewers are assigned. */}
              <Link id={`proposal-${item.id}`} to={`/${lang}/s/${item.id}#reviewers`}>
                {item.title || t("editUntitled")}
              </Link>
            </h3>
            <p className="meta">{formatName(item.typeKey)}</p>
            <p>
              <span className="badge" data-tone={item.short ? "warn" : "good"}>
                {!item.short
                  ? t("assignmentsComplete")
                  : missing(item) === 1
                    ? t("assignmentsNeedsOne")
                    : t("assignmentsNeedsMany", { n: missing(item) })}
              </span>{" "}
              <span>
                {t("assignmentsReviewers", { n: item.reviewers.length, needed: pool.needed })}
              </span>
              {" · "}
              <span>{t("assignmentsSent", { n: item.sent })}</span>
            </p>
            <p className="meta">
              {item.reviewers.length === 0
                ? t("assignmentsNoReviewer")
                : item.reviewers.map((r) => r.displayName ?? r.email).join(", ")}
            </p>
          </li>
        ))}
      </ul>
      {pool.nextCursor && (
        // aria-disabled while a page is on its way, so focus stays on the button.
        <button
          type="button"
          className="secondary"
          aria-disabled={loading ? "true" : undefined}
          onClick={more}
        >
          {t("manageShowMore")}
        </button>
      )}
      <p className="status-line" role="status">
        {failed === "changed" ? t("manageListChanged") : failed ? t("errorGeneric") : ""}
      </p>
    </section>
  );
}
