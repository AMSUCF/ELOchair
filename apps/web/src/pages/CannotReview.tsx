import { DECLINE_REASONS, type DeclineReason, LIMITS } from "@elochair/schema/pure";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type Issue, type Me, type OwnReview } from "../api";
import { describedBy, ErrorSummary, FieldError, fieldId } from "../forms";
import { useT } from "../i18n";
import { nobodySignedIn, SignInHere } from "../signIn";
import { PageHeading } from "../ui";
import { browserStore, clearUnsaved } from "../unsaved";
import { reviewScope } from "../unsavedReview";
import type { LeftList } from "./MyReviews";

/*
 * "I cannot review this proposal" (spec 03, §1.3 and §1.4): a reviewer gives the proposal back,
 * with a reason and, if they like, a note for the chairs. The page says what that does before
 * it is done: the chairs see it, the proposal leaves the reviewer's list, and they can no
 * longer open it. It is offered until their review is sent, while the conference is in review.
 */

type Loaded =
  | { state: "loading" }
  /** Nobody is signed in: the page has the sign-in form on it, whatever the address names. */
  | { state: "signed-out" }
  | { state: "missing" }
  | {
      state: "ready";
      title: string;
      personId: string | null;
      draft: boolean;
      offered: boolean;
      /** They read the proposal as a chair: given back, it stays theirs to open (no conflict). */
      chair: boolean;
    };

export function CannotReviewPage() {
  const { id = "" } = useParams();
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [note, setNote] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    Promise.all([
      api<{ title: string; view: string }>(`/api/submissions/${id}`),
      api<OwnReview>(`/api/submissions/${id}/review`),
      api<Me>("/api/me"),
    ]).then(([s, r, m]) => {
      if (!live) return;
      // Decided by who is signed in, before anything that was answered about the proposal:
      // someone who is not signed in is shown the same for every address.
      if (nobodySignedIn(m)) return setLoaded({ state: "signed-out" });
      // Only for the proposal's reviewer, which the server decides (their own review is there
      // to read): anyone else is told what a stranger is told. A chair who also reviews reads
      // the proposal as a chair, and is its reviewer all the same.
      if (!s.ok || !r.ok) return setLoaded({ state: "missing" });
      setLoaded({
        state: "ready",
        title: s.data.title,
        personId: m.ok && m.data.kind === "person" ? (m.data.person?.id ?? null) : null,
        draft: r.data.status === "draft",
        offered: r.data.canDecline,
        chair: s.data.view === "chair",
      });
    });
    return () => {
      live = false;
    };
  }, [id]);

  if (loaded.state === "loading") return <p role="status">{t("loading")}</p>;
  if (loaded.state === "signed-out") {
    return <SignInHere title={t("cannotTitle")} why={t("cannotNeedSignIn")} />;
  }
  if (loaded.state === "missing") {
    return (
      <>
        <PageHeading>{t("cannotTitle")}</PageHeading>
        <p>{t("cannotGone")}</p>
        <p>
          <Link className="block-link" to={`/${lang}/reviews`}>
            {t("reviewBackToList")}
          </Link>
        </p>
      </>
    );
  }
  const { title, personId, draft, offered, chair } = loaded;
  const back = `/${lang}/s/${id}`;

  const say = (text: string) => {
    setMessage(text);
    statusRef.current?.focus();
  };

  async function tell(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setMessage("");
    if (reason === null) return setIssues([{ path: "reason", code: "choose_reason" }]);
    setIssues([]);
    inFlight.current = true;
    setBusy(true);
    const res = await api(`/api/submissions/${id}/review/decline`, {
      method: "POST",
      body: { reason, ...(note.trim() ? { note: note.trim() } : {}) },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok || res.status === 404) {
      // Theirs no longer, now or already: what they left unsaved for it in this browser goes.
      if (personId) clearUnsaved(browserStore(), personId, reviewScope(id));
    }
    if (res.ok) {
      const state: LeftList = { left: title };
      return navigate(`/${lang}/reviews`, { state });
    }
    if (res.status === 404) return setLoaded({ state: "missing" });
    if (res.status === 409) return say(t("cannotNotOffered"));
    say(t(res.status === 429 ? "signInRateLimited" : "reviewUnconfirmed"));
  }

  return (
    <>
      <PageHeading>{t("cannotTitle")}</PageHeading>
      <p className="meta">{title || t("editUntitled")}</p>
      {!offered ? (
        <p className="notice">{t("cannotNotOffered")}</p>
      ) : (
        <>
          <p>{t(chair ? "cannotDoesChair" : "cannotDoes")}</p>
          {draft && <p>{t("cannotDraftGoes")}</p>}
          <ErrorSummary issues={issues} title={t("cannotErrors")} />
          <form className="stack wide" onSubmit={tell} noValidate>
            <fieldset id={fieldId("reason")} tabIndex={-1}>
              <legend>{t("cannotWhy")}</legend>
              {DECLINE_REASONS.map((r) => (
                <label key={r} className="choice">
                  <input
                    type="radio"
                    name="cannot-reason"
                    value={r}
                    checked={reason === r}
                    aria-invalid={issues.length > 0 ? true : undefined}
                    aria-describedby={describedBy("reason", issues, "cannot-conflict-note")}
                    onChange={() => {
                      setReason(r);
                      setIssues([]);
                    }}
                  />
                  <span>{t(`cannotReason_${r}`)}</span>
                </label>
              ))}
              <p className="field-hint" id="cannot-conflict-note">
                {t("cannotConflictNote")}
              </p>
              <FieldError path="reason" issues={issues} />
            </fieldset>
            <div className="stack wide">
              <label htmlFor="cannot-note">{t("cannotNote")}</label>
              <textarea
                id="cannot-note"
                rows={3}
                maxLength={LIMITS.declineNote}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <p className="actions review-actions">
              {/* aria-disabled while the request is on its way, so focus stays on the button. */}
              <button type="submit" aria-disabled={busy ? "true" : undefined}>
                {t("cannotTell")}
              </button>
              <Link className="button secondary" to={back}>
                {t("cannotCancel")}
              </Link>
            </p>
          </form>
        </>
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
      {!offered && (
        <p>
          <Link className="block-link" to={back}>
            {t("cannotCancel")}
          </Link>
        </p>
      )}
    </>
  );
}
