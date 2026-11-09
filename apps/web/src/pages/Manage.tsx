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
import { useT } from "../i18n";
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

/** The list for one filter, a page at a time ("Show more" follows the server's cursor). */
function useListing(slug: string, query: string) {
  const [listing, setListing] = useState<(Page & { query: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** "Show more" failed: the list so far stays, with a message by the button. */
  const [moreFailed, setMoreFailed] = useState(false);
  /** After "Show more", the first new proposal takes focus so keyboard users continue there. */
  const focusRow = useRef<string | null>(null);
  const url = `/api/conferences/${slug}/submissions?${query}&limit=${PAGE_SIZE}`;

  useEffect(() => {
    let live = true;
    setListing(null);
    setFailed(false);
    setMoreFailed(false);
    api<Page>(url).then((r) => {
      if (!live) return;
      if (r.ok) setListing({ ...r.data, query });
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [url, query]);

  useEffect(() => {
    if (!listing || !focusRow.current) return;
    document.getElementById(`row-${focusRow.current}`)?.focus();
    focusRow.current = null;
  }, [listing]);

  async function more() {
    const cursor = listing?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setMoreFailed(false);
    const r = await api<Page>(`${url}&cursor=${encodeURIComponent(cursor)}`);
    setLoadingMore(false);
    if (!r.ok) {
      setMoreFailed(true);
      return;
    }
    focusRow.current = r.data.items[0]?.id ?? null;
    setListing((current) =>
      current && current.query === query
        ? {
            ...current,
            items: [...current.items, ...r.data.items],
            total: r.data.total,
            excludedCount: r.data.excludedCount,
            nextCursor: r.data.nextCursor,
          }
        : current,
    );
  }

  return { listing, failed, loadingMore, moreFailed, more };
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
      <ul className="facts">
        <li>{t("manageShown", { n: o.total })}</li>
        <li>{t("manageDrafts", { n: o.draftCount })}</li>
        <li>{t("manageIncomplete", { n: o.incomplete })}</li>
        <li>{t("managePending", { n: o.withPendingInvitations })}</li>
        <li>{t("manageSelfId", { n: o.withSelfIdWarnings })}</li>
        {cap?.ok && <li>{t("manageOverCap", { n: cap.data.over.length })}</li>}
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
          <p className="meta" role="status">
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
            <button type="button" className="secondary" disabled={loadingMore} onClick={more}>
              {t("manageShowMore")}
            </button>
          )}
          <p className="status-line" role="status">
            {moreFailed ? t("errorGeneric") : ""}
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
