import type { ConferenceConfig, CustomField, SubmissionType } from "@elochair/schema";
import {
  countWords,
  effectiveBlindMode,
  localize,
  selfIdentificationWarnings,
} from "@elochair/schema/pure";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  type Check,
  type Contributor,
  type Issue,
  type Me,
  type MySubmission,
  type Role,
} from "../api";
import { formatDateTime, viewerTimeZone } from "../format";
import { describedBy, ErrorSummary, FieldError, fieldId } from "../forms";
import { LANG_NAMES, type MessageKey, useT } from "../i18n";
import { Localized, PageHeading } from "../ui";

type ConfInfo = { slug: string; phase: string; config: ConferenceConfig; callOpen: boolean };
type Form = Pick<
  MySubmission,
  "title" | "abstract" | "trackKey" | "topicKeys" | "language" | "participationMode" | "fields"
>;

const INVITE_ROLES: Exclude<Role, "lead">[] = ["presenter", "coauthor", "panelist", "moderator"];
const ALL_ROLES: Role[] = ["lead", ...INVITE_ROLES];

const formOf = (s: MySubmission): Form => ({
  title: s.title,
  abstract: s.abstract,
  trackKey: s.trackKey,
  topicKeys: [...s.topicKeys],
  language: s.language,
  participationMode: s.participationMode,
  fields: { ...s.fields },
});

