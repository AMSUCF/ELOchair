import type { Agreement, LocalizedText } from "@elochair/schema";
import { LIMITS, localize } from "@elochair/schema/pure";
import { type RefObject, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Role } from "../api";
import { cleanName, nameRefusal } from "../forms";
import { type MessageKey, useT } from "../i18n";
import { roleKey } from "../labels";
import { FocusPending, Localized, PageHeading } from "../ui";

type Info = {
  submissionId: string;
  conference: {
    slug: string;
    title: LocalizedText;
    timezone: string;
    submissionsClose: string;
    callOpen: boolean;
  };
  format: string;
  title: string;
  ownerName: string | null;
  role: Role;
  /** The name as the owner typed it: context for the invitee, never their name. */
  invitedName: string | null;
  /** The invitee's profile has no name: confirming needs one (absent from older servers). */
  nameNeeded?: boolean;
  /** The submission's status: withdrawn work can only be declined. */
  status?: string;
  presenterCap: { max: number; roleCounts: boolean; countIfConfirmed: number | null } | null;
  agreements: Agreement[];
};

type State =
  | { step: "loading" }
  | { step: "ready"; info: Info }
  /** No token, expired, or already answered. */
  | { step: "invalid" }
  /** The server could not be reached or failed; the token is kept, so "Try again" works. */
  | { step: "network" }
  | { step: "rate-limited" }
  | { step: "done"; answer: "confirmed" | "declined" };

/** What the status line says in each state but "ready" (where it reports on the last answer). */
const STATUS = {
  loading: "loading",
  invalid: "invInvalid",
  network: "verifyNetwork",
  "rate-limited": "signInRateLimited",
} as const satisfies Record<Exclude<State["step"], "ready" | "done">, MessageKey>;

/** The name field's problem: missing, or refused by the server as written. */
type NameError = "required" | "invalid" | null;

/** Read the token once, then remove it from the address bar and history. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/** What a failed /info request means for the link: dead, or worth another try. */
const failure = (status: number): State =>
  status === 429
    ? { step: "rate-limited" }
    : status === 0 || status >= 500
      ? { step: "network" }
      : { step: "invalid" };

