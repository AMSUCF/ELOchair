import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import type { ConferenceDetail } from "../api";
import { type MessageKey, useT } from "../i18n";
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
  status: string;
  issueCodes: string[];
  selfIdWarningCount: number;
  contributors: { displayName: string | null; invitedName: string | null; status: string }[];
};
type Page = {
  items: Row[];
  total: number;
  excludedCount: number | null;
  nextCursor: string | null;
};

const STATUSES = [
  "submitted",
  "withdrawn",
  "accepted",
  "waitlisted",
  "rejected",
  "confirmed",
  "published",
];

/** The chair's live view of a call: counts, filters, the list and CSV exports. */
export function ManagePage() {
  const { slug = "" } = useParams();
  const { t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const overview = useApi<Overview>(`/api/conferences/${slug}/overview`);
  const cap = useApi<{ over: { personId: string }[] }>(
    `/api/conferences/${slug}/cap-report?statuses=submitted,accepted,confirmed,published`,
  );
  const [query, setQuery] = useState("status=submitted");
  const list = useApi<Page>(`/api/conferences/${slug}/submissions?${query}&limit=200`);

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
      {!list ? (
        <p role="status">{t("loading")}</p>
      ) : list.ok ? (
        <>
          <p className="meta" role="status">
            {t("manageShown", { n: list.data.total })}
            {list.data.excludedCount
              ? ` · ${t("manageExcluded", { n: list.data.excludedCount })}`
              : ""}
          </p>
          <ul className="cards">
            {list.data.items.map((r) => (
              <li key={r.id} className="card">
                <h2>
                  <Link to={`../s/${r.id}`} relative="path">
                    {r.title || t("editUntitled")}
                  </Link>
                </h2>
                <p className="meta">
                  {localize(
                    config.submissionTypes.find((x) => x.key === r.typeKey)?.name ?? {
                      en: r.typeKey,
                    },
                    "en",
                    config.defaultLanguage,
                  )}{" "}
                  · {t(`status_${r.status}` as MessageKey)}
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
                      ...(r.selfIdWarningCount ? ["self_identification"] : []),
                    ].join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="alert">{t("errorGeneric")}</p>
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
              {t(`status_${s}` as MessageKey)}
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