export function SubmissionPage() {
  const { id = "" } = useParams();
  const { t } = useT();
  const [sub, setSub] = useState<MySubmission | null>(null);
  const [conf, setConf] = useState<ConfInfo | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const [s, k, m] = await Promise.all([
      api<MySubmission>(`/api/submissions/${id}`),
      api<ConfInfo>(`/api/submissions/${id}/conference`),
      api<Me>("/api/me"),
    ]);
    if (!s.ok || !k.ok) {
      setMissing(true);
      return;
    }
    setSub(s.data);
    setConf(k.data);
    setMe(m.ok && m.data.kind === "person" ? (m.data.person?.id ?? null) : null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (missing) return <PageHeading>{t("confNotFound")}</PageHeading>;
  if (!sub || !conf) return <p role="status">{t("loading")}</p>;
  const isOwner = me !== null && sub.ownerPersonId === me;
  return isOwner ? (
    <Editor initial={sub} conf={conf} onReload={load} />
  ) : (
    <ReadOnly sub={sub} conf={conf} onChanged={load} />
  );
}

function Deadline({ config }: { config: ConferenceConfig }) {
  const { lang, t } = useT();
  const close = Date.parse(config.deadlines.submissionsClose);
  const hours = Math.floor((close - Date.now()) / 3_600_000);
  const at = `${formatDateTime(config.deadlines.submissionsClose, lang, config.timezone)} (${config.timezone})`;
  const mine =
    viewerTimeZone() !== config.timezone
      ? ` · ${formatDateTime(config.deadlines.submissionsClose, lang, viewerTimeZone())}`
      : "";
  return (
    <p className="meta">
      {hours >= 0 && hours < 72 ? `${t("editDeadlineSoon", { hours })} ` : ""}
      {t("editDeadline", { date: `${at}${mine}` })}
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useT();
  return <span className={`badge status-${status}`}>{t(`status_${status}` as MessageKey)}</span>;
}

/** Live self-identification hints, computed in the browser from what the owner already sees. */
function useLiveSelfId(form: Form, sub: MySubmission, config: ConferenceConfig) {
  const [found, setFound] = useState<{ path: string; kind: string }[]>([]);
  useEffect(() => {
    const handle = setTimeout(() => {
      if (effectiveBlindMode(config, sub.typeKey) !== "double") return setFound([]);
      const type = config.submissionTypes.find((x) => x.key === sub.typeKey);
      const texts = [
        { path: "title", text: form.title },
        { path: "abstract", text: form.abstract },
        ...(type?.fields ?? [])
          .filter((f) => !f.identifying && typeof form.fields[f.key] === "string")
          .map((f) => ({ path: `fields.${f.key}`, text: String(form.fields[f.key]) })),
      ];
      const people = sub.contributors.map((c) => ({
        displayName: c.displayName,
        affiliation: c.affiliation,
        email: c.email ?? "",
        orcid: null,
      }));
      setFound(selfIdentificationWarnings(texts, people).map(({ path, kind }) => ({ path, kind })));
    }, 800);
    return () => clearTimeout(handle);
  }, [form, sub, config]);
  return found;
}

function SelfIdPanel({ warnings }: { warnings: { path: string; kind: string }[] }) {
  const { t } = useT();
  const unique = [...new Map(warnings.map((w) => [`${w.path}|${w.kind}`, w])).values()];
  return (
    <div aria-live="polite">
      {unique.length > 0 && (
        <div className="notice">
          <p>
            <strong>{t("selfIdTitle")}</strong> {t("selfIdIntro")}
          </p>
          <ul>
            {unique.map((w) => {
              const where =
                w.path === "title"
                  ? t("selfIdWhere_title")
                  : w.path === "abstract"
                    ? t("selfIdWhere_abstract")
                    : t("selfIdWhere_field");
              return (
                <li key={`${w.path}|${w.kind}`}>
                  {t(`selfId_${w.kind}` as MessageKey, { where })}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function WordCount({
  text,
  lang,
  min,
  max,
  id,
}: {
  text: string;
  lang: string;
  min: number;
  max: number;
  id: string;
}) {
  const { t } = useT();
  const n = countWords(text, lang);
  const state = n < min ? "under" : n > max ? "over" : "ok";
  const label =
    state === "under"
      ? t("editWordsUnder", { count: n, min })
      : state === "over"
        ? t("editWordsOver", { count: n, max })
        : t("editWords", { count: n, min, max });
  // Announced only when the count crosses a limit, not on every keystroke.
  const previous = useRef(state);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (previous.current !== state) {
      previous.current = state;
      setAnnouncement(label);
    }
  }, [state, label]);
  return (
    <>
      <p id={id} className={`word-count ${state}`}>
        {label}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  lang,
  config,
  issues,
}: {
  field: CustomField;
  value: unknown;
  onChange: (v: string | string[] | boolean | number | undefined) => void;
  lang: string;
  config: ConferenceConfig;
  issues: Issue[];
}) {
  const { t } = useT();
  const path = `fields.${field.key}`;
  const id = fieldId(path);
  const label = (
    <>
      <Localized text={field.label} fallback={config.defaultLanguage} />
      {field.required ? " *" : ""}
    </>
  );
  const help = field.help ? (
    <p className="meta" id={`${id}-help`}>
      <Localized text={field.help} fallback={config.defaultLanguage} />
    </p>
  ) : null;
  const aria = describedBy(path, issues, field.help ? `${id}-help` : "");
  switch (field.kind) {
    case "longtext":
      return (
        <div className="stack">
          <label htmlFor={id}>{label}</label>
          {help}
          <textarea
            id={id}
            rows={5}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            aria-describedby={aria}
          />
          {field.maxWords && (
            <p className="meta">
              {t("editWords", {
                count: countWords(String(value ?? ""), lang),
                min: 0,
                max: field.maxWords,
              })}
            </p>
          )}
          <FieldError path={path} issues={issues} />
        </div>
      );
    case "boolean":
      return (
        <div className="stack">
          <label className="choice">
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              aria-describedby={aria}
            />
            <span>{label}</span>
          </label>
          {help}
          <FieldError path={path} issues={issues} />
        </div>
      );
    case "select":
      return (
        <div className="stack">
          <label htmlFor={id}>{label}</label>
          {help}
          <select
            id={id}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value || undefined)}
            aria-describedby={aria}
          >
            <option value="">{t("editNone")}</option>
            {(field.options ?? []).map((o) => (
              <option key={o.key} value={o.key}>
                {localize(o.label, lang, config.defaultLanguage)}
              </option>
            ))}
          </select>
          <FieldError path={path} issues={issues} />
        </div>
      );
    case "multiselect": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset id={id} tabIndex={-1} aria-describedby={aria}>
          <legend>{label}</legend>
          {help}
          {(field.options ?? []).map((o) => (
            <label key={o.key} className="choice">
              <input
                type="checkbox"
                checked={chosen.includes(o.key)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...chosen, o.key] : chosen.filter((x) => x !== o.key),
                  )
                }
              />
              <span>{localize(o.label, lang, config.defaultLanguage)}</span>
            </label>
          ))}
          <FieldError path={path} issues={issues} />
        </fieldset>
      );
    }
    default:
      return (
        <div className="stack">
          <label htmlFor={id}>{label}</label>
          {help}
          <input
            id={id}
            type={field.kind === "url" ? "url" : field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "url" ? "url" : undefined}
            value={String(value ?? "")}
            onChange={(e) =>
              onChange(
                field.kind === "number"
                  ? e.target.value === ""
                    ? undefined
                    : Number(e.target.value)
                  : e.target.value,
              )
            }
            aria-describedby={aria}
          />
          <FieldError path={path} issues={issues} />
        </div>
      );
  }
}

function Editor({
  initial,
  conf,
  onReload,
}: {
  initial: MySubmission;
  conf: ConfInfo;
  onReload: () => void;
}) {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const config = conf.config;
  const [sub, setSub] = useState(initial);
  const [form, setForm] = useState<Form>(formOf(initial));
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  const [check, setCheck] = useState<Check | null>(null);
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey) as
    | SubmissionType
    | undefined;
  const editable = conf.callOpen && (sub.status === "draft" || sub.status === "submitted");
  const live = useLiveSelfId(form, sub, config);

  const refreshCheck = useCallback(async () => {
    const r = await api<Check>(`/api/submissions/${sub.id}/check`);
    if (r.ok) setCheck(r.data);
  }, [sub.id]);
  useEffect(() => {
    refreshCheck();
  }, [refreshCheck]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  /** Apply a server answer: new state on success; issues, stale or error otherwise. */
  function settle(res: Awaited<ReturnType<typeof api<MySubmission>>>, okMessage: string): boolean {
    if (res.ok) {
      setSub(res.data);
      setIssues([]);
      setMessage(okMessage);
      refreshCheck();
      return true;
    }
    if (res.error === "stale") setStale(true);
    else if (res.issues.length) setIssues(res.issues);
    else setMessage(res.error === "call_closed" ? t("editClosed") : t("errorGeneric"));
    return false;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    const res = await api<MySubmission>(`/api/submissions/${sub.id}`, {
      method: "PATCH",
      body: { version: sub.version, ...form },
    });
    setBusy(false);
    if (settle(res, t("editSaved"))) setDirty(false);
  }

  async function submit() {
    if (dirty) await save();
    setBusy(true);
    const res = await api<{ submission: MySubmission; check: Check }>(
      `/api/submissions/${sub.id}/submit`,
      {
        method: "POST",
        body: {
          version: sub.version,
          acceptedAgreements: config.agreements
            .filter((a) => agreed.has(a.key))
            .map((a) => ({ key: a.key, version: a.version })),
        },
      },
    );
    setBusy(false);
    if (res.ok) {
      setSub(res.data.submission);
      setCheck(res.data.check);
      setIssues([]);
      setMessage(t("editSubmitted"));
    } else if (res.error === "stale") setStale(true);
    else setIssues(res.issues.length ? res.issues : [{ path: "agreements", code: "generic" }]);
  }

  async function simple(path: string, method: string, okMessage: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(true);
    const res = await api<MySubmission>(`/api/submissions/${sub.id}${path}`, {
      method,
      body: { version: sub.version },
    });
    setBusy(false);
    return settle(res, okMessage) ? res : null;
  }

  if (stale) {
    return (
      <>
        <PageHeading>{sub.title || t("editUntitled")}</PageHeading>
        <p role="alert">{t("editStale")}</p>
        <button type="button" onClick={onReload}>
          {t("editReload")}
        </button>
      </>
    );
  }

  const abstractMin = type?.abstract.minWords ?? 0;
  const abstractMax = type?.abstract.maxWords ?? 0;
  const allAgreed = config.agreements.every((a) => agreed.has(a.key));
  const cap = check?.presenterCap;

  return (
    <article className="editor">
      <PageHeading title={sub.title || t("editUntitled")}>
        {sub.title || t("editUntitled")}
      </PageHeading>
      <p>
        <StatusBadge status={sub.status} />{" "}
        <Localized text={config.title} fallback={config.defaultLanguage} />
        {type && (
          <>
            {" · "}
            <Localized text={type.name} fallback={config.defaultLanguage} />
          </>
        )}
      </p>
      <Deadline config={config} />
      {!editable && <p className="notice">{conf.callOpen ? t("editReadOnly") : t("editClosed")}</p>}
      <p className="status-line" role="status">
        {message}
      </p>
      <ErrorSummary issues={issues} title={t("editErrors")} />

      <form onSubmit={save} className="stack wide" noValidate>
        <label htmlFor={fieldId("title")}>{t("editTitleLabel")}</label>
        <input
          id={fieldId("title")}
          value={form.title}
          maxLength={300}
          disabled={!editable}
          onChange={(e) => set("title", e.target.value)}
          aria-describedby={describedBy("title", issues)}
        />
        <FieldError path="title" issues={issues} />

        <label htmlFor={fieldId("abstract")}>
          {type ? (
            <Localized text={type.abstract.label} fallback={config.defaultLanguage} />
          ) : (
            "Abstract"
          )}
        </label>
        <textarea
          id={fieldId("abstract")}
          rows={12}
          value={form.abstract}
          disabled={!editable}
          onChange={(e) => set("abstract", e.target.value)}
          aria-describedby={describedBy("abstract", issues, "abstract-count")}
        />
        <WordCount
          text={form.abstract}
          lang={form.language}
          min={abstractMin}
          max={abstractMax}
          id="abstract-count"
        />
        <FieldError path="abstract" issues={issues} />
        <SelfIdPanel warnings={[...live, ...(check?.selfIdentification ?? [])]} />

        <label htmlFor={fieldId("language")}>{t("editLanguage")}</label>
        <select
          id={fieldId("language")}
          value={form.language}
          disabled={!editable}
          onChange={(e) => set("language", e.target.value)}
        >
          {config.languages.map((l) => (
            <option key={l} value={l} lang={l}>
              {LANG_NAMES[l as keyof typeof LANG_NAMES] ?? l}
            </option>
          ))}
        </select>

        {config.modality === "hybrid" && (
          <fieldset id={fieldId("participationMode")} tabIndex={-1} disabled={!editable}>
            <legend>{t("startMode")}</legend>
            {(["in_person", "online", "undecided"] as const).map((m) => (
              <label key={m} className="choice">
                <input
                  type="radio"
                  name="mode"
                  checked={form.participationMode === m}
                  onChange={() => set("participationMode", m)}
                />
                <span>{t(`mode_${m}` as MessageKey)}</span>
              </label>
            ))}
            <FieldError path="participationMode" issues={issues} />
          </fieldset>
        )}

        {config.tracks.length > 0 && (
          <>
            <label htmlFor={fieldId("trackKey")}>{t("editTrack")}</label>
            <select
              id={fieldId("trackKey")}
              value={form.trackKey ?? ""}
              disabled={!editable}
              onChange={(e) => set("trackKey", e.target.value || null)}
            >
              <option value="">{t("editNone")}</option>
              {config.tracks.map((x) => (
                <option key={x.key} value={x.key}>
                  {localize(x.name, lang, config.defaultLanguage)}
                </option>
              ))}
            </select>
          </>
        )}

        {config.topics.length > 0 && (
          <fieldset id={fieldId("topicKeys")} tabIndex={-1} disabled={!editable}>
            <legend>{t("editTopics")}</legend>
            {config.topics.map((x) => (
              <label key={x.key} className="choice">
                <input
                  type="checkbox"
                  checked={form.topicKeys.includes(x.key)}
                  onChange={(e) =>
                    set(
                      "topicKeys",
                      e.target.checked
                        ? [...form.topicKeys, x.key]
                        : form.topicKeys.filter((k) => k !== x.key),
                    )
                  }
                />
                <span>{localize(x.label, lang, config.defaultLanguage)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {(type?.fields ?? []).map((f) => (
          <fieldset key={f.key} className="plain" disabled={!editable}>
            <FieldInput
              field={f}
              value={form.fields[f.key]}
              lang={form.language}
              config={config}
              issues={issues}
              onChange={(v) => {
                const next = { ...form.fields };
                if (v === undefined || v === "") delete next[f.key];
                else next[f.key] = v;
                set("fields", next);
              }}
            />
          </fieldset>
        ))}

        {editable && (
          <button type="submit" disabled={busy || !dirty}>
            {sub.status === "draft" ? t("editSaveDraft") : t("editSaveChanges")}
          </button>
        )}
        {dirty && <p className="meta">{t("editUnsaved")}</p>}
      </form>

      <People
        sub={sub}
        config={config}
        editable={editable}
        onChange={(s) => setSub(s)}
        onIssues={setIssues}
        onStale={() => setStale(true)}
      />

      {cap && (
        <p className={cap.count > cap.max ? "notice" : "meta"}>
          {cap.count > cap.max ? t("capOver", cap) : t("capNote", cap)}
        </p>
      )}
      {check && check.missingBios.length > 0 && <p className="meta">{t("missingBios")}</p>}

      {editable && sub.status === "draft" && (
        <section aria-labelledby="submit-heading" className="stack wide">
          <h2 id="submit-heading">{t("editSubmit")}</h2>
          {config.agreements.length > 0 && (
            <fieldset id={fieldId("agreements")} tabIndex={-1}>
              <legend>{t("editAgreements")}</legend>
              {config.agreements.map((a) => (
                <div key={a.key} className="agreement">
                  <label className="choice">
                    <input
                      type="checkbox"
                      checked={agreed.has(a.key)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAgreed((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(a.key);
                          else next.delete(a.key);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {t("editAgree", { title: localize(a.title, lang, config.defaultLanguage) })}
                    </span>
                  </label>
                  {a.text && (
                    <p className="meta">{localize(a.text, lang, config.defaultLanguage)}</p>
                  )}
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noreferrer">
                      {t("editRead")}
                    </a>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <button type="button" disabled={busy || !allAgreed} onClick={submit}>
            {t("editSubmit")}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (await simple("", "DELETE", "", t("editDeleteConfirm"))) navigate(`/${lang}/my`);
            }}
          >
            {t("editDelete")}
          </button>
        </section>
      )}
      {editable && sub.status === "submitted" && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => simple("/unsubmit", "POST", t("editSaved"))}
          >
            {t("editUnsubmit")}
          </button>
        </div>
      )}
      {sub.status === "submitted" && (
        <div className="actions">
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() =>
              simple("/withdraw", "POST", t("status_withdrawn"), t("editWithdrawConfirm"))
            }
          >
            {t("editWithdraw")}
          </button>
        </div>
      )}
      <p>
        <Link to={`/${lang}/my`}>{t("navMySubmissions")}</Link>
      </p>
    </article>
  );
}

function People({
  sub,
  config,
  editable,
  onChange,
  onIssues,
  onStale,
}: {
  sub: MySubmission;
  config: ConferenceConfig;
  editable: boolean;
  onChange: (s: MySubmission) => void;
  onIssues: (i: Issue[]) => void;
  onStale: () => void;
}) {
  const { lang, t } = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [role, setRole] = useState<Exclude<Role, "lead">>("presenter");
  const [inviteLang, setInviteLang] = useState<"en" | "es" | "pt">(lang);
  const [status, setStatus] = useState("");
  const people = useMemo(
    () => [...sub.contributors].sort((a, b) => a.position - b.position),
    [sub.contributors],
  );

  async function act(path: string, method: string, body: Record<string, unknown>, ok: string) {
    const res = await api<MySubmission>(`/api/submissions/${sub.id}${path}`, {
      method,
      body: { version: sub.version, ...body },
    });
    if (res.ok) {
      if (res.status !== 204) onChange(res.data);
      setStatus(ok);
      onIssues([]);
    } else if (res.error === "stale") onStale();
    else if (res.issues.length) onIssues(res.issues);
    else setStatus(res.error === "rate_limited" ? t("signInRateLimited") : t("errorGeneric"));
    return res.ok;
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    const ok = await act(
      "/contributors",
      "POST",
      {
        email,
        role,
        lang: inviteLang,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(affiliation.trim() ? { affiliation: affiliation.trim() } : {}),
      },
      t("editInviteSent"),
    );
    if (ok) {
      setEmail("");
      setName("");
      setAffiliation("");
    }
  }

  return (
    <section aria-labelledby="people-heading" className="stack wide">
      <h2 id="people-heading">{t("editPeople")}</h2>
      <ol className="people" id={fieldId("contributions")} tabIndex={-1}>
        {people.map((c: Contributor, i) => (
          <li key={c.personId} className="card">
            <p>
              <strong>{c.displayName ?? c.email}</strong>
              {c.isOwner && <span className="meta"> ({t("editOwnerNote")})</span>}
              <br />
              <span className="meta">{[c.affiliation, c.email].filter(Boolean).join(" · ")}</span>
            </p>
            <p>
              <span className="badge">{t(`contrib_status_${c.status}` as MessageKey)}</span>
            </p>
            {editable && (
              <div className="actions">
                <label>
                  <span className="visually-hidden">{t("editRole")}</span>
                  <select
                    value={c.role}
                    onChange={(e) =>
                      act(
                        `/contributors/${c.personId}`,
                        "PATCH",
                        { role: e.target.value },
                        t("editSaved"),
                      )
                    }
                  >
                    {(c.status === "confirmed" ? ALL_ROLES : INVITE_ROLES).map((r) => (
                      <option key={r} value={r}>
                        {t(`contrib_${r}` as MessageKey)}
                      </option>
                    ))}
                  </select>
                </label>
                {i > 0 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      act(
                        `/contributors/${c.personId}`,
                        "PATCH",
                        { position: i - 1 },
                        t("editSaved"),
                      )
                    }
                  >
                    {t("editMoveUp")}
                  </button>
                )}
                {i < people.length - 1 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      act(
                        `/contributors/${c.personId}`,
                        "PATCH",
                        { position: i + 1 },
                        t("editSaved"),
                      )
                    }
                  >
                    {t("editMoveDown")}
                  </button>
                )}
                {c.status === "invited" && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      act(`/contributors/${c.personId}/resend`, "POST", {}, t("editInviteSent"))
                    }
                  >
                    {t("editResend")}
                  </button>
                )}
                {!c.isOwner && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => act(`/contributors/${c.personId}`, "DELETE", {}, t("editSaved"))}
                  >
                    {t("editRemove")}
                  </button>
                )}
              </div>
            )}
            {!editable && <p className="meta">{t(`contrib_${c.role}` as MessageKey)}</p>}
          </li>
        ))}
      </ol>
      <p className="status-line" role="status">
        {status}
      </p>
      {editable && (
        <form onSubmit={invite} className="stack" noValidate>
          <h3>{t("editInvite")}</h3>
          <label htmlFor={fieldId("email")}>{t("editEmail")}</label>
          <input
            id={fieldId("email")}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="invite-name">{t("editName")}</label>
          <input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="invite-affiliation">{t("editAffiliation")}</label>
          <input
            id="invite-affiliation"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
          />
          <label htmlFor="invite-role">{t("editRole")}</label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as Exclude<Role, "lead">)}
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`contrib_${r}` as MessageKey)}
              </option>
            ))}
          </select>
          <label htmlFor="invite-lang">{t("editInviteLang")}</label>
          <select
            id="invite-lang"
            value={inviteLang}
            onChange={(e) => setInviteLang(e.target.value as "en" | "es" | "pt")}
          >
            {(["en", "es", "pt"] as const).map((l) => (
              <option key={l} value={l} lang={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!email.trim()}>
            {t("editInviteSend")}
          </button>
        </form>
      )}
      {config.rules.presenterCap && (
        <p className="meta">{t("startCounts", { max: config.rules.presenterCap.max })}</p>
      )}
    </section>
  );
}

