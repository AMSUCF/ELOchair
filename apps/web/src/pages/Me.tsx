import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, type EmailChoices, type Issue, type Me, type Profile } from "../api";
import { describedBy, ErrorSummary, FieldError, fieldId, RestoredNotice } from "../forms";
import { LANG_NAMES, useT } from "../i18n";
import { conferenceRoleKey } from "../labels";
import { sessionChanged } from "../session";
import { nobodySignedIn, SignInHere } from "../signIn";
import { PageHeading } from "../ui";
import { sortUnsaved, type UnsavedValues } from "../unsaved";
import { useApi } from "../useApi";
import { forgetUnsaved, useUnsaved } from "../useUnsaved";
import { EmailChoicesSection } from "./EmailChoices";

const TEXT_KEYS = [
  "displayName",
  "affiliation",
  "country",
  "languages",
  "pronouns",
  "orcid",
] as const;
const BIO_LANGS = ["en", "es", "pt"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
type ProfileFields = Record<TextKey, string> & { bios: Record<string, string> };
/** Every value of the form by its path: the text fields, and "bios.en", "bios.es", "bios.pt". */
const PATHS: readonly string[] = [...TEXT_KEYS, ...BIO_LANGS.map((l) => `bios.${l}`)];
const bioLang = (path: string) => BIO_LANGS.find((l) => path === `bios.${l}`);
/**
 * An unsaved change that was typed on a saved value which has changed since (the profile was
 * saved somewhere else in between): the person chooses between theirs and the saved one.
 */
type Conflicts = Record<string, { mine: string; base: string }>;

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

/** The form's values by path, as the browser's buffer names them. */
function valuesOf(form: ProfileFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TEXT_KEYS) out[k] = form[k];
  for (const l of BIO_LANGS) out[`bios.${l}`] = form.bios[l] ?? "";
  return out;
}

/**
 * After a save: the profile as the server now has it (it tidies names and codes), with whatever
 * was typed while the save was on its way kept on top as an unsaved change.
 */
