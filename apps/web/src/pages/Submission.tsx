import type { ConferenceConfig, CustomField, SelfIdKind, SubmissionType } from "@elochair/schema";
import {
  countWords,
  effectiveBlindMode,
  LIMITS,
  localize,
  selfIdentificationWarnings,
} from "@elochair/schema/pure";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "react-router";
import {
  type ApiResult,
  api,
  type Check,
  type Contributor,
  type Issue,
  type Me,
  type MySubmission,
  type Profile,
  type Role,
} from "../api";
import { formatDateTime, viewerTimeZone } from "../format";
import { cleanName, describedBy, ErrorSummary, FieldError, fieldId, nameRefusal } from "../forms";
import { LANG_NAMES, useT } from "../i18n";
import { contribStatusKey, modeKey, roleKey, selfIdKey, statusKey } from "../labels";
import { Localized, PageHeading } from "../ui";

type ConfInfo = { slug: string; phase: string; config: ConferenceConfig; callOpen: boolean };
type Form = Pick<
  MySubmission,
  "title" | "abstract" | "trackKey" | "topicKeys" | "language" | "participationMode" | "fields"
>;
type SelfIdFinding = { path: string; kind: SelfIdKind };
/** Runs one request at a time for the whole editor; a repeat tap while one is pending is ignored. */
type Exclusive = <T>(work: () => Promise<T>) => Promise<T | null>;

const INVITE_ROLES: Exclude<Role, "lead">[] = ["presenter", "coauthor", "panelist", "moderator"];
const ALL_ROLES: Role[] = ["lead", ...INVITE_ROLES];
const PLAIN_KEYS = [
  "title",
  "abstract",
  "trackKey",
  "topicKeys",
  "language",
  "participationMode",
] as const;

const formOf = (s: MySubmission): Form => ({
  title: s.title,
  abstract: s.abstract,
  trackKey: s.trackKey,
  topicKeys: [...s.topicKeys],
  language: s.language,
  participationMode: s.participationMode,
  fields: { ...s.fields },
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fieldKeys = (a: Form, b: Form) => [
  ...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]),
];

/** The form paths ("title", "fields.url", …) whose values differ between two copies. */
function changedPaths(a: Form, b: Form): string[] {
  return [
    ...PLAIN_KEYS.filter((k) => !same(a[k], b[k])),
    ...fieldKeys(a, b)
      .filter((k) => !same(a.fields[k], b.fields[k]))
      .map((k) => `fields.${k}`),
  ];
}

function copyKey<K extends keyof Form>(to: Form, from: Form, key: K) {
  to[key] = from[key];
}

/** `onto` with every change that `edited` made relative to `from` applied on top of it. */
function reapply(onto: Form, from: Form, edited: Form): Form {
  const out: Form = { ...onto, topicKeys: [...onto.topicKeys], fields: { ...onto.fields } };
  for (const k of PLAIN_KEYS) if (!same(from[k], edited[k])) copyKey(out, edited, k);
  for (const k of fieldKeys(from, edited)) {
    if (same(from.fields[k], edited.fields[k])) continue;
    const v = edited.fields[k];
    if (v === undefined) delete out.fields[k];
    else out.fields[k] = v;
  }
  return out;
}

/** The same page in any interface language ("/es/s/1" and "/en/s/1" are one page). */
const withoutLang = (pathname: string) => pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "");

export function SubmissionPage() {
  const { id = "" } = useParams();
  const { t } = useT();
  const [sub, setSub] = useState<MySubmission | null>(null);
  const [conf, setConf] = useState<ConfInfo | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
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
    setMissing(false);
    setSub(s.data);
    setConf(k.data);
    setMe(m.ok && m.data.kind === "person" ? m.data.person : null);
  }, [id]);

  useEffect(() => {
    setSub(null);
    setMissing(false);
    load();
  }, [load]);

  if (missing) return <PageHeading>{t("editNotFound")}</PageHeading>;
  if (!sub || !conf) return <p role="status">{t("loading")}</p>;
  const isOwner = me !== null && sub.ownerPersonId === me.id;
  // A new copy from the server (another proposal, or a reload) starts a fresh editor.
  return isOwner ? (
    <Editor key={`${sub.id}:${sub.version}`} initial={sub} conf={conf} onGone={load} />
  ) : (
    <ReadOnly
      key={sub.id}
      sub={sub}
      conf={conf}
      needsName={!me?.displayName?.trim()}
      onChanged={load}
    />
  );
}

