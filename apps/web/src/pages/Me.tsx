import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Issue, type Me, type Profile } from "../api";
import { describedBy, ErrorSummary, FieldError, fieldId } from "../forms";
import { LANG_NAMES, type MessageKey, useT } from "../i18n";
import { PageHeading } from "../ui";
import { useApi } from "../useApi";

export function MePage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const res = useApi<Me>("/api/me");
  const [signOutFailed, setSignOutFailed] = useState(false);

  if (!res) return <p role="status">{t("loading")}</p>;
  if (!res.ok || res.data.kind !== "person") {
    return (
      <>
        <PageHeading>{t("meTitle")}</PageHeading>
        <p>{t("meNeedSignIn")}</p>
        <p>
          <Link className="button" to={`/${lang}/sign-in`}>
            {t("navSignIn")}
          </Link>
        </p>
      </>
    );
  }
  const me = res.data;
  async function signOut() {
    const out = await api("/api/auth/logout", { method: "POST", body: {} });
    if (out.ok) navigate(`/${lang}/`);
    else setSignOutFailed(true);
  }
  return (
    <>
      <PageHeading>{t("meTitle")}</PageHeading>
      <dl className="details">
        <div>
          <dt>{t("meEmail")}</dt>
          <dd>{me.person?.email}</dd>
        </div>
        <div>
          <dt>{t("meName")}</dt>
          <dd>{me.person?.displayName ?? t("meNotSet")}</dd>
        </div>
      </dl>
      <h2>{t("meRoles")}</h2>
      {me.roles.length === 0 ? (
        <p>{t("meNoRoles")}</p>
      ) : (
        <ul>
          {me.roles.map((r) => (
            <li key={`${r.conference}-${r.role}`}>
              {r.conference}: {t(`role_${r.role}` as MessageKey)}
              {r.scope.length > 0 && ` (${r.scope.join(", ")})`}
            </li>
          ))}
        </ul>
      )}
      <ProfileForm initial={me.person} />
      <p>
        <Link to={`/${lang}/my`}>{t("navMySubmissions")}</Link>
      </p>
      <button type="button" onClick={signOut}>
        {t("meSignOut")}
      </button>
      <p role="alert" className="status-line">
        {signOutFailed ? t("meSignOutFailed") : ""}
      </p>
    </>
  );
}

function ProfileForm({ initial }: { initial: Profile | null }) {
  const { t } = useT();
  const [form, setForm] = useState({
    displayName: initial?.displayName ?? "",
    affiliation: initial?.affiliation ?? "",
    country: initial?.country ?? "",
    languages: (initial?.languages ?? []).join(", "),
    pronouns: initial?.pronouns ?? "",
    orcid: initial?.orcid ?? "",
    bios: { en: "", es: "", pt: "", ...(initial?.bios ?? {}) } as Record<string, string>,
  });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const res = await api<Profile>("/api/me/profile", {
      method: "PUT",
      body: {
        displayName: form.displayName.trim(),
        affiliation: form.affiliation.trim() || null,
        country: form.country.trim().toUpperCase() || null,
        languages: form.languages
          .split(/[,\s]+/)
          .map((x) => x.trim())
          .filter(Boolean),
        pronouns: form.pronouns.trim() || null,
        orcid: form.orcid.trim() || null,
        bios: Object.fromEntries(Object.entries(form.bios).filter(([, v]) => v.trim())),
      },
    });
    if (res.ok) {
      setIssues([]);
      setMessage(t("profileSaved"));
    } else {
      const body = res.body as { issues?: { path: string; message: string }[] } | null;
      setIssues((body?.issues ?? []).map((i) => ({ path: i.path, code: "generic" })));
      setMessage("");
    }
  }

  const field = (
    key: "displayName" | "affiliation" | "country" | "languages" | "pronouns" | "orcid",
    label: string,
    extra: Record<string, string> = {},
  ) => (
    <>
      <label htmlFor={fieldId(key)}>{label}</label>
      <input
        id={fieldId(key)}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        aria-describedby={describedBy(key, issues)}
        {...extra}
      />
      <FieldError path={key} issues={issues} />
    </>
  );

  return (
    <form onSubmit={save} className="stack wide" noValidate>
      <h2>{t("profileTitle")}</h2>
      <ErrorSummary issues={issues} title={t("editErrors")} />
      {field("displayName", t("profileName"), { autoComplete: "name" })}
      {field("affiliation", t("profileAffiliation"), { autoComplete: "organization" })}
      {field("country", t("profileCountry"), { maxLength: "2", autoComplete: "country" })}
      {field("languages", t("profileLanguages"))}
      {field("pronouns", t("profilePronouns"))}
      {field("orcid", t("profileOrcid"))}
      {(["en", "es", "pt"] as const).map((l) => (
        <div key={l} className="stack">
          <label htmlFor={`bio-${l}`}>{t("profileBio", { lang: LANG_NAMES[l] })}</label>
          <textarea
            id={`bio-${l}`}
            lang={l}
            rows={4}
            value={form.bios[l] ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, bios: { ...f.bios, [l]: e.target.value } }))}
            aria-describedby="bio-help"
          />
        </div>
      ))}
      <p id="bio-help" className="meta">
        {t("profileBioHelp")}
      </p>
      <button type="submit">{t("profileSave")}</button>
      <p className="status-line" role="status">
        {message}
      </p>
    </form>
  );
}
