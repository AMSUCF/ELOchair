import { LIMITS, localize, ROLE_INVITATIONS } from "@elochair/schema/pure";
import { type RefObject, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type RoleInvitation } from "../api";
import { formatDateTime, viewerTimeZone } from "../format";
import { cleanName, nameRefusal } from "../forms";
import { LANG_NAMES, LANGS, type Lang, type MessageKey, useT } from "../i18n";
import { FocusPending, PageHeading } from "../ui";

type Answered = { answer: "accepted" | "declined"; info: RoleInvitation };

type State =
  | { step: "loading" }
  | { step: "ready"; info: RoleInvitation }
  /** No token, or a link that no longer works: expired, answered or cancelled, all said alike. */
  | { step: "invalid" }
  /** The server could not be reached or failed; the token is kept, so "Try again" works. */
  | { step: "network" }
  | { step: "rate-limited" }
  | ({ step: "done" } & Answered);

/** What the status line says in each state but "ready" and "done". */
const STATUS = {
  loading: "loading",
  invalid: "roleInvInvalid",
  network: "verifyNetwork",
  "rate-limited": "signInRateLimited",
} as const satisfies Record<Exclude<State["step"], "ready" | "done">, MessageKey>;

type Problems = { name?: "required" | "invalid"; languages?: boolean; load?: boolean };

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

/**
 * The page an invitation to a role links to (spec 03, §1.2). It needs no account. It says which
 * conference, which role and what accepting means, and offers "Accept" and "Decline". Accepting
 * gives the role to the address the invitation was sent to, whoever opened the link, and signs
 * nobody in: the page then offers sign-in with that address.
 */
