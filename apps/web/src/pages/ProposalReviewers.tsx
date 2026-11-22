import type { ConferenceConfig } from "@elochair/schema";
import { effectiveBlindMode, localize, reviewersCanRead } from "@elochair/schema/pure";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  type ApiResult,
  api,
  type ProposalReviewers,
  type ReviewerCandidate,
  type RoleHolder,
} from "../api";
import { Ask, type Asking, StatusLine, useSaid } from "../asking";
import { formatDateTime, viewerTimeZone } from "../format";
import { LANG_NAMES, type Lang, useT } from "../i18n";
import { useHashTarget } from "../ui";

/*
 * The Reviewers section of a proposal's page, for a chair who manages the proposal (spec 03,
 * §1.3): who reviews it, removing one of them, and assigning another from the reviewers of the
 * committee that reviews its format. The server decides who is offered and refuses anyone else;
 * this page shows what arrives.
 *
 * Assigning someone who is offered takes one press. Two things ask first, in place, and say
 * what will happen: removing a reviewer, and assigning one who has reached the number of
 * proposals they said they would take.
 */

/** A list of reviewers longer than this gets a box to find one by name. */
const FIND_FROM = 8;

/** Letters without their accents, in lower case: "Lucía" is found by typing "lucia". */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** What a request did, for the page to say. `open`: a confirmation to open, with `text` in it. */
type Outcome = { ok: true } | { ok: false; keep: boolean; text: string; open?: Asking };

/**
 * Who reviews the proposal, read again after every change. What is on the page stays there
 * until the new answer arrives, so that the page keeps its place and the focus it has.
 */
function useReviewers(url: string) {
  const [view, setView] = useState<ApiResult<ProposalReviewers> | null>(null);
  /** The proposal this section is about now: an answer about another one is dropped. */
  const shown = useRef(url);

  useEffect(() => {
    shown.current = url;
    setView(null);
    api<ProposalReviewers>(url).then((r) => {
      if (shown.current === url) setView(r);
    });
  }, [url]);

  /** A reading that fails for want of an answer leaves the page as it is. */
  const reread = useCallback(async () => {
    const r = await api<ProposalReviewers>(url);
    if ((r.ok || r.status === 403 || r.status === 404) && shown.current === url) setView(r);
  }, [url]);

  return { view, reread };
}

