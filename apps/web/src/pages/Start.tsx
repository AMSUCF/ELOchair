import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, type ConferenceDetail, type Me, type MySubmission, type Role } from "../api";
import { hasMinimum } from "../format";
import { ErrorSummary } from "../forms";
import { LANG_NAMES, useT } from "../i18n";
import { modeKey, roleKey } from "../labels";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

const ROLES: Role[] = ["lead", "presenter", "coauthor", "panelist", "moderator"];
const MODES = ["in_person", "online", "undecided"] as const;

export function StartPage() {
  const { slug } = useParams();
  const { lang, t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const me = useApi<Me>("/api/me");

  if (!conf || !me) return <p role="status">{t("loading")}</p>;
  if (!conf.ok) {
    return <PageHeading>{t("confNotFound")}</PageHeading>;
  }
  const c = conf.data.config;
  // The server's clock decides; a phone with a wrong clock must not hide or show the form.
  const open = conf.data.callOpen;
  return (
    <>
      <PageHeading title={t("startTitle")}>{t("startTitle")}</PageHeading>
      <p className="meta">
        <Localized text={c.title} fallback={c.defaultLanguage} />
      </p>
      {!open ? (
        <p role="alert">{t("startClosed")}</p>
      ) : !me.ok || me.data.kind !== "person" ? (
        <p>
          {t("startSignInFirst")} <Link to={`/${lang}/sign-in`}>{t("navSignIn")}</Link>
        </p>
      ) : (
        <StartForm config={c} slug={slug ?? ""} />
      )}
    </>
  );
}

function StartForm({ config: c, slug }: { config: ConferenceConfig; slug: string }) {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const [typeKey, setTypeKey] = useState(c.submissionTypes[0]?.key ?? "");
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
      <p>{t("startIntro")}</p>
      <ErrorSummary issues={issues} title={t("editErrors")} />
      <fieldset>
        <legend>{t("manageType")}</legend>
        {c.submissionTypes.map((x) => (
          <label key={x.key} className="choice">
            <input
              type="radio"
              name="typeKey"
              value={x.key}
              checked={typeKey === x.key}
              onChange={() => setTypeKey(x.key)}
              id={x === c.submissionTypes[0] ? "field-typeKey" : undefined}
            />
            <span>
              <strong>
                <Localized text={x.name} fallback={c.defaultLanguage} />
              </strong>
              <span className="meta">
                {" "}
                ·{" "}
                {hasMinimum(x.abstract.minWords)
                  ? t("confWords", { min: x.abstract.minWords, max: x.abstract.maxWords })
                  : t("confWordsMax", { max: x.abstract.maxWords })}
                {x.durationMinutes ? ` · ${t("confMinutes", { n: x.durationMinutes })}` : ""}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {type && (
        <p className="meta">
          <Localized text={type.description} fallback={c.defaultLanguage} />
        </p>
      )}
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