/** The page an invitation email links to. Declining needs no account; confirming needs consent. */
export function InvitationPage() {
  const { lang, t } = useT();
  const [token] = useState(takeToken);
  const [state, setState] = useState<State>({ step: "loading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<NameError>(null);
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  /** Feedback on the last answer while the form is shown. */
  const [note, setNote] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  /** Repeat taps while an answer is on its way do nothing (the buttons stay focusable). */
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  /** One status line in every state, so what happens is announced and can take focus. */
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusPending = useContext(FocusPending);
  /**
   * Only the latest load, on a page that is still shown, may act on its answer: a slow retry that
   * lands after the person moved on must not move focus on the page they are on now.
   */
  const live = useRef({ mounted: false, generation: 0 });
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
    };
  }, []);

  const load = useCallback(
    async (retry = false) => {
      if (!token) {
        setState({ step: "invalid" });
        return;
      }
      const generation = ++live.current.generation;
      setState({ step: "loading" });
      // "Try again" goes away while loading: focus stays with the line that says what happens.
      if (retry) statusRef.current?.focus();
      const r = await api<Info>("/api/invitations/info", { method: "POST", body: { token } });
      if (!live.current.mounted || generation !== live.current.generation) return;
      // After a retry the invitation arrives as new content: its heading takes focus.
      if (r.ok && retry && focusPending) focusPending.current = true;
      setState(r.ok ? { step: "ready", info: r.data } : failure(r.status));
    },
    [token, focusPending],
  );

  useEffect(() => {
    load();
  }, [load]);

  /** The form goes away: the status line says what happened and takes focus. */
  function settle(next: State) {
    setState(next);
    statusRef.current?.focus();
  }

  function refuseName(problem: Exclude<NameError, null>) {
    setNameError(problem);
    setNote(problem === "required" ? "invNameRequired" : "invNameInvalid");
    nameRef.current?.focus();
  }

  async function answer(info: Info, a: "confirm" | "decline") {
    if (inFlight.current || !token) return;
    const confirm = a === "confirm";
    const displayName = cleanName(name);
    if (confirm && info.nameNeeded === true && !displayName) return refuseName("required");
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    const res = await api<{ answer: "confirmed" | "declined" }>("/api/invitations/answer", {
      method: "POST",
      body: {
        token,
        answer: a,
        acceptedAgreements: confirm
          ? info.agreements
              .filter((x) => agreed.has(x.key))
              .map((x) => ({ key: x.key, version: x.version }))
          : [],
        ...(confirm && info.nameNeeded !== false && displayName ? { displayName } : {}),
      },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok) return settle({ step: "done", answer: res.data.answer });
    // Only these mean the link is dead. Anything else keeps the form, and the token with it.
    if (
      res.error === "invalid_or_expired" ||
      res.error === "already_answered" ||
      res.issues.some((i) => i.path === "token")
    ) {
      return settle({ step: "invalid" });
    }
    const nameProblem = nameRefusal(res.issues);
    if (res.error === "call_closed") {
      setNote("invClosed");
      // Confirm goes away; Decline stays.
      settle({
        step: "ready",
        info: { ...info, conference: { ...info.conference, callOpen: false } },
      });
    } else if (nameProblem) refuseName(nameProblem);
    else if (res.issues.length) setNote("issue_agreements_required");
    else if (res.status === 429) setNote("signInRateLimited");
    // The link still works: say what happened and let them tap again.
    else setNote(res.status === 0 ? "verifyNetwork" : "errorGeneric");
  }

  const status =
    state.step === "ready"
      ? note
        ? t(note, { max: LIMITS.name })
        : ""
      : state.step === "done"
        ? t(state.answer === "confirmed" ? "invConfirmed" : "invDeclined")
        : t(STATUS[state.step]);

  return (
    <>
      <PageHeading>{t("invTitle")}</PageHeading>
      {state.step === "ready" && (
        <Answer
          info={state.info}
          name={name}
          nameError={nameError}
          nameRef={nameRef}
          onName={(v) => {
            setName(v);
            setNameError(null);
          }}
          agreed={agreed}
          onAgreed={setAgreed}
          busy={busy}
          onAnswer={(a) => answer(state.info, a)}
        />
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {status}
      </p>
      {(state.step === "network" || state.step === "rate-limited") && (
        <p>
          <button type="button" onClick={() => load(true)}>
            {t("verifyRetry")}
          </button>
        </p>
      )}
      {state.step === "done" && state.answer === "confirmed" && (
        <p>
          <Link className="button" to={`/${lang}/sign-in`}>
            {t("navSignIn")}
          </Link>
        </p>
      )}
    </>
  );
}

function Answer({
  info,
  name,
  nameError,
  nameRef,
  onName,
  agreed,
  onAgreed,
  busy,
  onAnswer,
}: {
  info: Info;
  name: string;
  nameError: NameError;
  nameRef: RefObject<HTMLInputElement | null>;
  onName: (v: string) => void;
  agreed: Set<string>;
  onAgreed: (update: (prev: Set<string>) => Set<string>) => void;
  busy: boolean;
  onAnswer: (a: "confirm" | "decline") => void;
}) {
  const { lang, t } = useT();
  const cap = info.presenterCap;
  const allAgreed = info.agreements.every((a) => agreed.has(a.key));
  // Asked only while the person has no name of their own; required then (older servers: optional).
  const askName = info.nameNeeded !== false;
  const nameRequired = info.nameNeeded === true;
  const nameHelp = ["inv-name-help", nameError ? "inv-name-error" : ""].filter(Boolean).join(" ");
  const withdrawn = info.status === "withdrawn";
  // Declining is always possible; confirming needs an open call and work that is not withdrawn.
  const canConfirm = info.conference.callOpen && !withdrawn;
  // aria-disabled rather than disabled while an answer is on its way, so focus stays put.
  const busyAttr = busy ? ("true" as const) : undefined;
  return (
    <>
      <p>
        {t("invIntro", {
          owner: info.ownerName ?? "—",
          role: t(roleKey(info.role)),
          conference: localize(info.conference.title, lang),
        })}
      </p>
      <dl className="details">
        <div>
          <dt>{t("invFormat")}</dt>
          <dd>{info.format}</dd>
        </div>
        <div>
          <dt>{t("invProposal")}</dt>
          <dd>{info.title || t("editUntitled")}</dd>
        </div>
      </dl>
      {cap && (
        <p className="meta">
          {cap.roleCounts && cap.countIfConfirmed !== null
            ? t("invCapCounts", { max: cap.max, count: cap.countIfConfirmed })
            : t("invCapNot")}
        </p>
      )}
      {withdrawn ? (
        <p className="notice">{t("invWithdrawn")}</p>
      ) : (
        !info.conference.callOpen && <p className="notice">{t("invClosed")}</p>
      )}
      <div className="stack wide">
        {canConfirm && (
          <>
            {askName && (
              <>
                <label htmlFor="inv-name">
                  {nameRequired ? `${t("invYourName")} *` : t("invYourName")}
                </label>
                <div id="inv-name-help">
                  <p className="meta">{t("invNameHelp")}</p>
                  {info.invitedName && (
                    <p className="meta">{t("invNameOwnerTyped", { name: info.invitedName })}</p>
                  )}
                </div>
                {/* Starts empty: the owner's typing is never written into the invitee's profile. */}
                <input
                  id="inv-name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => onName(e.target.value)}
                  autoComplete="name"
                  maxLength={LIMITS.name}
                  aria-required={nameRequired || undefined}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameHelp}
                />
                {nameError && (
                  <p className="field-error" id="inv-name-error">
                    {nameError === "invalid"
                      ? t("invNameInvalid", { max: LIMITS.name })
                      : t("invNameRequired")}
                  </p>
                )}
              </>
            )}
            {info.agreements.length > 0 && (
              <fieldset>
                <legend>{t("editAgreements")}</legend>
                {info.agreements.map((a) => (
                  <div key={a.key} className="agreement">
                    <label className="choice">
                      <input
                        type="checkbox"
                        checked={agreed.has(a.key)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onAgreed((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(a.key);
                            else next.delete(a.key);
                            return next;
                          });
                        }}
                      />
                      <span>{t("editAgree", { title: localize(a.title, lang) })}</span>
                    </label>
                    {a.text && (
                      <p className="meta">
                        <Localized text={a.text} />
                      </p>
                    )}
                    {a.url && (
                      <a className="block-link" href={a.url} target="_blank" rel="noreferrer">
                        {t("editRead")}
                      </a>
                    )}
                  </div>
                ))}
              </fieldset>
            )}
            <button
              type="button"
              disabled={!allAgreed}
              aria-disabled={busyAttr}
              onClick={() => onAnswer("confirm")}
            >
              {t("editConfirm")}
            </button>
          </>
        )}
        <button
          type="button"
          className="secondary"
          aria-disabled={busyAttr}
          onClick={() => onAnswer("decline")}
        >
          {t("editDecline")}
        </button>
      </div>
    </>
  );
}
