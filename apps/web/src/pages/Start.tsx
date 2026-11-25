import type { ConferenceConfig, SubmissionType } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { api, type ConferenceDetail, type Me, type MySubmission, type Role } from "../api";
import { hasMinimum } from "../format";
import { startingFormat } from "../formats";
import { ErrorSummary } from "../forms";
import { LANG_NAMES, useT } from "../i18n";
import { modeKey, roleKey } from "../labels";
import { nobodySignedIn, SignInForm, useHere } from "../signIn";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

const ROLES: Role[] = ["lead", "presenter", "coauthor", "panelist", "moderator"];
const MODES = ["in_person", "online", "undecided"] as const;

export function StartPage() {
  const { slug } = useParams();
  const { t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const me = useApi<Me>("/api/me");
  const here = useHere();
  const [params] = useSearchParams();

  if (!conf || !me) return <p role="status">{t("loading")}</p>;
  if (!conf.ok) {
    return <PageHeading>{t("confNotFound")}</PageHeading>;
  }
  const c = conf.data.config;
  // The server's clock decides; a phone with a wrong clock must not hide or show the form.
  const open = conf.data.callOpen;
  // The format "Start this proposal" named, if the call takes it here: said while the person
  // signs in, so that they see their choice was kept. The form begins with it afterwards.
  const chosen = c.submissionTypes.find((type) => type.key === params.get("format"));
  return (
    <>
      <PageHeading title={t("startTitle")}>{t("startTitle")}</PageHeading>
      <p className="meta">
        <Localized text={c.title} fallback={c.defaultLanguage} />
      </p>
      {!open ? (
        <p role="alert">{t("startClosed")}</p>
      ) : nobodySignedIn(me) ? (
        <>
          {chosen && (
            <p className="meta">
              {t("startFormatChosen")} <Localized text={chosen.name} fallback={c.defaultLanguage} />
            </p>
          )}
          <p>{t("startSignInFirst")}</p>
          {/* The link in the email leads back here, with the format still in the address. */}
          <SignInForm next={here} />
        </>
      ) : !me.ok || me.data.kind !== "person" ? (
        // Who is signed in did not arrive: that does not say that nobody is.
        <p role="alert">{t(!me.ok && me.status === 0 ? "verifyNetwork" : "errorGeneric")}</p>
      ) : (
        <StartForm config={c} slug={slug ?? ""} />
      )}
    </>
  );
}

function StartForm({ config: c, slug }: { config: ConferenceConfig; slug: string }) {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const types = c.submissionTypes;
  // The format the proposal will be in. "Start this proposal" on the conference's page names
  // it in the address, and a call with one format has no other. Otherwise there is none yet,
  // and the page asks before anything else.
  const [params] = useSearchParams();
  const [typeKey, setTypeKey] = useState(() => startingFormat(types, params.get("format")));
  /** The person asked for another format: the list is there again, with theirs marked. */
  const [changing, setChanging] = useState(false);
  const [language, setLanguage] = useState(c.languages.includes(lang) ? lang : c.defaultLanguage);
  const [mode, setMode] = useState<(typeof MODES)[number] | "">("");
  const [ownRole, setOwnRole] = useState<Role>("lead");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<{ path: string; code: string }[]>([]);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const hybrid = c.modality === "hybrid";
  const cap = c.rules.presenterCap;
  const type = types.find((x) => x.key === typeKey);
  const choosing = !type || changing;

  // Choosing a format, and asking for another, each put something else in the place of what
  // was pressed: the focus goes there, to the format that is now chosen, or to it in the list.
  const moved = useRef(false);
  const chosenRef = useRef<HTMLParagraphElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (choosing ? currentRef : chosenRef).current?.focus();
  }, [choosing]);

  function choose(key: string) {
    moved.current = true;
    setTypeKey(key);
    setChanging(false);
  }

  /** "up to 300 words · 15 minutes": what the call says of a format's lengths. */
  const lengths = (x: SubmissionType) =>
    [
      hasMinimum(x.abstract.minWords)
        ? t("confWords", { min: x.abstract.minWords, max: x.abstract.maxWords })
        : t("confWordsMax", { max: x.abstract.maxWords }),
      ...(x.durationMinutes ? [t("confMinutes", { n: x.durationMinutes })] : []),
    ].join(" · ");

  async function start(e: FormEvent) {
    e.preventDefault();
    if (hybrid && !mode) {
      setIssues([{ path: "participationMode", code: "required" }]);
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await api<MySubmission>(`/api/conferences/${slug}/submissions`, {
      method: "POST",
      body: { typeKey, language, ownRole, ...(mode ? { participationMode: mode } : {}) },
    });
    setBusy(false);
    if (res.ok) navigate(`/${lang}/s/${res.data.id}`);
    else if (res.issues.length) setIssues(res.issues);
    else if (res.error === "call_closed") setClosed(true);
    else setError(res.status === 0 ? t("verifyNetwork") : t("errorGeneric"));
  }

  if (closed) return <p role="alert">{t("startClosed")}</p>;

  // First the format, and nothing else: every format the call takes here, each with its
  // lengths and its description, so that none has to be pressed to be read. Pressing one
  // chooses it, and the list gives way to the rest of the form.
  if (choosing) {
    return (
      <>
        <p>{t("startChooseFormat")}</p>
        <ul className="format-rows" aria-label={t("manageType")}>
          {types.map((x) => {
            const current = x.key === typeKey;
            return (
              <li key={x.key} className={current ? "format-row current" : "format-row"}>
                <span className="format-row-head">
                  {/* The button is the format's name and lengths, which is what it is called
                      ("Paper · up to 300 words · 15 minutes": the dot is read out, and not
                      drawn); the description is read after them. The whole row is pressed as
                      the button is (its ::after covers the row). */}
                  <button
                    type="button"
                    className="format-row-name"
                    ref={current ? currentRef : undefined}
                    aria-current={current ? "true" : undefined}
                    aria-describedby={`format-${x.key}-about`}
                    onClick={() => choose(x.key)}
                  >
                    <strong>
                      <Localized text={x.name} fallback={c.defaultLanguage} />
                    </strong>
                    <span className="visually-hidden"> · </span>
                    <span className="format-row-lengths">{lengths(x)}</span>
                  </button>
                  {/* The format that is chosen already (aria-current says so as well). */}
                  {current && <span className="badge">{t("startFormatCurrent")}</span>}
                </span>
                <span id={`format-${x.key}-about`} className="format-row-about">
                  <Localized text={x.description} fallback={c.defaultLanguage} />
                </span>
                <span className="format-row-mark" aria-hidden="true">
                  →
                </span>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <form onSubmit={start} className="stack wide" noValidate>
      <ErrorSummary issues={issues} title={t("editErrors")} />
      {/* The format that is chosen, and the way to another. The others are not on the page:
          the rest of the form follows at once. */}
      <fieldset className="format-chosen">
        <legend>{t("manageType")}</legend>
        <div>
          <p id="field-typeKey" className="format-chosen-name" tabIndex={-1} ref={chosenRef}>
            <span className="visually-hidden">{t("startFormatChosen")} </span>
            <strong>
              <Localized text={type.name} fallback={c.defaultLanguage} />
            </strong>
          </p>
          <p className="format-row-lengths">{lengths(type)}</p>
        </div>
        <p>
          <Localized text={type.description} fallback={c.defaultLanguage} />
        </p>
        {types.length > 1 && (
          <p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                moved.current = true;
                setChanging(true);
              }}
            >
              {t("startChangeFormat")}
            </button>
          </p>
        )}
      </fieldset>
      <p>{t("startIntro")}</p>
      <label htmlFor="field-language">{t("startLanguage")}</label>
      <select id="field-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
        {c.languages.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANG_NAMES[l as keyof typeof LANG_NAMES] ?? l}
          </option>
        ))}
      </select>
      {hybrid && (
        <fieldset id="field-participationMode" tabIndex={-1}>
          <legend>{t("startMode")}</legend>
          {MODES.map((m) => (
            <label key={m} className="choice">
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              <span>{t(modeKey(m))}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label htmlFor="field-ownRole">{t("startOwnRole")}</label>
      <select
        id="field-ownRole"
        value={ownRole}
        onChange={(e) => setOwnRole(e.target.value as Role)}
        aria-describedby="role-help"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(roleKey(r))}
          </option>
        ))}
      </select>
      {cap && (
        <p id="role-help" className="meta">
          {t("startCounts", { max: cap.max })}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {t("startButton", { format: type ? localize(type.name, lang, c.defaultLanguage) : "" })}
      </button>
      <p className="status-line" role="status">
        {error}
      </p>
    </form>
  );
}
