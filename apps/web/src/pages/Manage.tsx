import type {
  ConferenceConfig,
  ConferencePhase,
  ContributionStatus,
  SubmissionIssue,
  SubmissionStatus,
} from "@elochair/schema";
import { localize, nextPhase, previousPhase, removeStrayInvisible } from "@elochair/schema/pure";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { type ApiResult, api, type ConferenceDetail, type Me } from "../api";
import { type MessageKey, useT } from "../i18n";
import { type IssueCode, issueLabelKey, phaseDoesKey, phaseKey, statusKey } from "../labels";
import { nobodySignedIn, SignInHere } from "../signIn";
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
/**
 * One proposal of the list. A chair is given most of them as a chair. Their own proposal (and
 * one they were invited to) comes as its people are given it, without the problems a chair is
 * shown: it is listed all the same, as theirs to read.
 */
type Row = {
  view: "chair" | "submitter" | "invitee";
  id: string;
  title: string;
  typeKey: string;
  status: SubmissionStatus;
  issueCodes?: SubmissionIssue["code"][];
  selfIdWarningCount?: number;
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
 * The conference, which a phase move reads again. Unlike useApi, what is on the page stays there
 * until the new answer arrives, so that the phase control keeps its place and the focus it has.
 */
function useConference(slug: string) {
  const url = `/api/conferences/${slug}`;
  const [conf, setConf] = useState<ApiResult<ConferenceDetail> | null>(null);
  /** The conference this page is on now: an answer about another one is dropped. */
  const shown = useRef(url);

  useEffect(() => {
    shown.current = url;
    setConf(null);
    api<ConferenceDetail>(url).then((r) => {
      if (shown.current === url) setConf(r);
    });
  }, [url]);

  /**
   * After a phase move. `moved` is the phase the server answered with, shown at once; then the
   * conference is read again, so that all the page has of it is current. A reading that fails
   * leaves the page as it is.
   */
  const reread = useCallback(
    async (moved?: ConferencePhase) => {
      if (shown.current !== url) return;
      if (moved) {
        setConf((now) => (now?.ok ? { ...now, data: { ...now.data, phase: moved } } : now));
      }
      const r = await api<ConferenceDetail>(url);
      if (r.ok && shown.current === url) setConf(r);
    },
    [url],
  );

  return { conf, reread };
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
  const { conf, reread } = useConference(slug);
  const overview = useApi<Overview>(`/api/conferences/${slug}/overview`);
  const cap = useApi<{ over: { personId: string }[] }>(
    `/api/conferences/${slug}/cap-report?statuses=submitted,accepted,confirmed,published`,
  );
  const me = useApi<Me>("/api/me");
  const [query, setQuery] = useState("status=submitted");
  const { listing, failed, loadingMore, moreFailed, more } = useListing(slug, query);
  // The conference's settings and its phase are for its chairs: the chair and admin roles and
  // site admins, who are one group. Track chairs manage submissions only.
  const mayConfigure =
    me?.ok &&
    me.data.kind === "person" &&
    (me.data.siteAdmin ||
      me.data.roles.some(
        (r) => r.conference === slug && (r.role === "admin" || r.role === "chair"),
      ));

  // Nobody is signed in: the sign-in form, whatever was answered about the conference (its
  // requests refuse a visitor and someone who does not chair it alike).
  if (me && nobodySignedIn(me)) {
    return <SignInHere title={t("manageTitle")} why={t("chairsNeedSignIn")} />;
  }
  if (!conf || !overview || !me) return <p role="status">{t("loading")}</p>;
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
        {mayConfigure && (
          <Link className="button secondary" to={`/${lang}/c/${slug}/settings`}>
            {t("manageSettingsLink")}
          </Link>
        )}
        {/* Who holds a role, and inviting people to one: for the same chairs (spec 03, §1.2). */}
        {mayConfigure && (
          <Link className="button secondary" to={`/${lang}/c/${slug}/people`}>
            {t("managePeopleLink")}
          </Link>
        )}
        {/* Who reviews what, and where reviewers are missing: for the same chairs (§1.3). */}
        {mayConfigure && (
          <Link className="button secondary" to={`/${lang}/c/${slug}/assignments`}>
            {t("manageAssignmentsLink")}
          </Link>
        )}
        {/* What is decided about each proposal, and sending the decisions: the same chairs (§1.6). */}
        {mayConfigure && (
          <Link className="button secondary" to={`/${lang}/c/${slug}/decisions`}>
            {t("manageDecisionsLink")}
          </Link>
        )}
      </p>
      {mayConfigure && <PhaseControl slug={slug} phase={conf.data.phase} onMoved={reread} />}
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
                {((r.issueCodes?.length ?? 0) > 0 || (r.selfIdWarningCount ?? 0) > 0) && (
                  <p className="notice">
                    {t("manageIssues")}:{" "}
                    {[
                      ...(r.issueCodes ?? []),
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

type PhaseStep = "next" | "back";

/**
 * Where the conference is, and the one step forward or back, for its chairs (spec 02, §1.3).
 * A button moves nothing: it opens a confirmation in its place, which says in a sentence what
 * the phase does. Going back needs a reason, which the server keeps with the move.
 */
function PhaseControl({
  slug,
  phase,
  onMoved,
}: {
  slug: string;
  phase: ConferencePhase;
  /** The phase is not what this page shows any more; `moved` when the server said what it is. */
  onMoved: (moved?: ConferencePhase) => void;
}) {
  const { t } = useT();
  /**
   * The confirmation that is open, if one is, and the phase it asks about. That phase is kept
   * as it was asked: what is confirmed is what the question said, whatever the page learns since.
   */
  const [asking, setAsking] = useState<{
    step: PhaseStep;
    to: ConferencePhase;
    /** The phase the page showed when the question was asked: the server moves only from it. */
    from: ConferencePhase;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonRefused, setReasonRefused] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** What takes focus once the confirmation has opened or closed. */
  const focusAfter = useRef<"question" | "status" | PhaseStep | null>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  // After every render: what was asked to take focus exists only once it has been rendered.
  useEffect(() => {
    const to = focusAfter.current;
    if (!to) return;
    focusAfter.current = null;
    const target = { question: questionRef, status: statusRef, next: nextRef, back: backRef }[to];
    target.current?.focus();
  });

  // One step either way, in the order of the phases; nothing after the last or before the first.
  const next = nextPhase(phase);
  const back = previousPhase(phase);
  const name = (p: ConferencePhase) => t(phaseKey(p));
  // The sentences name other phases as this language's catalog does.
  const does = (p: ConferencePhase) =>
    t(phaseDoesKey(p), { reviewing: name("reviewing"), confirming: name("confirming") });

  function ask(step: PhaseStep, to: ConferencePhase) {
    setMessage("");
    setReason("");
    setReasonRefused(false);
    focusAfter.current = "question";
    setAsking({ step, to, from: phase });
  }

  /** Close the confirmation and say why at the status line, which takes focus. */
  function close(text: string) {
    focusAfter.current = "status";
    setAsking(null);
    setMessage(text);
  }

  function cancel() {
    if (inFlight.current) return;
    // Back to the button that opened the confirmation, with nothing left to say.
    focusAfter.current = asking?.step ?? null;
    setAsking(null);
    setMessage("");
  }

  function refuseReason() {
    setReasonRefused(true);
    reasonRef.current?.focus();
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (!asking || inFlight.current) return;
    const { step, to, from } = asking;
    // As for a name: what cannot be seen is taken out before the server refuses it.
    const why = removeStrayInvisible(reason).trim();
    if (step === "back" && !why) return refuseReason();
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const res = await api<{ phase: ConferencePhase }>(`/api/conferences/${slug}/phase`, {
      method: "PUT",
      body: step === "back" ? { phase: to, from, force: true, reason: why } : { phase: to, from },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok) {
      close(t("phaseMoved", { phase: name(res.data.phase) }));
      return onMoved(res.data.phase);
    }
    // A reason the server does not take (nothing in it but punctuation, say).
    if (res.status === 400 && step === "back") return refuseReason();
    if (res.status === 409) {
      // The phase is no longer the one this page showed (another chair moved it, or an earlier
      // try whose answer was lost did): what was asked no longer applies. Show it as it is.
      close(t("phaseOutdated"));
      return onMoved();
    }
    if (res.status === 403) return close(t("phaseNoAccess"));
    // No answer, or not one that says what happened: the confirmation stays, to be tried again.
    setMessage(t("phaseUnconfirmed"));
  }

  return (
    <section className="phase" aria-labelledby="phase-title">
      <h2 id="phase-title">{t("phaseTitle")}</h2>
      <p>{t("phaseNow", { phase: name(phase) })}</p>
      {asking ? (
        <form className="stack wide" onSubmit={confirm} noValidate>
          <h3 tabIndex={-1} ref={questionRef}>
            {t(asking.step === "next" ? "phaseAskNext" : "phaseAskBack", {
              phase: name(asking.to),
            })}
          </h3>
          <p id="phase-does">{does(asking.to)}</p>
          {asking.step === "back" && (
            <div className="stack wide">
              <label htmlFor="phase-reason">{t("phaseReason")}</label>
              <input
                id="phase-reason"
                ref={reasonRef}
                type="text"
                maxLength={500}
                required
                autoComplete="off"
                value={reason}
                aria-invalid={reasonRefused ? "true" : undefined}
                aria-describedby={
                  reasonRefused ? "phase-reason-hint phase-reason-error" : "phase-reason-hint"
                }
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonRefused(false);
                }}
              />
              <p className="setting-hint" id="phase-reason-hint">
                {t("phaseReasonHint")}
              </p>
              {reasonRefused && (
                <p className="field-error" id="phase-reason-error">
                  {t("phaseReasonNeeded")}
                </p>
              )}
            </div>
          )}
          <p className="actions">
            {/* aria-disabled while the move is on its way, so focus stays on the button. */}
            <button
              type="submit"
              aria-describedby="phase-does"
              aria-disabled={busy ? "true" : undefined}
            >
              {t(asking.step === "next" ? "phaseDoNext" : "phaseDoBack")}
            </button>
            <button
              type="button"
              className="secondary"
              aria-disabled={busy ? "true" : undefined}
              onClick={cancel}
            >
              {t("phaseCancel")}
            </button>
          </p>
        </form>
      ) : (
        <p className="actions">
          {next && (
            <button type="button" ref={nextRef} onClick={() => ask("next", next)}>
              {t("phaseNext", { phase: name(next) })}
            </button>
          )}
          {back && (
            <button
              type="button"
              className="secondary"
              ref={backRef}
              onClick={() => ask("back", back)}
            >
              {t("phaseBack", { phase: name(back) })}
            </button>
          )}
        </p>
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
    </section>
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