function Deadline({ config, open }: { config: ConferenceConfig; open: boolean }) {
  const { lang, t } = useT();
  // Display only: whether the call is open is the server's answer (`open`), never this clock.
  const close = Date.parse(config.deadlines.submissionsClose);
  const hours = open ? Math.floor((close - Date.now()) / 3_600_000) : -1;
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

function StatusBadge({ status }: { status: MySubmission["status"] }) {
  const { t } = useT();
  return <span className={`badge status-${status}`}>{t(statusKey(status))}</span>;
}

/** Live self-identification hints, computed in the browser from what the owner already sees. */
function useLiveSelfId(form: Form, sub: MySubmission, config: ConferenceConfig) {
  const [found, setFound] = useState<SelfIdFinding[]>([]);
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

function SelfIdPanel({ warnings }: { warnings: SelfIdFinding[] }) {
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
              return <li key={`${w.path}|${w.kind}`}>{t(selfIdKey(w.kind), { where })}</li>;
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
  onGone,
}: {
  initial: MySubmission;
  conf: ConfInfo;
  /** The proposal can no longer be read (deleted, or access lost): let the page say so. */
  onGone: () => void;
}) {
  const { lang, t } = useT();
  const navigate = useNavigate();
  const config = conf.config;
  const [sub, setSub] = useState(initial);
  /** The form as the server last had it. Unsaved changes are the differences from it. */
  const [base, setBase] = useState<Form>(() => formOf(initial));
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState("");
  const [stale, setStale] = useState(false);
  /** The server's check, with the version it describes. */
  const [check, setCheck] = useState<{ version: number; data: Check } | null>(null);
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** Set just before navigating away on purpose (after deleting), so the guard lets it through. */
  const leaving = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey) as
    | SubmissionType
    | undefined;
  const editable = conf.callOpen && (sub.status === "draft" || sub.status === "submitted");
  const changed = useMemo(() => new Set(changedPaths(base, form)), [base, form]);
  const dirty = changed.size > 0;
  const live = useLiveSelfId(form, sub, config);

  const refreshCheck = useCallback(
    async (version: number) => {
      const r = await api<Check>(`/api/submissions/${initial.id}/check`);
      if (r.ok) setCheck({ version, data: r.data });
    },
    [initial.id],
  );
  useEffect(() => {
    refreshCheck(initial.version);
  }, [refreshCheck, initial.version]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // In-app navigation (header, footer and other links, the back button) asks before unsaved
  // changes are lost. Switching the interface language keeps the page, so it is not blocked.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !leaving.current &&
      withoutLang(currentLocation.pathname) !== withoutLang(nextLocation.pathname),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t("editLeaveUnsaved"))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  const exclusive: Exclusive = async (work) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Apply a server answer: new state on success; issues, stale or an error otherwise. */
  function settle(res: ApiResult<MySubmission>, okMessage: string): MySubmission | null {
    if (res.ok) {
      setSub(res.data);
      setIssues([]);
      setMessage(okMessage);
      refreshCheck(res.data.version);
      return res.data;
    }
    if (res.error === "stale") setStale(true);
    else if (res.issues.length) setIssues(res.issues);
    else setMessage(res.error === "call_closed" ? t("editClosed") : t("errorGeneric"));
    return null;
  }

  /** Save the form. Returns the saved submission, or null when the save did not happen. */
  async function persist(): Promise<MySubmission | null> {
    const sent = form;
    // Only the fields this format defines (the server refuses others, which no input here shows).
    const fields = type
      ? Object.fromEntries(
          Object.entries(sent.fields).filter(([k]) => type.fields.some((f) => f.key === k)),
        )
      : sent.fields;
    const res = await api<MySubmission>(`/api/submissions/${sub.id}`, {
      method: "PATCH",
      body: { version: sub.version, ...sent, fields },
    });
    const saved = settle(res, t("editSaved"));
    if (saved) {
      const fresh = formOf(saved);
      setBase(fresh);
      // Anything typed while the save was on its way stays as an unsaved change.
      setForm((current) => reapply(fresh, sent, current));
    }
    return saved;
  }

  async function save(e?: FormEvent) {
    e?.preventDefault();
    if (stale) return;
    await exclusive(persist);
  }

  async function submit() {
    if (stale) return;
    await exclusive(async () => {
      let current = sub;
      if (dirty) {
        const saved = await persist();
        if (!saved) return;
        current = saved;
      }
      const res = await api<{ submission: MySubmission; check: Check }>(
        `/api/submissions/${current.id}/submit`,
        {
          method: "POST",
          body: {
            version: current.version,
            acceptedAgreements: config.agreements
              .filter((a) => agreed.has(a.key))
              .map((a) => ({ key: a.key, version: a.version })),
          },
        },
      );
      if (res.ok) {
        setSub(res.data.submission);
        setCheck({ version: res.data.submission.version, data: res.data.check });
        setIssues([]);
        setMessage(t("editSubmitted"));
      } else if (res.error === "stale") setStale(true);
      else if (res.issues.length) setIssues(res.issues);
      else setMessage(res.error === "call_closed" ? t("editClosed") : t("errorGeneric"));
    });
  }

  async function simple(path: string, okMessage: string, confirmText?: string) {
    if (stale) return;
    if (confirmText && !window.confirm(confirmText)) return;
    await exclusive(async () =>
      settle(
        await api<MySubmission>(`/api/submissions/${sub.id}${path}`, {
          method: "POST",
          body: { version: sub.version },
        }),
        okMessage,
      ),
    );
  }

  async function remove() {
    if (stale || !window.confirm(t("editDeleteConfirm"))) return;
    await exclusive(async () => {
      const res = await api(`/api/submissions/${sub.id}`, {
        method: "DELETE",
        body: { version: sub.version },
      });
      if (res.ok) {
        leaving.current = true;
        navigate(`/${lang}/my`);
      } else if (res.error === "stale") setStale(true);
      else setMessage(res.error === "call_closed" ? t("editClosed") : t("errorGeneric"));
    });
  }

  /**
   * After a stale answer: load the server's copy. With `keep`, the owner's unsaved changes are
   * applied on top of it (theirs win where both changed); otherwise they are dropped.
   */
  async function reload(keep: boolean) {
    await exclusive(async () => {
      const res = await api<MySubmission>(`/api/submissions/${sub.id}`);
      if (!res.ok) {
        if (res.status === 404) onGone();
        else setMessage(res.status === 0 ? t("verifyNetwork") : t("errorGeneric"));
        return;
      }
      const fresh = formOf(res.data);
      const kept = keep && dirty;
      // Functional, so anything typed while the copy was loading is kept too.
      setForm((current) => (keep ? reapply(fresh, base, current) : fresh));
      setBase(fresh);
      setSub(res.data);
      setStale(false);
      setIssues([]);
      setMessage(kept ? t("editReloadedKept") : t("editReloaded"));
      refreshCheck(res.data.version);
      statusRef.current?.focus();
    });
  }

  const abstractMin = type?.abstract.minWords ?? 0;
  const abstractMax = type?.abstract.maxWords ?? 0;
  const allAgreed = config.agreements.every((a) => agreed.has(a.key));
  const cap =
    sub.status === "withdrawn" || sub.status === "rejected" ? null : check?.data.presenterCap;
  const capOver = cap ? cap.count > cap.max : false;
  // Server findings describe the saved text: drop them for text changed since (live hints cover it).
  const serverSelfId =
    check && check.version === sub.version
      ? check.data.selfIdentification.filter((w) => !changed.has(w.path))
      : [];
  const longBios = (check?.data.longBios?.length ?? 0) > 0 ? config.rules.bio?.maxWords : undefined;
  const locked = busy || stale;

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
      <Deadline config={config} open={conf.callOpen} />
      {!editable && <p className="notice">{conf.callOpen ? t("editReadOnly") : t("editClosed")}</p>}
      {stale && (
        <StalePanel
          dirty={dirty}
          busy={busy}
          onKeep={() => reload(true)}
          onDiscard={() => reload(false)}
        />
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
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
        <SelfIdPanel warnings={[...live, ...serverSelfId]} />

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
                <span>{t(modeKey(m))}</span>
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
          <button type="submit" disabled={locked || !dirty}>
            {sub.status === "draft" ? t("editSaveDraft") : t("editSaveChanges")}
          </button>
        )}
        {dirty && <p className="meta">{t("editUnsaved")}</p>}
      </form>

      <People
        sub={sub}
        config={config}
        editable={editable}
        locked={locked}
        run={exclusive}
        onChange={(s) => {
          setSub(s);
          refreshCheck(s.version);
        }}
        onIssues={setIssues}
        onStale={() => setStale(true)}
      />

      {cap && (
        <p className={capOver ? "notice" : "meta"}>
          {sub.status === "draft"
            ? t(capOver ? "capOverDraft" : "capNoteDraft", cap)
            : t(capOver ? "capOver" : "capNote", cap)}
        </p>
      )}
      {check && check.data.missingBios.length > 0 && <p className="meta">{t("missingBios")}</p>}
      {longBios !== undefined && <p className="meta">{t("longBios", { max: longBios })}</p>}

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
                    <a className="block-link" href={a.url} target="_blank" rel="noreferrer">
                      {t("editRead")}
                    </a>
                  )}
                </div>
              ))}
            </fieldset>
          )}
          <button type="button" disabled={locked || !allAgreed} onClick={submit}>
            {t("editSubmit")}
          </button>
          <button type="button" className="secondary" disabled={locked} onClick={remove}>
            {t("editDelete")}
          </button>
        </section>
      )}
      {editable && sub.status === "submitted" && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={locked}
            onClick={() => simple("/unsubmit", t("editSaved"))}
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
            disabled={locked}
            onClick={() => simple("/withdraw", t("status_withdrawn"), t("editWithdrawConfirm"))}
          >
            {t("editWithdraw")}
          </button>
        </div>
      )}
      <p>
        <Link className="block-link" to={`/${lang}/my`}>
          {t("navMySubmissions")}
        </Link>
      </p>
    </article>
  );
}