export function ProposalReviewersSection({
  slug,
  submissionId,
  typeKey,
  phase,
  config,
}: {
  slug: string;
  submissionId: string;
  typeKey: string;
  /** The conference's phase: reviewers read what is assigned to them once it is in review. */
  phase: string;
  config: ConferenceConfig;
}) {
  const { lang, t } = useT();
  const base = `/api/conferences/${slug}/assignments/submissions/${submissionId}`;
  const { view, reread } = useReviewers(base);
  const [asking, setAsking] = useState<Asking>(null);
  /** Said inside the open confirmation when it stays open: what went wrong, to try again. */
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");
  const inFlight = useRef(false);
  /** The id of what takes focus after the next render (a button that reappears). */
  const focusAfter = useRef<string | null>(null);
  const said = useSaid();
  // A link from the Assignments page leads here ("#reviewers"), once the section is drawn.
  useHashTarget(view !== null);

  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    document.getElementById(id)?.focus();
  });

  const heading = (
    <h2 id="reviewers" tabIndex={-1}>
      {t("reviewersTitle")}
    </h2>
  );
  if (!view) {
    return (
      <section className="reviewers" aria-labelledby="reviewers">
        {heading}
        <p role="status">{t("loading")}</p>
      </section>
    );
  }
  if (!view.ok) {
    return (
      <section className="reviewers" aria-labelledby="reviewers">
        {heading}
        <p role="alert">{t("reviewersLoadFailed")}</p>
      </section>
    );
  }
  const data = view.data;
  const pool = config.reviewPools.find((p) => p.key === data.pool);
  const committee = pool ? localize(pool.name, lang, config.defaultLanguage) : (data.pool ?? "");
  const called = (p: RoleHolder) => p.displayName ?? p.email;
  const when = (iso: string) => formatDateTime(iso, lang, viewerTimeZone());
  const how = t(`reviewersHow_${effectiveBlindMode(config, typeKey)}`);

  function ask(key: string, opener: string) {
    if (inFlight.current) return;
    setNote("");
    setAsking({ key, opener });
  }
  /** "No, go back": the button returns, and takes focus again. */
  function dismiss() {
    if (inFlight.current || !asking) return;
    focusAfter.current = asking.opener;
    setAsking(null);
    setNote("");
  }

  /**
   * One request that changes something, then what the page says about it. When it is done (or
   * can no longer be done), the confirmation closes, the section is read again and the status
   * line says so. When it may be tried again, an open confirmation stays and says why.
   */
  async function act(done: string, run: () => Promise<Outcome>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote("");
    const outcome = await run();
    inFlight.current = false;
    setBusy(false);
    if (!outcome.ok && outcome.open) {
      // The question was not asked yet, and has to be: it opens with the reason in it.
      await reread();
      setAsking(outcome.open);
      setNote(outcome.text);
      return;
    }
    if (!outcome.ok && outcome.keep && asking) {
      setNote(outcome.text);
      return;
    }
    setAsking(null);
    await reread();
    said.say(outcome.ok ? done : outcome.text);
  }

  const assign = (c: ReviewerCandidate, key: string, opener: string, confirmedFull: boolean) =>
    act(t("reviewersAssigned", { name: called(c) }), async () => {
      const name = called(c);
      const res = await api(`${base}/reviewers`, {
        method: "POST",
        // What the confirmation said: without it the server assigns nobody who is full.
        body: { reviewerId: c.personId, ...(confirmedFull ? { confirmedFull: true } : {}) },
      });
      if (res.ok) return { ok: true };
      if (res.error === "reviewer_full") {
        // They reached their number since this page was loaded: ask, with the numbers as they are.
        return {
          ok: false,
          keep: true,
          text: t("reviewersNowFull", { name }),
          open: { key, opener },
        };
      }
      if (res.error === "already_assigned") {
        return { ok: false, keep: false, text: t("reviewersAlready", { name }) };
      }
      if (res.error === "not_offered") {
        return { ok: false, keep: false, text: t("reviewersNotOffered", { name }) };
      }
      if (res.error === "call_not_closed" || res.error === "not_under_consideration") {
        return { ok: false, keep: false, text: t("reviewersNotTaking") };
      }
      if (res.status === 403 || res.status === 404) {
        return { ok: false, keep: false, text: t("reviewersNoAccess") };
      }
      if (res.status === 429) return { ok: false, keep: true, text: t("signInRateLimited") };
      return { ok: false, keep: true, text: t("peopleUnconfirmed") };
    });

  const remove = (r: RoleHolder) =>
    act(t("reviewersRemoved", { name: called(r) }), async () => {
      const res = await api(`${base}/reviewers/${r.personId}`, { method: "DELETE", body: {} });
      if (res.ok) return { ok: true };
      if (res.status === 404) {
        return { ok: false, keep: false, text: t("reviewersRemoveGone", { name: called(r) }) };
      }
      if (res.status === 403) return { ok: false, keep: false, text: t("reviewersNoAccess") };
      if (res.status === 429) return { ok: false, keep: true, text: t("signInRateLimited") };
      return { ok: false, keep: true, text: t("peopleUnconfirmed") };
    });

  const wanted = folded(find.trim());
  const matching = wanted
    ? data.candidates.filter((c) => folded(`${c.displayName ?? ""} ${c.email}`).includes(wanted))
    : data.candidates;

  return (
    <section className="reviewers" aria-labelledby="reviewers">
      {heading}
      <p>
        {t(reviewersCanRead(phase) ? "reviewersDoes_now" : "reviewersDoes_before", { how })}{" "}
        {t("reviewersNoMail")}
      </p>
      <p>
        {t("reviewersCount", {
          n: data.assigned.filter((r) => !r.blocked).length,
          needed: data.needed,
        })}{" "}
        {pool &&
          t(data.needed === 1 ? "reviewersAsksOne" : "reviewersAsksMany", {
            committee,
            needed: data.needed,
          })}
      </p>
      <StatusLine said={said} />
      {data.assigned.length === 0 ? (
        <p className="meta">{t("reviewersNone")}</p>
      ) : (
        <ul className="roster" aria-labelledby="reviewers">
          {data.assigned.map((r) => {
            const key = `release-${r.personId}`;
            const opener = `${key}-open`;
            const name = called(r);
            return (
              <li key={r.personId}>
                <p className="who">{r.displayName ?? t("peopleNoName")}</p>
                <p className="meta">{r.email}</p>
                <p className="meta">{t("reviewersAssignedOn", { date: when(r.assignedAt) })}</p>
                {r.blocked && <p>{t("reviewersBlocked")}</p>}
                {asking?.key === key ? (
                  <Ask
                    level="h3"
                    question={t("reviewersAskRemove", { name })}
                    yes={t("peopleDoRemove")}
                    busy={busy}
                    note={note}
                    onYes={() => remove(r)}
                    onNo={dismiss}
                  >
                    <p>
                      {t("reviewersRemoveDoes", { name })}
                      {/* True only of a proposal that still takes reviewers. */}
                      {data.takes !== "not_under_consideration" && ` ${t("reviewersRemoveAgain")}`}
                    </p>
                  </Ask>
                ) : (
                  <p className="actions">
                    <button
                      type="button"
                      className="secondary"
                      id={opener}
                      aria-label={t("reviewersRemoveFor", { name })}
                      onClick={() => ask(key, opener)}
                    >
                      {t("reviewersRemove")}
                    </button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h3 id="reviewers-assign">{t("reviewersAssignTitle")}</h3>
      {data.takes !== "yes" ? (
        <p className="notice">{t(`reviewersTakes_${data.takes}`)}</p>
      ) : data.candidates.length === 0 ? (
        <p>
          {t("reviewersNoCandidates")}{" "}
          <Link to={`/${lang}/c/${slug}/people`}>{t("managePeopleLink")}</Link>
        </p>
      ) : (
        <>
          <p className="meta">{t("reviewersAssignIntro")}</p>
          {data.candidates.length > FIND_FROM && (
            <div className="stack wide">
              <label htmlFor="reviewers-find">{t("reviewersFind")}</label>
              <input
                id="reviewers-find"
                type="search"
                autoComplete="off"
                value={find}
                onChange={(e) => {
                  // A question that is open belongs to a row that may no longer be shown.
                  if (!inFlight.current) {
                    setAsking(null);
                    setNote("");
                  }
                  setFind(e.target.value);
                }}
              />
              <p className="meta" role="status">
                {wanted &&
                  (matching.length === 0
                    ? t("reviewersFindNone")
                    : t("manageShowing", {
                        shown: matching.length,
                        total: data.candidates.length,
                      }))}
              </p>
            </div>
          )}
          <ul className="roster" aria-labelledby="reviewers-assign">
            {matching.map((c) => {
              const key = `assign-${c.personId}`;
              const opener = `${key}-open`;
              const name = called(c);
              const languages = c.languages.map((l) => LANG_NAMES[l as Lang] ?? l).join(", ");
              return (
                <li key={c.personId}>
                  <p className="who">{c.displayName ?? t("peopleNoName")}</p>
                  <p className="meta">{c.email}</p>
                  <p>
                    {c.maxLoad === null
                      ? t("reviewersLoad", { n: c.assigned })
                      : t("reviewersLoadOf", { n: c.assigned, max: c.maxLoad })}
                    {languages && ` · ${t("reviewersLanguages", { languages })}`}
                  </p>
                  {c.full && <p>{t("reviewersFull")}</p>}
                  {asking?.key === key ? (
                    <Ask
                      level="h4"
                      question={t("reviewersAskFull", { name })}
                      yes={t("reviewersDoAssign")}
                      busy={busy}
                      note={note}
                      onYes={() => assign(c, key, opener, true)}
                      onNo={dismiss}
                    >
                      <p>{t("reviewersFullDoes", { name, max: c.maxLoad ?? 0, n: c.assigned })}</p>
                    </Ask>
                  ) : (
                    <p className="actions">
                      {/* aria-disabled while a request is on its way, so focus stays put. */}
                      <button
                        type="button"
                        id={opener}
                        aria-label={t("reviewersAssignFor", { name })}
                        aria-disabled={busy ? "true" : undefined}
                        onClick={() => (c.full ? ask(key, opener) : assign(c, key, opener, false))}
                      >
                        {t("reviewersAssign")}
                      </button>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
