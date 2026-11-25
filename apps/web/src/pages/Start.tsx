import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type FormEvent, useState } from "react";
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
  // "Start this proposal" on the conference's page names the format in the address; it is only
  // where the form begins, and the person may still choose another.
  const [params] = useSearchParams();
  const [typeKey, setTypeKey] = useState(() =>
    startingFormat(c.submissionTypes, params.get("format")),
  );
  const [language, setLanguage] = useState(c.languages.includes(lang) ? lang : c.defaultLanguage);
  const [mode, setMode] = useState<(typeof MODES)[number] | "">("");
  const [ownRole, setOwnRole] = useState<Role>("lead");
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<{ path: string; code: string }[]>([]);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const hybrid = c.modality === "hybrid";
  const cap = c.rules.presenterCap;
  const type = c.submissionTypes.find((x) => x.key === typeKey);

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
  return (
    <form onSubmit={start} className="stack wide" noValidate>
      {/* Which format is chosen, said at the top, where the page says it while the person signs
          in: with every description on the page the list is long, and on a phone the chosen
          format may be a screen or two down. It follows the choice. */}
      {type && (
        <p className="meta">
          {t("startFormatChosen")} <Localized text={type.name} fallback={c.defaultLanguage} />
        </p>
      )}
      <p>{t("startIntro")}</p>
      <ErrorSummary issues={issues} title={t("editErrors")} />
      {/* Every format with its lengths and its description, all at once: choosing one needs
          no pressing through the others to read what each is. A format's name and lengths are
          what its choice is called; its description is read after them (aria-describedby),
          and pressing anywhere on it chooses it. */}
      <fieldset className="plain format-chooser">
        <legend>{t("manageType")}</legend>
        <div className="format-options">
          {c.submissionTypes.map((x) => (
            <label
              key={x.key}
              className={typeKey === x.key ? "choice format-option chosen" : "choice format-option"}
            >
              <input
                type="radio"
                name="typeKey"
                value={x.key}
                checked={typeKey === x.key}
                onChange={() => setTypeKey(x.key)}
                id={x === c.submissionTypes[0] ? "field-typeKey" : undefined}
                aria-labelledby={`format-${x.key}-name`}
                aria-describedby={`format-${x.key}-about`}
              />
              <span className="format-option-text">
                {/* The name, and under it the lengths. Read out, they are one line as before
                    ("Paper · up to 300 words · 15 minutes"): the dot between them is there for
                    that, and is not drawn. */}
                <span id={`format-${x.key}-name`} className="format-option-name">
                  <strong>
                    <Localized text={x.name} fallback={c.defaultLanguage} />
                  </strong>
                  <span className="visually-hidden"> · </span>
                  <span className="format-option-lengths">
                    {hasMinimum(x.abstract.minWords)
                      ? t("confWords", { min: x.abstract.minWords, max: x.abstract.maxWords })
                      : t("confWordsMax", { max: x.abstract.maxWords })}
                    {x.durationMinutes ? ` · ${t("confMinutes", { n: x.durationMinutes })}` : ""}
                  </span>
                </span>
                <span id={`format-${x.key}-about`} className="format-option-about">
                  <Localized text={x.description} fallback={c.defaultLanguage} />
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
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