/** Shown when a save or action was refused as stale. The form and its unsaved text stay. */
function StalePanel({
  dirty,
  busy,
  onKeep,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div className="notice stack wide" tabIndex={-1} ref={ref}>
      <p role="alert">
        {t("editStale")} {dirty ? t("editStaleDirty") : ""}
      </p>
      {dirty ? (
        <>
          <button type="button" disabled={busy} onClick={onKeep}>
            {t("editStaleKeep")}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={onDiscard}>
            {t("editStaleDiscard")}
          </button>
        </>
      ) : (
        <button type="button" disabled={busy} onClick={onDiscard}>
          {t("editReload")}
        </button>
      )}
    </div>
  );
}

function People({
  sub,
  config,
  editable,
  locked,
  run,
  onChange,
  onIssues,
  onStale,
}: {
  sub: MySubmission;
  config: ConferenceConfig;
  editable: boolean;
  /** A request is pending or the copy is stale: controls stay focusable but do nothing. */
  locked: boolean;
  run: Exclusive;
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
  const emailRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const people = useMemo(
    () => [...sub.contributors].sort((a, b) => a.position - b.position),
    [sub.contributors],
  );
  // aria-disabled rather than disabled, so focus stays on the control that was used.
  const lockedAttr = locked ? ("true" as const) : undefined;

  async function act(
    path: string,
    method: string,
    body: Record<string, unknown>,
    ok: string,
  ): Promise<boolean> {
    if (locked) return false;
    const done = await run(async () => {
      const res = await api<MySubmission>(`/api/submissions/${sub.id}${path}`, {
        method,
        body: { version: sub.version, ...body },
      });
      if (res.ok) {
        if (res.status !== 204 && res.data) onChange(res.data);
        setStatus(ok);
        onIssues([]);
      } else if (res.error === "stale") onStale();
      else if (res.issues.length) onIssues(res.issues);
      else
        setStatus(
          res.error === "rate_limited"
            ? t("signInRateLimited")
            : res.error === "call_closed"
              ? t("editClosed")
              : t("errorGeneric"),
        );
      return res.ok;
    });
    return done === true;
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
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
      // "Send invitation" is disabled once the field is empty: focus goes back to the field,
      // ready for the next address, instead of being lost.
      emailRef.current?.focus();
    }
  }

  /** The card goes away: focus moves to the status line, which names who was removed. */
  async function remove(c: Contributor, who: string) {
    const ok = await act(
      `/contributors/${c.personId}`,
      "DELETE",
      {},
      t("editRemoved", { name: who }),
    );
    if (ok) statusRef.current?.focus();
  }

  return (
    <section aria-labelledby="people-heading" className="stack wide">
      <h2 id="people-heading">{t("editPeople")}</h2>
      <ol className="people" id={fieldId("contributions")} tabIndex={-1}>
        {people.map((c: Contributor, i) => {
          const who = c.displayName ?? c.email ?? "—";
          const named = (action: string) => t("editActionFor", { action, name: who });
          return (
            <li key={c.personId} className="card">
              <p>
                <strong>{who}</strong>
                {c.isOwner && <span className="meta"> ({t("editOwnerNote")})</span>}
                <br />
                <span className="meta">{[c.affiliation, c.email].filter(Boolean).join(" · ")}</span>
              </p>
              <p>
                <span className="badge">{t(contribStatusKey(c.status))}</span>
              </p>
              {editable && (
                <div className="actions">
                  <select
                    aria-label={named(t("editRole"))}
                    aria-disabled={lockedAttr}
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
                        {t(roleKey(r))}
                      </option>
                    ))}
                  </select>
                  {i > 0 && (
                    <button
                      type="button"
                      className="secondary"
                      aria-label={named(t("editMoveUp"))}
                      aria-disabled={lockedAttr}
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
                      aria-label={named(t("editMoveDown"))}
                      aria-disabled={lockedAttr}
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
                      aria-label={named(t("editResend"))}
                      aria-disabled={lockedAttr}
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
                      aria-label={named(t("editRemove"))}
                      aria-disabled={lockedAttr}
                      onClick={() => remove(c, who)}
                    >
                      {t("editRemove")}
                    </button>
                  )}
                </div>
              )}
              {!editable && <p className="meta">{t(roleKey(c.role))}</p>}
            </li>
          );
        })}
      </ol>
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {status}
      </p>
      {editable && (
        <form onSubmit={invite} className="stack" noValidate>
          <h3>{t("editInvite")}</h3>
          <label htmlFor={fieldId("email")}>{t("editEmail")}</label>
          <input
            id={fieldId("email")}
            ref={emailRef}
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
                {t(roleKey(r))}
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
          <button type="submit" disabled={!email.trim()} aria-disabled={lockedAttr}>
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

/** What co-authors, invitees and chairs see: the proposal, and the person's own choices. */
function ReadOnly({
  sub,
  conf,
  needsName,
  onChanged,
}: {
  sub: MySubmission;
  conf: ConfInfo;
  /** The person's profile has no name yet: confirming asks for one. */
  needsName: boolean;
  onChanged: () => void;
}) {
  const { lang, t } = useT();
  const config = conf.config;
  const [agreed, setAgreed] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  /** Missing, or refused by the server as written. */
  const [nameError, setNameError] = useState<"required" | "invalid" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Repeat taps while a request is on its way do nothing (the buttons stay focusable). */
  const inFlight = useRef(false);
  /** After declining or leaving, the person can no longer see the proposal: a final state. */
  const [done, setDone] = useState<"declined" | "left" | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyAttr = busy ? ("true" as const) : undefined;
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey);
  const people = [...sub.contributors].sort((a, b) => a.position - b.position);
  const withdrawn = sub.status === "withdrawn";
  // Confirming needs an open call and live work; declining and leaving are always possible.
  const canConfirm = conf.callOpen && !withdrawn;

  /** Say what happened in the status line and move focus there (the buttons may go away). */
  function announce(text: string) {
    setMessage(text);
    statusRef.current?.focus();
  }

  function finish(final: "declined" | "left") {
    setDone(final);
    announce(final === "declined" ? t("invDeclined") : t("invLeft"));
  }

  function refuseName(problem: "required" | "invalid") {
    setNameError(problem);
    setMessage(
      problem === "required" ? t("invNameRequired") : t("invNameInvalid", { max: LIMITS.name }),
    );
    nameRef.current?.focus();
  }

  /** One request at a time: a repeat tap while one is on its way does nothing. */
  async function exclusive<T>(work: () => Promise<T>): Promise<T | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      return await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function answer(a: "confirm" | "decline") {
    if (inFlight.current) return;
    const confirm = a === "confirm";
    const displayName = cleanName(name);
    if (confirm && needsName && !displayName) return refuseName("required");
    const res = await exclusive(() =>
      api<{ answer: string }>(`/api/me/invitations/${sub.id}/answer`, {
        method: "POST",
        body: {
          answer: a,
          acceptedAgreements: confirm
            ? config.agreements
                .filter((x) => agreed.has(x.key))
                .map((x) => ({ key: x.key, version: x.version }))
            : [],
          ...(confirm && needsName ? { displayName } : {}),
        },
      }),
    );
    if (!res) return;
    if (res.ok) {
      if (!confirm) return finish("declined");
      // Confirm and the form go away when the proposal reloads: focus stays with the outcome.
      announce(t("invConfirmedInApp"));
      onChanged();
      return;
    }
    const nameProblem = nameRefusal(res.issues);
    if (nameProblem) refuseName(nameProblem);
    else if (res.issues.length) setMessage(t("issue_agreements_required"));
    else if (res.error === "call_closed")
      setMessage(withdrawn ? t("invWithdrawn") : t("invClosed"));
    else if (res.error === "already_answered") onChanged();
    else if (res.status === 429) setMessage(t("signInRateLimited"));
    else setMessage(res.status === 0 ? t("verifyNetwork") : t("errorGeneric"));
  }

  async function leave() {
    if (inFlight.current || !window.confirm(t("editLeaveConfirm"))) return;
    const res = await exclusive(() =>
      api(`/api/submissions/${sub.id}/leave`, { method: "POST", body: {} }),
    );
    if (!res) return;
    if (res.ok) finish("left");
    else setMessage(res.status === 0 ? t("verifyNetwork") : t("errorGeneric"));
  }

  return (
    <article>
      <PageHeading title={sub.title || t("editUntitled")}>
        {sub.title || t("editUntitled")}
      </PageHeading>
      {!done && (
        <>
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
          <p className="notice">
            {sub.view === "invitee" ? t("editInviteeIntro") : t("editReadOnly")}
          </p>
          <h2>{type ? localize(type.abstract.label, lang, config.defaultLanguage) : "Abstract"}</h2>
          <p className="prose" lang={sub.language}>
            {sub.abstract}
          </p>
          <h2>{t("editPeople")}</h2>
          <ul>
            {people.map((c) => (
              <li key={c.personId}>
                {c.displayName ?? c.email ?? "—"} · {t(roleKey(c.role))} ·{" "}
                {t(contribStatusKey(c.status))}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
      {done ? (
        <p>
          <Link className="block-link" to={`/${lang}/my`}>
            {t("navMySubmissions")}
          </Link>
        </p>
      ) : (
        <>
          {sub.view === "invitee" && (
            <div className="stack wide">
              {!canConfirm && (
                <p className="notice">{withdrawn ? t("invWithdrawn") : t("invClosed")}</p>
              )}
              {canConfirm && needsName && (
                <>
                  <label htmlFor="inv-name">{`${t("invYourName")} *`}</label>
                  <p className="meta" id="inv-name-help">
                    {t("invNameHelp")}
                  </p>
                  <input
                    id="inv-name"
                    ref={nameRef}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    autoComplete="name"
                    maxLength={LIMITS.name}
                    aria-required="true"
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? "inv-name-help inv-name-error" : "inv-name-help"}
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
              {canConfirm && config.agreements.length > 0 && (
                <fieldset>
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
                          {t("editAgree", {
                            title: localize(a.title, lang, config.defaultLanguage),
                          })}
                        </span>
                      </label>
                      {a.url && (
                        <a className="block-link" href={a.url} target="_blank" rel="noreferrer">
                          {t("editRead")}
                        </a>
                      )}
                    </div>
                  ))}
                </fieldset>
              )}
              {/* aria-disabled while a request is on its way, so focus stays on the button. */}
              {canConfirm && (
                <button
                  type="button"
                  disabled={!config.agreements.every((a) => agreed.has(a.key))}
                  aria-disabled={busyAttr}
                  onClick={() => answer("confirm")}
                >
                  {t("editConfirm")}
                </button>
              )}
              <button
                type="button"
                className="secondary"
                aria-disabled={busyAttr}
                onClick={() => answer("decline")}
              >
                {t("editDecline")}
              </button>
            </div>
          )}
          {sub.view === "submitter" && (
            <button type="button" className="secondary" aria-disabled={busyAttr} onClick={leave}>
              {t("editLeave")}
            </button>
          )}
        </>
      )}
    </article>
  );
}
