import type { ConferenceConfig, ReviewPool } from "@elochair/schema";
import {
  countWords,
  fitReview,
  localize,
  RECOMMENDATIONS,
  type ReviewContent,
  reviewIssues,
  scaleChoices,
} from "@elochair/schema/pure";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker } from "react-router";
import { type ApiResult, api, type Issue, type OwnReview } from "../api";
import { StatusLine, useSaid } from "../asking";
import { formatDateTime, viewerTimeZone } from "../format";
import { describedBy, ErrorSummary, FieldError, fieldId, RestoredNotice } from "../forms";
import { useT } from "../i18n";
import { browserStore, clearUnsaved } from "../unsaved";
import { reviewScope, unsavedOfReview, withUnsavedReview } from "../unsavedReview";
import { useUnsaved } from "../useUnsaved";

/*
 * A reviewer's own review of a proposal, under the proposal (spec 03, §1.4): one form, saved as
 * a draft and then sent; once sent, the review as the chairs read it, with "Change my review"
 * for as long as the conference is in review. In a later phase everything here is read only.
 *
 * The form is the committee's, as the chairs worded it (spec 03, §1.8): its criteria with their
 * scales and descriptions, the limits and the description of the comments, and whether there
 * is a note for the chairs and a recommendation, are read from the conference's configuration.
 * Where the chairs wrote no description, the app's standard wording is shown.
 *
 * What is typed and not saved is kept in this browser, under the reviewer's id, as a proposal's
 * unsaved text is (unsaved.ts): it is back after a reload, with a notice and a way to discard
 * it, and gone once it is saved or discarded, and on sign-out. Where the review was saved
 * somewhere else since that text was typed, the notice says so: the text is back on top of the
 * newer review, and would replace what was saved there.
 */

const contentOf = (r: OwnReview): ReviewContent => ({
  scores: { ...r.scores },
  comments: r.comments,
  chairNote: r.chairNote,
  recommendation: r.recommendation,
});

/** The same page in any interface language. */
const withoutLang = (pathname: string) => pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");

/**
 * Loads the reviewer's own review, then shows it. `whereTheirs` is for a page that does not know
 * whether the person reviews the proposal (a chair's page: a chair may also be one of its
 * reviewers): the section is then shown only where the server says the review is theirs, and
 * `before` (the committee's guidelines) with it.
 */
export function ReviewSection({
  submissionId,
  language,
  pool,
  config,
  personId,
  whereTheirs = false,
  before,
}: {
  submissionId: string;
  /** The language of the proposal: words are counted as the server counts them. */
  language: string;
  pool: ReviewPool;
  config: ConferenceConfig;
  personId: string | null;
  whereTheirs?: boolean;
  before?: ReactNode;
}) {
  const { t } = useT();
  const [loaded, setLoaded] = useState<ApiResult<OwnReview> | null>(null);
  useEffect(() => {
    let live = true;
    setLoaded(null);
    api<OwnReview>(`/api/submissions/${submissionId}/review`).then((r) => {
      // Not theirs to review, or no longer (a chair removed them from it): what they left
      // unsaved for it in this browser goes. A chair who also reviews still opens the page.
      if (!r.ok && r.status === 404 && personId) {
        clearUnsaved(browserStore(), personId, reviewScope(submissionId));
      }
      if (live) setLoaded(r);
    });
    return () => {
      live = false;
    };
  }, [submissionId, personId]);

  if (!loaded?.ok) {
    // Not theirs to review (the answer a missing proposal gets): there is nothing to show.
    if (whereTheirs && (!loaded || loaded.status === 404)) return null;
    return (
      <section className="review" aria-labelledby="your-review">
        <h2 id="your-review">{t("reviewFormTitle")}</h2>
        {loaded ? <p role="alert">{t("errorGeneric")}</p> : <p role="status">{t("loading")}</p>}
      </section>
    );
  }
  return (
    <>
      {before}
      <ReviewPanel
        initial={loaded.data}
        language={language}
        pool={pool}
        config={config}
        personId={personId}
      />
    </>
  );
}

