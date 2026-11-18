import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type Issue, type Me, type Profile } from "../api";
import { describedBy, ErrorSummary, FieldError, fieldId, RestoredNotice } from "../forms";
import { LANG_NAMES, useT } from "../i18n";
import { conferenceRoleKey } from "../labels";
import { PageHeading } from "../ui";
import type { UnsavedValues } from "../unsaved";
import { useApi } from "../useApi";
import { forgetUnsaved, useUnsaved } from "../useUnsaved";

const TEXT_KEYS = [
  "displayName",
  "affiliation",
  "country",
  "languages",
  "pronouns",
  "orcid",
] as const;
const BIO_LANGS = ["en", "es", "pt"] as const;
type ProfileFields = Record<(typeof TEXT_KEYS)[number], string> & { bios: Record<string, string> };

const fieldsOf = (p: Profile | null): ProfileFields => ({
  displayName: p?.displayName ?? "",
  affiliation: p?.affiliation ?? "",
  country: p?.country ?? "",
  languages: (p?.languages ?? []).join(", "),
  pronouns: p?.pronouns ?? "",
  orcid: p?.orcid ?? "",
  bios: { en: "", es: "", pt: "", ...(p?.bios ?? {}) },
});

/** What differs from `base`, by form path ("affiliation", "bios.es"), as the browser keeps it. */
function unsavedOf(base: ProfileFields, form: ProfileFields): UnsavedValues {
  const out: UnsavedValues = {};
  for (const k of TEXT_KEYS) {
    if (form[k] !== base[k]) out[k] = form[k];
  }
  for (const l of BIO_LANGS) {
    if (form.bios[l] !== base.bios[l]) out[`bios.${l}`] = form.bios[l] ?? "";
  }
  return out;
}

/** `base` with unsaved values from the browser put back; anything else stored there is ignored. */
function withUnsaved(base: ProfileFields, values: UnsavedValues): ProfileFields {
  const out: ProfileFields = { ...base, bios: { ...base.bios } };
  for (const k of TEXT_KEYS) {
    const v = values[k];
    if (typeof v === "string") out[k] = v;
  }
  for (const l of BIO_LANGS) {
    const v = values[`bios.${l}`];
    if (typeof v === "string") out.bios[l] = v;
  }
  return out;
}

export function MePage() {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const res = useApi<Me>("/api/me");
  const [signOutFailed, setSignOutFailed] = useState(false);
  /** The profile as the last save returned it (newer than the page load). */
  const [saved, setSaved] = useState<Profile | null>(null);

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
  const person = saved ?? me.person;
  async function signOut() {
    const out = await api("/api/auth/logout", { method: "POST", body: {} });
    if (out.ok) {
      // Unsaved text must not wait in this browser for whoever uses it next.
      if (person) forgetUnsaved(person.id);
      navigate(`/${lang}/`);
    } else setSignOutFailed(true);
  }
  return (
    <>
      <PageHeading>{t("meTitle")}</PageHeading>
      <dl className="details">
        <div>
          <dt>{t("meEmail")}</dt>
          <dd>{person?.email}</dd>
        </div>
        <div>
          <dt>{t("meName")}</dt>
          <dd>{person?.displayName || t("meNotSet")}</dd>
        </div>
      </dl>
      <h2>{t("meRoles")}</h2>
      {me.roles.length === 0 ? (
        <p>{t("meNoRoles")}</p>
      ) : (
        <ul>
          {me.roles.map((r) => (
            <li key={`${r.conference}-${r.role}`}>
              {r.conference}: {t(conferenceRoleKey(r.role))}
              {r.scope.length > 0 && ` (${r.scope.join(", ")})`}
            </li>
          ))}
        </ul>
      )}
      <ProfileForm initial={me.person} onSaved={setSaved} />
      <p>
        <Link className="block-link" to={`/${lang}/my`}>
          {t("navMySubmissions")}
        </Link>
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

function ProfileForm({
  initial,
  onSaved,
}: {
  initial: Profile | null;
  onSaved: (p: Profile) => void;
}) {
  const { t } = useT();
  const { found, keep } = useUnsaved(initial?.id ?? null, "profile");
  /** The form as it was last loaded or saved. Unsaved changes are the differences from it. */
  const [base, setBase] = useState(() => fieldsOf(initial));
  /** Changes an earlier visit left unsaved in this browser, back on top of the saved profile. */
  const [restore] = useState(() => {
    const kept = found ? withUnsaved(base, found.values) : base;
    return Object.keys(unsavedOf(base, kept)).length > 0 ? kept : null;
  });
  const [form, setForm] = useState(() => restore ?? base);
  const [restored, setRestored] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const set = (key: (typeof TEXT_KEYS)[number], value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const unsaved = useMemo(() => unsavedOf(base, form), [base, form]);

  // Said after the first render, so that the notice is announced.
  useEffect(() => {
    if (restore) setRestored(true);
  }, [restore]);

  useEffect(() => {
    keep(unsaved, null);
  }, [keep, unsaved]);

  /** Back to the saved profile. The notice goes away: focus moves to the line that says so. */
  function discardRestored() {
    setForm(base);
    setRestored(false);
    setIssues([]);
    setMessage(t("unsavedDiscarded"));
    statusRef.current?.focus();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const sent = form;
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
      if (res.data) onSaved(res.data);
      // Anything typed while the save was on its way stays as an unsaved change.
      setBase(sent);
      setRestored(false);
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
      <RestoredNotice
        shown={restored && Object.keys(unsaved).length > 0}
        onDiscard={discardRestored}
      />
      <ErrorSummary issues={issues} title={t("editErrors")} />
      {field("displayName", t("profileName"), { autoComplete: "name" })}
      {field("affiliation", t("profileAffiliation"), { autoComplete: "organization" })}
      {field("country", t("profileCountry"), { maxLength: "2", autoComplete: "country" })}
      {field("languages", t("profileLanguages"))}
      {field("pronouns", t("profilePronouns"))}
      {field("orcid", t("profileOrcid"))}
      {BIO_LANGS.map((l) => (
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
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
    </form>
  );
}
