import type {
  ConferenceConfig,
  ContributionStatus,
  SubmissionIssue,
  SubmissionStatus,
} from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { api, type ConferenceDetail } from "../api";
import { type MessageKey, useT } from "../i18n";
import { type IssueCode, issueLabelKey, statusKey } from "../labels";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

type Overview = {
  total: number;
  draftCount: number;
  incomplete: number;
  withPendingInvitations: number;
  withSelfIdWarnings: number;
  withoutAvailableChair: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
};
type Row = {
  view: "chair";
  id: string;
  title: string;
  typeKey: string;
  status: SubmissionStatus;
  issueCodes: SubmissionIssue["code"][];
  selfIdWarningCount: number;
  contributors: {
    displayName: string | null;
    invitedName: string | null;
    status: ContributionStatus;
  }[];
};
type Page = {
  items: Row[];
  total: number;
  excludedCount: number | null;
  nextCursor: string | null;
};

const STATUSES: SubmissionStatus[] = [
  "submitted",
  "withdrawn",
  "accepted",
  "waitlisted",
  "rejected",
  "confirmed",
  "published",
];
const PAGE_SIZE = 100;

/** The "Showing X of Y" line; it takes focus when "Show more" brought nothing new to focus. */
const SHOWING_ID = "manage-showing";

