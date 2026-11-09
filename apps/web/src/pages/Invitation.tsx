import type { Agreement, LocalizedText } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Role } from "../api";
import { useT } from "../i18n";
import { roleKey } from "../labels";
import { Localized, PageHeading } from "../ui";

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

/** Read the token once, then remove it from the address bar and history. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/** What a failed request means for the link: dead, or worth another try. */
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
  const [nameMissing, setNameMissing] = useState(false);
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!token) {
      setState({ step: "invalid" });
      return;
    }
    setState({ step: "loading" });
    const r = await api<Info>("/api/invitations/info", { method: "POST", body: { token } });
    setState(r.ok ? { step: "ready", info: r.data } : failure(r.status));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function answer(info: Info, a: "confirm" | "decline") {
    if (busy || !token) return;
    const confirm = a === "confirm";
    if (confirm && info.nameNeeded === true && !name.trim()) {
      setNameMissing(true);
      setMessage(t("invNameRequired"));
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
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
        ...(confirm && info.nameNeeded !== false && name.trim()
          ? { displayName: name.trim() }
          : {}),
      },
    });
    setBusy(false);
    if (res.ok) setState({ step: "done", answer: res.data.answer });
    else if (res.status === 400 || res.error === "already_answered") setState({ step: "invalid" });
    else if (res.error === "call_closed") {
      setMessage(t("invClosed"));
      setState({
        step: "ready",
        info: { ...info, conference: { ...info.conference, callOpen: false } },
      });
    } else if (res.issues.some((i) => i.path === "displayName")) {
      setNameMissing(true);
      setMessage(t("invNameRequired"));
      nameRef.current?.focus();
    } else if (res.issues.length) setMessage(t("issue_agreements_required"));
    else if (res.status === 429) setMessage(t("signInRateLimited"));
    // The link still works: say what happened and let them tap again.
    else setMessage(res.status === 0 ? t("verifyNetwork") : t("errorGeneric"));
  }

  return (
    <>
      <PageHeading>{t("invTitle")}</PageHeading>
      {state.step === "loading" && <p role="status">{t("loading")}</p>}
      {state.step === "invalid" && <p role="alert">{t("invInvalid")}</p>}
      {(state.step === "network" || state.step === "rate-limited") && (
        <div className="stack">
          <p role="alert">
            {state.step === "network" ? t("verifyNetwork") : t("signInRateLimited")}
          </p>
          <button type="button" onClick={load}>
            {t("verifyRetry")}
          </button>
        </div>
      )}
      {state.step === "done" && (
        <>
          <p role="status">{state.answer === "confirmed" ? t("invConfirmed") : t("invDeclined")}</p>
          {state.answer === "confirmed" && (
            <p>
              <Link className="button" to={`/${lang}/sign-in`}>
                {t("navSignIn")}
              </Link>
            </p>
          )}
        </>
      )}
      {state.step === "ready" && (
        <Answer
          info={state.info}
          name={name}
          nameMissing={nameMissing}
          nameRef={nameRef}
          onName={(v) => {
            setName(v);
            setNameMissing(false);
          }}
          agreed={agreed}
          onAgreed={setAgreed}
          busy={busy}
          message={message}
          onAnswer={(a) => answer(state.info, a)}
        />
      )}
    </>
  );
}

function Answer({
  info,
  name,
  nameMissing,
  nameRef,
  onName,
  agreed,
  onAgreed,
  busy,
  message,
  onAnswer,
}: {
  info: Info;
  name: string;
  nameMissing: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  onName: (v: string) => void;
  agreed: Set<string>;
  onAgreed: (update: (prev: Set<string>) => Set<string>) => void;
  busy: boolean;
  message: string;
  onAnswer: (a: "confirm" | "decline") => void;
}) {
  const { lang, t } = useT();
  const cap = info.presenterCap;
  const allAgreed = info.agreements.every((a) => agreed.has(a.key));
  // Asked only while the person has no name of their own; required then (older servers: optional).
  const askName = info.nameNeeded !== false;
  const nameRequired = info.nameNeeded === true;
  const nameHelp = ["inv-name-help", nameMissing ? "inv-name-error" : ""].filter(Boolean).join(" ");
  const withdrawn = info.status === "withdrawn";
  // Declining is always possible; confirming needs an open call and work that is not withdrawn.
  const canConfirm = info.conference.callOpen && !withdrawn;
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
                  aria-required={nameRequired || undefined}
                  aria-invalid={nameMissing || undefined}
                  aria-describedby={nameHelp}
                />
                {nameMissing && (
                  <p className="field-error" id="inv-name-error">
                    {t("invNameRequired")}
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
            <button type="button" disabled={busy || !allAgreed} onClick={() => onAnswer("confirm")}>
              {t("editConfirm")}
            </button>
          </>
        )}
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => onAnswer("decline")}
        >
          {t("editDecline")}
        </button>
        <p className="status-line" role="status">
          {message}
        </p>
      </div>
    </>
  );
}