function ReviewPanel({
  initial,
  language,
  pool,
  config,
  personId,
}: {
  initial: OwnReview;
  language: string;
  pool: ReviewPool;
  config: ConferenceConfig;
  personId: string | null;
}) {
  const { lang, t } = useT();
  const id = initial.submissionId;
  const [review, setReview] = useState(initial);
  const { found, keep, drop } = useUnsaved(personId, reviewScope(id));
  /** The review as the server last had it, as far as the form still takes it. */
  const [base, setBase] = useState<ReviewContent>(() => fitReview(pool, contentOf(initial)));
  /**
   * What an earlier visit left typed and unsaved in this browser, back on top of it. "moved":
   * the review was saved somewhere else since it was typed (another tab, another device).
   */
  const [restore] = useState(() => {
    if (!initial.open || !found) return null;
    const kept = withUnsavedReview(base, found.values, pool);
    return Object.keys(unsavedOfReview(base, kept)).length > 0
      ? { form: kept, version: found.version, moved: found.version !== initial.version }
      : null;
  });
  const [form, setForm] = useState<ReviewContent>(() => restore?.form ?? base);
  /**
   * The form as it is at this very moment. It stays open to typing while a request is on its
   * way, and the answer has to be set against what is typed by then.
   */
  const formNow = useRef(form);
  useEffect(() => {
    formNow.current = form;
  }, [form]);
  /** Restored text that is neither saved nor discarded yet; "moved": onto a newer review. */
  const [restored, setRestored] = useState<"same" | "moved" | null>(null);
  /**
   * The version the unsaved text was typed on, where the review has moved on since: the browser
   * keeps it under that version until its writer saves or discards it, so that a reload says
   * again what it is.
   */
  const [heldVersion, setHeldVersion] = useState<number | null>(
    restore?.moved ? restore.version : null,
  );
  /** A sent review is read first; "Change my review" (or unsaved changes to it) opens the form. */
  const [changing, setChanging] = useState(initial.status === "sent" && restore !== null);
  const [issues, setIssues] = useState<Issue[]>([]);
  /** Whether the problems shown keep the review from being sent, or a draft from being saved. */
  const [sending, setSending] = useState(true);
  /** The proposal is no longer this person's to review: nothing more can be saved. */
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** What was last done here, said in a line that takes focus once it holds the new text. */
  const said = useSaid();
  const { say } = said;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  const editing = review.open && !gone && (review.status !== "sent" || changing);
  const unsaved = useMemo(() => unsavedOfReview(base, form), [base, form]);
  const dirty = editing && Object.keys(unsaved).length > 0;

  // Said after the first render, so that the notice is announced.
  useEffect(() => {
    if (restore) setRestored(restore.moved ? "moved" : "same");
  }, [restore]);

  // What is typed and would change something is kept in this browser; once nothing would
  // (saved, taken back, discarded), nothing is kept.
  useEffect(() => {
    if (review.open && !gone) keep(dirty ? unsaved : {}, heldVersion ?? review.version);
  }, [keep, review.open, review.version, heldVersion, gone, dirty, unsaved]);

  // Reviewing has ended, or the proposal is no longer theirs: nothing here can be sent any more.
  useEffect(() => {
    if (!review.open || gone) drop();
  }, [review.open, gone, drop]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // In-app navigation asks before unsaved changes are left behind, as in the proposal editor.
  // Switching the interface language keeps the page, so it is not blocked.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && withoutLang(currentLocation.pathname) !== withoutLang(nextLocation.pathname),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t("editLeaveUnsaved"))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  // Opening or closing the form puts focus on the section's heading: what follows it is new.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  });

  /** What was said about the last press no longer holds once something else is done. */
  const clear = () => {
    if (said.text) say("");
  };
  const text = (value: Record<string, string> | undefined) =>
    value ? localize(value, lang, config.defaultLanguage) : "";
  const when = (iso: string) => formatDateTime(iso, lang, viewerTimeZone());
  const labelOf = (path: string) => {
    if (path === "comments") return t("reviewComments");
    if (path === "chairNote") return t("reviewNoteHeading");
    if (path === "recommendation") return t("reviewRecommendation");
    const criterion = pool.criteria.find((c) => `scores.${c.key}` === path);
    return criterion ? text(criterion.label) : undefined;
  };

  /**
   * The server's copy, after an answer that says ours is out of date. What is typed stays in
   * the form. Says what there is to say about it: `otherwise`, unless the proposal is no longer
   * this person's to review.
   */
  async function reread(otherwise: string) {
    const res = await api<OwnReview>(`/api/submissions/${id}/review`);
    if (!res.ok && res.status === 404) {
      setGone(true);
      return say(t("reviewGone"));
    }
    if (res.ok) {
      // What is in the form was typed on the version this page had: the browser keeps it under
      // that one until it is saved or discarded, and a reload says what it is.
      if (res.data.version !== review.version) setHeldVersion((held) => held ?? review.version);
      setReview(res.data);
      setBase(fitReview(pool, contentOf(res.data)));
      // A review that was sent meanwhile is changed, not saved as a draft.
      if (res.data.status === "sent" && res.data.open) setChanging(true);
    }
    say(otherwise);
  }

  async function save(send: boolean) {
    if (inFlight.current || !editing) return;
    clear();
    if (!dirty && (!send || review.status === "sent")) {
      setIssues([]);
      return say(t("reviewNothingToSave"));
    }
    setSending(send);
    if (send) {
      // The same rules the server applies (reviewIssues): said at once, beside each field.
      const found = reviewIssues(pool, form, language);
      if (found.length > 0) return setIssues(found);
    }
    inFlight.current = true;
    setBusy(true);
    const sent = form;
    const res = await api<OwnReview>(`/api/submissions/${id}/review`, {
      method: "PUT",
      body: { version: review.version, send, ...sent },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok) {
      const fresh = fitReview(pool, contentOf(res.data));
      const wasSent = review.status === "sent";
      setReview(res.data);
      setBase(fresh);
      // Anything typed while the save was on its way stays in the form, as an unsaved change
      // to what was saved: after a send too, where the form then stays open on it.
      const typedSince = formNow.current !== sent;
      if (!typedSince) setForm(fresh);
      setRestored(null);
      setHeldVersion(null);
      setIssues([]);
      if (send) setChanging(typedSince);
      return say(t(!send ? "reviewDraftSaved" : wasSent ? "reviewChanged" : "reviewSent"));
    }
    if (res.status === 422 || (res.status === 400 && res.issues.length > 0)) {
      return setIssues(res.issues);
    }
    setIssues([]);
    if (res.status === 409 && res.error === "stale") return reread(t("reviewStale"));
    if (res.status === 409 && res.error === "already_sent") {
      return reread(t("reviewAlreadySent"));
    }
    if (res.status === 409 && res.error === "not_reviewing") {
      return reread(t("reviewNotReviewing"));
    }
    if (res.status === 404) {
      setGone(true);
      return say(t("reviewGone"));
    }
    say(t(res.status === 429 ? "signInRateLimited" : "reviewUnconfirmed"));
  }

  function discardRestored() {
    setForm(base);
    setRestored(null);
    setHeldVersion(null);
    setIssues([]);
    if (review.status === "sent") setChanging(false);
    say(t("unsavedDiscarded"));
  }

  function startChanging() {
    clear();
    setChanging(true);
    focusHeading.current = true;
  }
  /** Back to the review as it was sent: what was typed since is dropped, after asking. */
  function keepSent() {
    // Not while a send is on its way: its answer would be set against a form that was closed.
    if (inFlight.current) return;
    if (dirty && !window.confirm(t("editLeaveUnsaved"))) return;
    setForm(base);
    setRestored(null);
    setHeldVersion(null);
    setIssues([]);
    clear();
    setChanging(false);
    focusHeading.current = true;
  }

  const set = <K extends keyof ReviewContent>(key: K, value: ReviewContent[K]) => {
    clear();
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setScore = (key: string, value: number | undefined) => {
    clear();
    setForm((f) => {
      const scores = { ...f.scores };
      if (value === undefined) delete scores[key];
      else scores[key] = value;
      return { ...f, scores };
    });
  };

  const sameScale = pool.criteria.every(
    (c) => c.min === pool.criteria[0]?.min && c.max === pool.criteria[0]?.max,
  );
  const first = pool.criteria[0];
  const { minWords, maxWords } = pool.form.comments;
  const words = countWords(form.comments, language);
  const wordsText =
    minWords !== undefined && maxWords !== undefined
      ? t("reviewWordsBetween", { count: words, min: minWords, max: maxWords })
      : minWords !== undefined
        ? t("reviewWordsMin", { count: words, min: minWords })
        : maxWords !== undefined
          ? t("reviewWordsMax", { count: words, max: maxWords })
          : t("reviewWords", { count: words });
  const wordsState =
    maxWords !== undefined && words > maxWords
      ? "over"
      : minWords !== undefined && words > 0 && words < minWords
        ? "under"
        : "";
  const commentsHelp = text(pool.form.comments.description) || t("reviewCommentsHelp");
  const noteHelp = text(pool.form.chairNote.description) || t("reviewChairNoteHelp");
  const recommendationHelp = text(pool.form.recommendation.description);

  const heading = (
    <h2 id="your-review" tabIndex={-1} ref={headingRef}>
      {t("reviewFormTitle")}
    </h2>
  );
  const status = <StatusLine said={said} />;
  const back = (
    <p>
      <Link className="block-link" to={`/${lang}/reviews`}>
        {t("reviewBackToList")}
      </Link>
    </p>
  );

  if (!editing) {
    const shown = review.status !== "not_started";
    return (
      <>
        <section className="review" aria-labelledby="your-review">
          {heading}
          {review.status === "sent" && review.sentAt ? (
            <p className="notice sent">
              {!review.open
                ? t("reviewSentClosed", { date: when(review.sentAt) })
                : review.updatedAt && Date.parse(review.updatedAt) > Date.parse(review.sentAt)
                  ? t("reviewSentChangedOn", {
                      date: when(review.sentAt),
                      changed: when(review.updatedAt),
                    })
                  : t("reviewSentOn", { date: when(review.sentAt) })}
            </p>
          ) : (
            // (No longer theirs: the line below says so, where it takes focus.)
            !gone && (
              <p className="notice">
                {t(review.status === "draft" ? "reviewDraftClosed" : "reviewNotStartedClosed")}
              </p>
            )
          )}
          {status}
          {shown && !gone && (
            <>
              <dl className="details review-scores">
                {pool.criteria.map((c) => (
                  <div key={c.key}>
                    <dt>{text(c.label)}</dt>
                    <dd>
                      {base.scores[c.key] === undefined
                        ? t("reviewNoScore")
                        : t("reviewScoreOf", { score: base.scores[c.key] ?? 0, max: c.max })}
                    </dd>
                  </div>
                ))}
                {pool.form.recommendation.enabled && (
                  <div>
                    <dt>{t("reviewRecommendation")}</dt>
                    <dd>
                      {base.recommendation
                        ? t(`recommendation_${base.recommendation}`)
                        : t("reviewNoRecommendation")}
                    </dd>
                  </div>
                )}
              </dl>
              <h3>{t("reviewComments")}</h3>
              {base.comments.trim() ? (
                <p className="prose">{base.comments}</p>
              ) : (
                <p className="meta">{t("reviewNoComments")}</p>
              )}
              {pool.form.chairNote.enabled && (
                <>
                  <h3>{t("reviewNoteHeading")}</h3>
                  {base.chairNote.trim() ? (
                    <p className="review-text">{base.chairNote}</p>
                  ) : (
                    <p className="meta">{t("reviewNoteNone")}</p>
                  )}
                </>
              )}
            </>
          )}
          {review.open && !gone && review.status === "sent" && (
            <p className="actions">
              <button type="button" className="secondary" onClick={startChanging}>
                {t("reviewChange")}
              </button>
            </p>
          )}
          {back}
        </section>
        {review.open && !gone && review.status === "sent" && (
          <p className="review-cannot meta">
            {t("reviewCannotAfterSent")}{" "}
            <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
          </p>
        )}
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save(true);
  };

  return (
    <>
      <section className="review" aria-labelledby="your-review">
        {heading}
        <p className="meta">{t("reviewFormIntro")}</p>
        {review.status === "sent" ? (
          <p className="notice">{t("reviewChanging")}</p>
        ) : (
          review.status === "draft" && <p className="meta">{t("reviewDraftNotice")}</p>
        )}
        <RestoredNotice
          shown={restored !== null && dirty}
          text={restored === "moved" ? t("reviewRestoredMoved") : undefined}
          disabled={busy}
          onDiscard={discardRestored}
        />
        <ErrorSummary
          issues={issues}
          title={t(sending ? "reviewErrors" : "reviewErrorsDraft")}
          where={labelOf}
        />
        <form className="stack wide review-form" onSubmit={submit} noValidate>
          <p className="review-lead">
            {sameScale && first
              ? t("reviewScoreLead", { min: first.min, max: first.max })
              : t("reviewScoreLeadMixed")}
          </p>
          {pool.criteria.map((c) => {
            const path = `scores.${c.key}`;
            const fid = fieldId(path);
            const description = text(c.description);
            const hints = [
              ...(description ? [`${fid}-description`] : []),
              ...(sameScale ? [] : [`${fid}-scale`]),
            ];
            const scale = scaleChoices(c);
            const invalid = issues.some((i) => i.path === path) ? (true as const) : undefined;
            return (
              <fieldset key={c.key} id={fid} tabIndex={-1} className="criterion">
                <legend>{text(c.label)}</legend>
                {description && (
                  <p className="field-hint" id={`${fid}-description`}>
                    {description}
                  </p>
                )}
                {!sameScale && (
                  <p className="field-hint" id={`${fid}-scale`}>
                    {t("reviewScale", { min: c.min, max: c.max })}
                  </p>
                )}
                {scale ? (
                  <div className="scale">
                    {scale.map((n) => (
                      <label key={n} className="scale-choice">
                        <input
                          type="radio"
                          name={fid}
                          value={n}
                          checked={form.scores[c.key] === n}
                          aria-invalid={invalid}
                          aria-describedby={describedBy(path, issues, ...hints)}
                          onChange={() => setScore(c.key, n)}
                        />
                        <span>{n}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  // A scale too wide for a row of choices: the number is typed.
                  <div className="stack wide">
                    <label htmlFor={`${fid}-typed`}>
                      {t("reviewScoreTyped", { min: c.min, max: c.max })}
                    </label>
                    <input
                      id={`${fid}-typed`}
                      type="number"
                      inputMode="numeric"
                      step={1}
                      min={c.min}
                      max={c.max}
                      value={form.scores[c.key] ?? ""}
                      aria-invalid={invalid}
                      aria-describedby={describedBy(path, issues, ...hints)}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        setScore(
                          c.key,
                          e.target.value.trim() === "" || !Number.isInteger(n) ? undefined : n,
                        );
                      }}
                    />
                  </div>
                )}
                <FieldError path={path} issues={issues} />
              </fieldset>
            );
          })}

          <div className="stack wide">
            <label htmlFor={fieldId("comments")}>{t("reviewComments")}</label>
            <p className="field-hint" id="review-comments-help">
              {commentsHelp}
            </p>
            <textarea
              id={fieldId("comments")}
              rows={7}
              value={form.comments}
              aria-invalid={issues.some((i) => i.path === "comments") ? true : undefined}
              aria-describedby={describedBy(
                "comments",
                issues,
                "review-comments-help",
                "review-comments-words",
              )}
              onChange={(e) => set("comments", e.target.value)}
            />
            <p className={`word-count ${wordsState}`} id="review-comments-words">
              {wordsText}
            </p>
            <FieldError path="comments" issues={issues} />
          </div>

          {pool.form.chairNote.enabled && (
            <div className="stack wide">
              <label htmlFor={fieldId("chairNote")}>{t("reviewChairNote")}</label>
              <p className="field-hint" id="review-note-help">
                {noteHelp}
              </p>
              <textarea
                id={fieldId("chairNote")}
                rows={3}
                value={form.chairNote}
                aria-invalid={issues.some((i) => i.path === "chairNote") ? true : undefined}
                aria-describedby={describedBy("chairNote", issues, "review-note-help")}
                onChange={(e) => set("chairNote", e.target.value)}
              />
              <FieldError path="chairNote" issues={issues} />
            </div>
          )}

          {pool.form.recommendation.enabled && (
            <fieldset id={fieldId("recommendation")} tabIndex={-1}>
              <legend>{t("reviewRecommendation")}</legend>
              {recommendationHelp && (
                <p className="field-hint" id="review-recommendation-help">
                  {recommendationHelp}
                </p>
              )}
              {RECOMMENDATIONS.map((r) => (
                <label key={r} className="choice">
                  <input
                    type="radio"
                    name="review-recommendation"
                    value={r}
                    checked={form.recommendation === r}
                    aria-invalid={
                      issues.some((i) => i.path === "recommendation") ? true : undefined
                    }
                    aria-describedby={describedBy(
                      "recommendation",
                      issues,
                      ...(recommendationHelp ? ["review-recommendation-help"] : []),
                    )}
                    onChange={() => set("recommendation", r)}
                  />
                  <span>{t(`recommendation_${r}`)}</span>
                </label>
              ))}
              <FieldError path="recommendation" issues={issues} />
            </fieldset>
          )}

          <p className="actions review-actions">
            {/* aria-disabled while a request is on its way, so focus stays on the button. */}
            <button type="submit" aria-disabled={busy ? "true" : undefined}>
              {t("reviewSend")}
            </button>
            {review.status === "sent" ? (
              <button
                type="button"
                className="secondary"
                aria-disabled={busy ? "true" : undefined}
                onClick={keepSent}
              >
                {t("reviewKeepSent")}
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                aria-disabled={busy ? "true" : undefined}
                onClick={() => save(false)}
              >
                {t("reviewSaveDraft")}
              </button>
            )}
          </p>
          {/* Under the buttons, where the eye is: what pressing one of them did. */}
          {status}
        </form>
        {back}
      </section>
      {review.canDecline && (
        <p className="review-cannot">
          <Link className="block-link" to={`/${lang}/s/${id}/cannot-review`}>
            {t("reviewCannot")}
          </Link>
        </p>
      )}
    </>
  );
}