/** The list for one filter, a page at a time ("Show more" follows the server's cursor). */
function useListing(slug: string, query: string) {
  const url = `/api/conferences/${slug}/submissions?${query}&limit=${PAGE_SIZE}`;
  const [listing, setListing] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /**
   * "Show more" failed: the list so far stays, with a message by the button. "changed": the
   * server no longer knows where the list ended (400 at path "cursor").
   */
  const [moreFailed, setMoreFailed] = useState<"error" | "changed" | null>(null);
  /** Counts filter changes: a page that arrives for an earlier list is dropped. */
  const generation = useRef(0);
  /** Repeat taps on "Show more" while a page is on its way do nothing. */
  const moreInFlight = useRef(false);
  /**
   * After "Show more", the first new proposal takes focus so keyboard users continue there.
   * Set only when a page is added to the list being shown; cleared when the filter changes.
   */
  const focusAfterMore = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    generation.current += 1;
    moreInFlight.current = false;
    focusAfterMore.current = null;
    setListing(null);
    setFailed(false);
    setLoadingMore(false);
    setMoreFailed(null);
    api<Page>(url).then((r) => {
      if (!live) return;
      if (r.ok) setListing(r.data);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [url]);

  useEffect(() => {
    if (!listing || !focusAfterMore.current) return;
    document.getElementById(focusAfterMore.current)?.focus();
    focusAfterMore.current = null;
  }, [listing]);

  async function more() {
    const cursor = listing?.nextCursor;
    if (!listing || !cursor || moreInFlight.current) return;
    const asked = generation.current;
    moreInFlight.current = true;
    setLoadingMore(true);
    setMoreFailed(null);
    const r = await api<Page>(`${url}&cursor=${encodeURIComponent(cursor)}`);
    // The filter changed while this page was on its way: it belongs to a list no longer shown.
    if (generation.current !== asked) return;
    moreInFlight.current = false;
    setLoadingMore(false);
    if (!r.ok) {
      setMoreFailed(
        r.status === 400 && r.issues.some((i) => i.path === "cursor") ? "changed" : "error",
      );
      return;
    }
    // A proposal is listed once, even if a page repeats one already shown.
    const listed = new Set(listing.items.map((x) => x.id));
    const added = r.data.items.filter((x) => !listed.has(x.id));
    // Focus goes to the first new proposal; with none, to the count if the button goes away.
    focusAfterMore.current = added[0]
      ? `row-${added[0].id}`
      : r.data.nextCursor
        ? null
        : SHOWING_ID;
    setListing((current) =>
      current
        ? {
            ...current,
            items: [...current.items, ...added],
            total: r.data.total,
            excludedCount: r.data.excludedCount,
            nextCursor: r.data.nextCursor,
          }
        : current,
    );
  }

  return { listing, failed, loadingMore, moreFailed, more };
}

/**
 * One overview figure: the catalog's sentence ("{n} drafts in progress") with its number set
 * large. The sentence stays whole, in the order each language wants.
 */
function Figure({ k, n }: { k: MessageKey; n: number }) {
  const { t } = useT();
  const [before, after = ""] = t(k, { n: "{n}" }).split("{n}");
  return (
    <li>
      {before}
      <strong className="stat-value">{n}</strong>
      {after}
    </li>
  );
}

/** The chair's live view of a call: counts, filters, the list and CSV exports. */
export function ManagePage() {
  const { slug = "" } = useParams();
  const { lang, t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const overview = useApi<Overview>(`/api/conferences/${slug}/overview`);
  const cap = useApi<{ over: { personId: string }[] }>(
    `/api/conferences/${slug}/cap-report?statuses=submitted,accepted,confirmed,published`,
  );
  const [query, setQuery] = useState("status=submitted");
  const { listing, failed, loadingMore, moreFailed, more } = useListing(slug, query);

  if (!conf || !overview) return <p role="status">{t("loading")}</p>;
  if (!conf.ok) return <PageHeading>{t("confNotFound")}</PageHeading>;
  if (!overview.ok) {
    return (
      <>
        <PageHeading>{t("manageTitle")}</PageHeading>
        <p role="alert">{t("manageNoAccess")}</p>
      </>
    );
  }
  const config = conf.data.config;
  const o = overview.data;
  const formatName = (typeKey: string) => {
    const type = config.submissionTypes.find((x) => x.key === typeKey);
    return type ? localize(type.name, lang, config.defaultLanguage) : typeKey;
  };
  return (
    <>
      <PageHeading title={t("manageTitle")}>{t("manageTitle")}</PageHeading>
      <p className="meta">
        <Localized text={config.title} fallback={config.defaultLanguage} />
      </p>
      <ul className="overview">
        {/* Every proposal sent in (withdrawn ones too), whatever the filter: not what is shown. */}
        <Figure k="manageReceived" n={o.total} />
        <Figure k="manageDrafts" n={o.draftCount} />
        <Figure k="manageIncomplete" n={o.incomplete} />
        <Figure k="managePending" n={o.withPendingInvitations} />
        <Figure k="manageSelfId" n={o.withSelfIdWarnings} />
        {cap?.ok && <Figure k="manageOverCap" n={cap.data.over.length} />}
        {o.withoutAvailableChair > 0 && (
          <li className="notice">{t("manageNoChair", { n: o.withoutAvailableChair })}</li>
        )}
      </ul>
      <p className="actions">
        <a className="button" href={`/api/conferences/${slug}/submissions.csv?${query}`} download>
          {t("manageCsv")}
        </a>
        <a
          className="button secondary"
          href={`/api/conferences/${slug}/contributors.csv?${query}`}
          download
        >
          {t("manageContribCsv")}
        </a>
      </p>
      <Filters config={config} onApply={setQuery} />
      {failed ? (
        <p role="alert">{t("errorGeneric")}</p>
      ) : !listing ? (
        <p role="status">{t("loading")}</p>
      ) : (
        <>
          <p className="meta" role="status" id={SHOWING_ID} tabIndex={-1}>
            {t("manageShowing", { shown: listing.items.length, total: listing.total })}
            {listing.excludedCount ? ` · ${t("manageExcluded", { n: listing.excludedCount })}` : ""}
          </p>
          <ul className="cards">
            {listing.items.map((r) => (
              <li key={r.id} className="card">
                <h2>
                  <Link id={`row-${r.id}`} to={`/${lang}/s/${r.id}`}>
                    {r.title || t("editUntitled")}
                  </Link>
                </h2>
                <p className="meta">
                  {formatName(r.typeKey)} · {t(statusKey(r.status))}
                </p>
                <p className="meta">
                  {r.contributors
                    .filter((c) => c.status !== "declined")
                    .map(
                      (c) =>
                        `${c.displayName ?? c.invitedName ?? "—"}${c.status === "invited" ? ` (${t("contrib_status_invited")})` : ""}`,
                    )
                    .join(", ")}
                </p>
                {(r.issueCodes.length > 0 || r.selfIdWarningCount > 0) && (
                  <p className="notice">
                    {t("manageIssues")}:{" "}
                    {[
                      ...r.issueCodes,
                      ...(r.selfIdWarningCount ? (["self_identification"] as const) : []),
                    ]
                      .map((code: IssueCode) => t(issueLabelKey(code)))
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {listing.nextCursor && (
            // aria-disabled while a page is on its way, so focus stays on the button.
            <button
              type="button"
              className="secondary"
              aria-disabled={loadingMore ? "true" : undefined}
              onClick={more}
            >
              {t("manageShowMore")}
            </button>
          )}
          <p className="status-line" role="status">
            {moreFailed === "changed"
              ? t("manageListChanged")
              : moreFailed
                ? t("errorGeneric")
                : ""}
          </p>
        </>
      )}
    </>
  );
}

function Filters({ config, onApply }: { config: ConferenceConfig; onApply: (q: string) => void }) {
  const { lang, t } = useT();
  const [status, setStatus] = useState("submitted");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  function apply(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (type) p.set("type", type);
    if (q.trim()) p.set("q", q.trim());
    onApply(p.toString());
  }
  return (
    <form onSubmit={apply} className="filters" aria-label={t("manageFilters")}>
      <label>
        {t("manageStatus")}
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("manageAll")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(statusKey(s))}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("manageType")}
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">{t("manageAll")}</option>
          {config.submissionTypes.map((x) => (
            <option key={x.key} value={x.key}>
              {localize(x.name, lang, config.defaultLanguage)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("manageSearch")}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="submit">{t("manageApply")}</button>
    </form>
  );
}