export function RoleInvitationPage() {
  const { lang, t } = useT();
  const [token] = useState(takeToken);
  const [state, setState] = useState<State>({ step: "loading" });
  const [name, setName] = useState("");
  const [languages, setLanguages] = useState<Set<Lang>>(new Set());
  const [load, setLoad] = useState(String(ROLE_INVITATIONS.defaultLoad));
  const [problems, setProblems] = useState<Problems>({});
  /** Feedback on the last answer while the form is shown. */
  const [note, setNote] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  /** Repeat taps while an answer is on its way do nothing (the buttons stay focusable). */
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const languagesRef = useRef<HTMLFieldSetElement>(null);
  const loadRef = useRef<HTMLInputElement>(null);
  /** One status line in every state, so what happens is announced and can take focus. */
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusPending = useContext(FocusPending);
  /** Only the latest load, on a page that is still shown, may act on its answer. */
  const live = useRef({ mounted: false, generation: 0 });
  useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
    };
  }, []);

  const read = useCallback(
    async (retry = false) => {
      if (!token) {
        setState({ step: "invalid" });
        return;
      }
      const generation = ++live.current.generation;
      setState({ step: "loading" });
      // "Try again" goes away while loading: focus stays with the line that says what happens.
      if (retry) statusRef.current?.focus();
      const r = await api<RoleInvitation>("/api/role-invitations/info", {
        method: "POST",
        body: { token },
      });
      if (!live.current.mounted || generation !== live.current.generation) return;
      // After a retry the invitation arrives as new content: its heading takes focus.
      if (r.ok && retry && focusPending) focusPending.current = true;
      setState(r.ok ? { step: "ready", info: r.data } : failure(r.status));
    },
    [token, focusPending],
  );

  useEffect(() => {
    read();
  }, [read]);

  /** The form goes away: the status line says what happened and takes focus. */
  function settle(next: State) {
    setState(next);
    statusRef.current?.focus();
  }

  /** Show what is missing at each field, say the first of it, and put focus there. */
  function refuse(next: Problems) {
    setProblems(next);
    if (next.name) {
      setNote(next.name === "required" ? "roleInvNameRequired" : "invNameInvalid");
      nameRef.current?.focus();
    } else if (next.languages) {
      setNote("roleInvLanguagesRequired");
      languagesRef.current?.querySelector("input")?.focus();
    } else if (next.load) {
      setNote("roleInvLoadInvalid");
      loadRef.current?.focus();
    }
  }

  async function answer(info: RoleInvitation, a: "accept" | "decline") {
    if (inFlight.current || !token) return;
    const accept = a === "accept";
    const reviewer = info.role === "reviewer";
    const displayName = cleanName(name);
    const maxLoad = /^\d+$/.test(load.trim()) ? Number(load.trim()) : Number.NaN;
    if (accept) {
      const missing: Problems = {};
      if (info.nameNeeded && !displayName) missing.name = "required";
      if (reviewer && languages.size === 0) missing.languages = true;
      if (
        reviewer &&
        !(maxLoad >= ROLE_INVITATIONS.minLoad && maxLoad <= ROLE_INVITATIONS.maxLoad)
      ) {
        missing.load = true;
      }
      if (missing.name || missing.languages || missing.load) return refuse(missing);
    }
    inFlight.current = true;
    setBusy(true);
    setNote(null);
    setProblems({});
    const res = await api<{ answer: "accepted" | "declined" }>("/api/role-invitations/answer", {
      method: "POST",
      body: {
        token,
        answer: a,
        ...(accept && info.nameNeeded && displayName ? { displayName } : {}),
        ...(accept && reviewer
          ? { languages: LANGS.filter((l) => languages.has(l)), maxLoad }
          : {}),
      },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok) return settle({ step: "done", answer: res.data.answer, info });
    // Only these mean the link is dead. Anything else keeps the form, and the token with it.
    if (res.error === "invalid_or_expired" || res.issues.some((i) => i.path === "token")) {
      return settle({ step: "invalid" });
    }
    const at = (path: string) => res.issues.some((i) => i.path === path);
    const nameProblem = nameRefusal(res.issues);
    if (nameProblem || at("languages") || at("maxLoad")) {
      return refuse({
        ...(nameProblem ? { name: nameProblem } : {}),
        ...(at("languages") ? { languages: true } : {}),
        ...(at("maxLoad") ? { load: true } : {}),
      });
    }
    if (res.status === 429) setNote("signInRateLimited");
    // The link still works: say what happened and let them tap again.
    else setNote(res.status === 0 ? "verifyNetwork" : "errorGeneric");
  }

  const said = (done: Answered) => {
    const conference = localize(done.info.conference.title, lang);
    return done.answer === "declined"
      ? t("roleInvDeclined")
      : t(`roleInvAccepted_${done.info.role}`, { email: done.info.email, conference });
  };
  const status =
    state.step === "ready"
      ? note
        ? t(note, {
            max: LIMITS.name,
            min: ROLE_INVITATIONS.minLoad,
            ...(note === "roleInvLoadInvalid" ? { max: ROLE_INVITATIONS.maxLoad } : {}),
          })
        : ""
      : state.step === "done"
        ? said(state)
        : t(STATUS[state.step]);

  return (
    <>
      <PageHeading>{t("roleInvTitle")}</PageHeading>
      {state.step === "ready" && (
        <Answer
          info={state.info}
          name={name}
          onName={(v) => {
            setName(v);
            setProblems((was) => ({ ...was, name: undefined }));
          }}
          nameRef={nameRef}
          languages={languages}
          onLanguages={(next) => {
            setLanguages(next);
            setProblems((was) => ({ ...was, languages: undefined }));
          }}
          languagesRef={languagesRef}
          load={load}
          onLoad={(v) => {
            setLoad(v);
            setProblems((was) => ({ ...was, load: undefined }));
          }}
          loadRef={loadRef}
          problems={problems}
          busy={busy}
          onAnswer={(a) => answer(state.info, a)}
        />
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {status}
      </p>
      {(state.step === "network" || state.step === "rate-limited") && (
        <p>
          <button type="button" onClick={() => read(true)}>
            {t("verifyRetry")}
          </button>
        </p>
      )}
      {state.step === "done" && state.answer === "accepted" && (
        <p>
          {/* The address goes along, so that the sign-in page starts with it filled in. */}
          <Link className="button" to={`/${lang}/sign-in`} state={{ email: state.info.email }}>
            {t("roleInvSignIn", { email: state.info.email })}
          </Link>
        </p>
      )}
    </>
  );
}

function Answer({
  info,
  name,
  onName,
  nameRef,
  languages,
  onLanguages,
  languagesRef,
  load,
  onLoad,
  loadRef,
  problems,
  busy,
  onAnswer,
}: {
  info: RoleInvitation;
  name: string;
  onName: (v: string) => void;
  nameRef: RefObject<HTMLInputElement | null>;
  languages: Set<Lang>;
  onLanguages: (next: Set<Lang>) => void;
  languagesRef: RefObject<HTMLFieldSetElement | null>;
  load: string;
  onLoad: (v: string) => void;
  loadRef: RefObject<HTMLInputElement | null>;
  problems: Problems;
  busy: boolean;
  onAnswer: (a: "accept" | "decline") => void;
}) {
  const { lang, t } = useT();
  const reviewer = info.role === "reviewer";
  const conference = localize(info.conference.title, lang);
  const range = { min: ROLE_INVITATIONS.minLoad, max: ROLE_INVITATIONS.maxLoad };
  // aria-disabled rather than disabled while an answer is on its way, so focus stays put.
  const busyAttr = busy ? ("true" as const) : undefined;
  const ids = (...list: (string | false | undefined)[]) => list.filter(Boolean).join(" ");
  return (
    <>
      <p>{t(`roleInvIntro_${info.role}`, { conference })}</p>
      <dl className="details invited-to">
        <div>
          <dt>{t("roleInvConference")}</dt>
          <dd>{conference}</dd>
        </div>
        <div>
          <dt>{t("roleInvRole")}</dt>
          <dd>{t(`peopleInviteRole_${info.role}`)}</dd>
        </div>
        {reviewer && (
          <div>
            <dt>{t("roleInvCommittees")}</dt>
            <dd>{info.pools.map((p) => localize(p.name, lang)).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>{t("roleInvFor")}</dt>
          <dd>{info.email}</dd>
        </div>
      </dl>
      <p id="role-inv-means">{t(`roleInvMeans_${info.role}`)}</p>
      <p className="notice">{t("roleInvBound", { email: info.email })}</p>
      <p className="meta">
        {t("roleInvExpires", { date: formatDateTime(info.expiresAt, lang, viewerTimeZone()) })}
      </p>
      <div className="stack wide">
        {/* In the order the page asks: what is missing takes focus from the top down. */}
        {info.nameNeeded && (
          <>
            <label htmlFor="role-inv-name">{t("roleInvYourName")} *</label>
            <p className="setting-hint" id="role-inv-name-hint">
              {t("roleInvNameHelp")}
            </p>
            {/* Starts empty: the name the chair typed is never shown here or put in a profile. */}
            <input
              id="role-inv-name"
              ref={nameRef}
              value={name}
              onChange={(e) => onName(e.target.value)}
              autoComplete="name"
              maxLength={LIMITS.name}
              aria-required="true"
              aria-invalid={problems.name ? true : undefined}
              aria-describedby={ids("role-inv-name-hint", problems.name && "role-inv-name-error")}
            />
            {problems.name && (
              <p className="field-error" id="role-inv-name-error">
                {problems.name === "invalid"
                  ? t("invNameInvalid", { max: LIMITS.name })
                  : t("roleInvNameRequired")}
              </p>
            )}
          </>
        )}
        {reviewer && (
          <>
            <fieldset
              ref={languagesRef}
              aria-describedby={ids(
                "role-inv-languages-hint",
                problems.languages && "role-inv-languages-error",
              )}
            >
              <legend>{t("roleInvLanguages")} *</legend>
              <p className="setting-hint" id="role-inv-languages-hint">
                {t("roleInvLanguagesHint")}
              </p>
              {LANGS.map((l) => (
                <label key={l} className="choice">
                  <input
                    type="checkbox"
                    checked={languages.has(l)}
                    onChange={(e) => {
                      const next = new Set(languages);
                      if (e.target.checked) next.add(l);
                      else next.delete(l);
                      onLanguages(next);
                    }}
                  />
                  <span lang={l}>{LANG_NAMES[l]}</span>
                </label>
              ))}
              {problems.languages && (
                <p className="field-error" id="role-inv-languages-error">
                  {t("roleInvLanguagesRequired")}
                </p>
              )}
            </fieldset>
            <label htmlFor="role-inv-load">{t("roleInvLoad")} *</label>
            <p className="setting-hint" id="role-inv-load-hint">
              {t("roleInvLoadHint", range)}
            </p>
            <input
              id="role-inv-load"
              ref={loadRef}
              type="number"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              step={1}
              value={load}
              onChange={(e) => onLoad(e.target.value)}
              aria-required="true"
              aria-invalid={problems.load ? true : undefined}
              aria-describedby={ids("role-inv-load-hint", problems.load && "role-inv-load-error")}
            />
            {problems.load && (
              <p className="field-error" id="role-inv-load-error">
                {t("roleInvLoadInvalid", range)}
              </p>
            )}
          </>
        )}
        <button
          type="button"
          aria-describedby="role-inv-means"
          aria-disabled={busyAttr}
          onClick={() => onAnswer("accept")}
        >
          {t("roleInvAccept")}
        </button>
        <button
          type="button"
          className="secondary"
          aria-describedby="role-inv-decline-note"
          aria-disabled={busyAttr}
          onClick={() => onAnswer("decline")}
        >
          {t("roleInvDecline")}
        </button>
        <p className="meta" id="role-inv-decline-note">
          {t("roleInvDeclineNote")}
        </p>
      </div>
    </>
  );
}