function reapply(fresh: ProfileFields, sent: ProfileFields, current: ProfileFields): ProfileFields {
  const typed: UnsavedValues = {};
  const was = valuesOf(sent);
  for (const [path, value] of Object.entries(valuesOf(current))) {
    if (value !== was[path]) typed[path] = value;
  }
  return withUnsaved(fresh, typed);
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
  // Asked for with the account, so that the page is drawn once, with everything on it.
  const choices = useApi<{ conferences: EmailChoices[] }>("/api/me/notifications");
  const [signOutFailed, setSignOutFailed] = useState(false);
  /** The profile as the last save returned it (newer than the page load). */
  const [saved, setSaved] = useState<Profile | null>(null);

  if (!res || !choices) return <p role="status">{t("loading")}</p>;
  if (nobodySignedIn(res)) return <SignInHere title={t("meTitle")} why={t("meNeedSignIn")} />;
  if (!res.ok || res.data.kind !== "person") {
    return (
      <>
        <PageHeading>{t("meTitle")}</PageHeading>
        {/* The account did not arrive: that does not say that nobody is signed in. */}
        <p role="alert">{t(!res.ok && res.status === 0 ? "verifyNetwork" : "errorGeneric")}</p>
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
      sessionChanged();
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
      {choices.ok ? (
        <EmailChoicesSection conferences={choices.data.conferences} />
      ) : (
        <p role="alert">{t("emailsLoadFailed")}</p>
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
  /**
   * What an earlier visit left unsaved in this browser. A profile has no versions, so each change
   * was kept with the saved value it was typed on: where that is still the saved value, the
   * change goes back into the form; where the profile was saved somewhere else since, it is a
   * conflict, and the form shows the saved text until the person has chosen.
   */
  const [start] = useState(() => {
    const sorted = sortUnsaved(found, valuesOf(base));
    const kept = withUnsaved(base, sorted.restore);
    const conflicts: Conflicts = {};
    for (const [path, { mine, base: typedOn }] of Object.entries(sorted.conflicts)) {
      if (PATHS.includes(path) && typeof mine === "string" && typeof typedOn === "string") {
        conflicts[path] = { mine, base: typedOn };
      }
    }
    return { form: kept, restored: Object.keys(unsavedOf(base, kept)).length > 0, conflicts };
  });
  const [form, setForm] = useState(start.form);
  const [conflicts, setConflicts] = useState<Conflicts>(start.conflicts);
  const [restored, setRestored] = useState(false);
  /** The notices are said after the first render, so that they are announced. */
  const [announced, setAnnounced] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const set = (key: TextKey, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const unsaved = useMemo(() => unsavedOf(base, form), [base, form]);
  /**
   * What the browser keeps: each unsaved change with the saved value it was made on. A conflict
   * stays in it as it was found, on the value it was typed on, until the person has chosen: it
   * is not in the form, and must not be lost with the next reload.
   */
  const buffer = useMemo(() => {
    const saved = valuesOf(base);
    const values: UnsavedValues = { ...unsaved };
    const bases: UnsavedValues = {};
    for (const path of Object.keys(unsaved)) bases[path] = saved[path] ?? "";
    for (const [path, { mine, base: typedOn }] of Object.entries(conflicts)) {
      values[path] = mine;
      bases[path] = typedOn;
    }
    return { values, bases };
  }, [base, unsaved, conflicts]);

  useEffect(() => {
    if (start.restored) setRestored(true);
    setAnnounced(true);
  }, [start]);

  useEffect(() => {
    keep(buffer.values, null, buffer.bases);
  }, [keep, buffer]);

  /** Back to the saved profile. The notice goes away: focus moves to the line that says so. */
  function discardRestored() {
    setForm(base);
    setRestored(false);
    setIssues([]);
    setMessage(t("unsavedDiscarded"));
    statusRef.current?.focus();
  }

  /** The person chose their own text: it goes into the form as an unsaved change, to review. */
  function keepMine() {
    const mine: UnsavedValues = {};
    for (const [path, conflict] of Object.entries(conflicts)) mine[path] = conflict.mine;
    setForm((f) => withUnsaved(f, mine));
    setConflicts({});
    setMessage(t("profileConflictKept"));
    statusRef.current?.focus();
  }

  /** The person chose the saved version: their text from before is discarded. */
  function keepSaved() {
    setConflicts({});
    setMessage(t("unsavedDiscarded"));
    statusRef.current?.focus();
  }

  const labelOf = (path: string) => {
    const l = bioLang(path);
    if (l) return t("profileBio", { lang: LANG_NAMES[l] });
    const labels: Record<TextKey, string> = {
      displayName: t("profileName"),
      affiliation: t("profileAffiliation"),
      country: t("profileCountry"),
      languages: t("profileLanguages"),
      pronouns: t("profilePronouns"),
      orcid: t("profileOrcid"),
    };
    return labels[path as TextKey] ?? path;
  };

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
      // The saved profile is what the server answers with, not what was typed: an unsaved change
      // is kept with the saved value it was made on, and the two are compared after a reload.
      const fresh = res.data ? fieldsOf(res.data) : sent;
      setBase(fresh);
      // Anything typed while the save was on its way stays as an unsaved change.
      setForm((current) => reapply(fresh, sent, current));
      setRestored(false);
      setIssues([]);
      setMessage(t("profileSaved"));
      // The frame shows the name: it asks for it again.
      sessionChanged();
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
      <ConflictNotice
        conflicts={announced ? conflicts : {}}
        labelOf={labelOf}
        onKeepMine={keepMine}
        onKeepSaved={keepSaved}
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

/**
 * Says that unsaved changes from this browser were typed on a profile that has been saved
 * somewhere else since, shows them, and asks which to keep. Until the person has chosen, the
 * form holds the saved text and saving sends none of these. The outer element is always
 * rendered, so that the notice is announced when it appears; it takes no focus.
 */
function ConflictNotice({
  conflicts,
  labelOf,
  onKeepMine,
  onKeepSaved,
}: {
  conflicts: Conflicts;
  labelOf: (path: string) => string;
  onKeepMine: () => void;
  onKeepSaved: () => void;
}) {
  const { t } = useT();
  const paths = PATHS.filter((path) => conflicts[path]);
  return (
    <div className="restored" aria-live="polite">
      {paths.length > 0 && (
        <div className="notice stack wide">
          <p>{t("profileConflict")}</p>
          <ul>
            {paths.map((path) => (
              <li key={path}>
                <strong>{labelOf(path)}:</strong>{" "}
                {conflicts[path]?.mine ? (
                  <span lang={bioLang(path)}>{conflicts[path]?.mine}</span>
                ) : (
                  t("profileConflictEmpty")
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onKeepMine}>
            {t("profileConflictKeep")}
          </button>
          <button type="button" className="secondary" onClick={onKeepSaved}>
            {t("profileConflictDiscard")}
          </button>
        </div>
      )}
    </div>
  );
}