/** What co-authors and invitees see: the proposal, and their own choices. */
function ReadOnly({
  sub,
  conf,
  onChanged,
}: {
  sub: MySubmission;
  conf: ConfInfo;
  onChanged: () => void;
}) {
  const { lang, t } = useT();
  const config = conf.config;
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey);

  async function answer(a: "confirm" | "decline") {
    const res = await api<{ answer: string }>(`/api/me/invitations/${sub.id}/answer`, {
      method: "POST",
      body: {
        answer: a,
        acceptedAgreements: config.agreements
          .filter((x) => agreed.has(x.key))
          .map((x) => ({ key: x.key, version: x.version })),
      },
    });
    if (res.ok) {
      setMessage(a === "confirm" ? t("invConfirmed") : t("invDeclined"));
      onChanged();
    } else
      setMessage(
        res.issues.length
          ? t("issue_agreements_required")
          : res.error === "call_closed"
            ? t("invClosed")
            : t("errorGeneric"),
      );
  }

  async function leave() {
    if (!window.confirm(t("editLeaveConfirm"))) return;
    const res = await api(`/api/submissions/${sub.id}/leave`, { method: "POST", body: {} });
    setMessage(res.ok ? t("invDeclined") : t("errorGeneric"));
  }

  return (
    <article>
      <PageHeading title={sub.title || t("editUntitled")}>
        {sub.title || t("editUntitled")}
      </PageHeading>
      <p>
        <StatusBadge status={sub.status} />{" "}
        <Localized text={config.title} fallback={config.defaultLanguage} />
        {type && (
          <>
            {" · "}
            <Localized text={type.name} fallback={config.defaultLanguage} />
          </>
        )}
      </p>
      <p className="notice">{sub.view === "invitee" ? t("editInviteeIntro") : t("editReadOnly")}</p>
      <h2>{type ? localize(type.abstract.label, lang, config.defaultLanguage) : "Abstract"}</h2>
      <p className="prose" lang={sub.language}>
        {sub.abstract}
      </p>
      <h2>{t("editPeople")}</h2>
      <ul>
        {sub.contributors.map((c) => (
          <li key={c.personId}>
            {c.displayName ?? "—"} · {t(`contrib_${c.role}` as MessageKey)} ·{" "}
            {t(`contrib_status_${c.status}` as MessageKey)}
          </li>
        ))}
      </ul>
      <p className="status-line" role="status">
        {message}
      </p>
      {sub.view === "invitee" && (
        <div className="stack wide">
          {config.agreements.length > 0 && (
            <fieldset>
              <legend>{t("editAgreements")}</legend>
              {config.agreements.map((a) => (
                <label key={a.key} className="choice">
                  <input
                    type="checkbox"
                    checked={agreed.has(a.key)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAgreed((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(a.key);
                        else next.delete(a.key);
                        return next;
                      });
                    }}
                  />
                  <span>
                    {t("editAgree", { title: localize(a.title, lang, config.defaultLanguage) })}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <button
            type="button"
            disabled={!conf.callOpen || !config.agreements.every((a) => agreed.has(a.key))}
            onClick={() => answer("confirm")}
          >
            {t("editConfirm")}
          </button>
          <button type="button" className="secondary" onClick={() => answer("decline")}>
            {t("editDecline")}
          </button>
        </div>
      )}
      {sub.view === "submitter" && (
        <button type="button" className="secondary" onClick={leave}>
          {t("editLeave")}
        </button>
      )}
    </article>
  );
}
