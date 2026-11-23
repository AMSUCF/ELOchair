import type { BlindMode, ConferenceConfig } from "@elochair/schema";
import {
  ANSWER_WORDS,
  type ConfigChange,
  configChanges,
  DECLINE_REASON_WORDS,
  fillMessage,
  isMailLanguage,
  localize,
  type MailLang,
  type MailMessageKey,
  MESSAGE_KEYS,
  MESSAGES,
  type MessagePlaceholder,
  REVIEW_EMAILS,
  ROLE_WORDS,
  type Setting,
  type SettingId,
  stageOneSettings,
  withSetting,
} from "@elochair/schema/pure";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useBlocker, useParams } from "react-router";
import { type ApiResult, api, type Issue, type Me } from "../api";
import { sampleValues } from "../emailPreview";
import { formatDateTime, viewerTimeZone } from "../format";
import { describedBy, ErrorSummary, FieldError, fieldId, RestoredNotice } from "../forms";
import { isMessageKey, LANG_NAMES, type MessageKey, useT } from "../i18n";
import {
  blindChoiceKey,
  deadlineKey,
  emailNameKey,
  emailWhenKey,
  modalityKey,
  ownModeKey,
  placeholderKey,
} from "../labels";
import {
  DATETIME,
  type Edits,
  editsAfterSave,
  emailText,
  parts,
  type Raw,
  rawOf,
  restoredEdits,
  typedText,
} from "../settingsEdits";
import { Localized, PageHeading } from "../ui";
import { useUnsaved } from "../useUnsaved";

/*
 * Conference settings for chairs (spec 02, §1.9). The screen shows the stage-one values
 * (stageOneSettings): existing values, and the wording of the emails the app sends, whether the
 * conference has written its own or not, in the three languages mail goes out in; the same for
 * every chair. Formats, fields, languages, review pools, criteria, agreements and the ways to
 * contribute are added or removed by importing a configuration, and the page says so. It keeps
 * what was typed apart from the configuration, and saves nothing that has not been reviewed:
 * the server says what a save would change, what is wrong with it, what it would do to
 * submitted work, and only then offers "Save changes".
 *
 * What was typed and not saved is also kept in this browser (unsaved.ts), as in the proposal
 * editor, so that a reload or a closed tab does not lose a long round of changes.
 */

type SettingsData = {
  slug: string;
  phase: string;
  callOpen: boolean;
  config: ConferenceConfig;
  /** Names the configuration these settings were read from; a save is based on it. */
  token: string;
};

/** The server's answer to "what would saving this do?" (ConfigReview in the server). */
type Review = {
  token: string;
  stale: boolean;
  issues: { path: string; code: string; params?: Record<string, string | number> }[];
  changes: ConfigChange[];
  blocked: { count: number; byCode: Record<string, number>; submissionIds: string[] } | null;
  warnings: { drafts: number; callOpens: boolean; callCloses: boolean; pastDeadlines: string[] };
  canSave: boolean;
};

/** The label of each setting. A setting without one fails the typecheck. */
const LABELS: Record<SettingId, MessageKey> = {
  title: "settingsLabel_title",
  theme: "settingsLabel_theme",
  distinction: "settingsLabel_distinction",
  invitation: "settingsLabel_invitation",
  host: "settingsLabel_host",
  location: "settingsLabel_location",
  modality: "settingsLabel_modality",
  contactEmail: "settingsLabel_contactEmail",
  website: "settingsLabel_website",
  "dates.start": "settingsLabel_dates_start",
  "dates.end": "settingsLabel_dates_end",
  placeholder: "settingsLabel_placeholder",
  "deadlines.submissionsOpen": "deadline_submissionsOpen",
  "deadlines.submissionsClose": "deadline_submissionsClose",
  "deadlines.reviewsDue": "deadline_reviewsDue",
  "deadlines.notification": "deadline_notification",
  "deadlines.finalMaterials": "deadline_finalMaterials",
  "rules.presenterCap.max": "settingsLabel_rules_presenterCap_max",
  "rules.bio.maxWords": "settingsLabel_rules_bio_maxWords",
  "rules.reviewReminderDays": "settingsLabel_rules_reviewReminderDays",
  "type.name": "settingsLabel_type_name",
  "type.description": "settingsLabel_type_description",
  "type.abstract.label": "settingsLabel_type_abstract_label",
  "type.abstract.minWords": "settingsLabel_type_abstract_minWords",
  "type.abstract.maxWords": "settingsLabel_type_abstract_maxWords",
  "type.durationMinutes": "settingsLabel_type_durationMinutes",
  "type.team.min": "settingsLabel_type_team_min",
  "type.team.max": "settingsLabel_type_team_max",
  "field.label": "settingsLabel_field_label",
  "field.help": "settingsLabel_field_help",
  "field.required": "settingsLabel_field_required",
  "field.maxWords": "settingsLabel_field_maxWords",
  "field.min": "settingsLabel_field_min",
  "field.max": "settingsLabel_field_max",
  "field.integer": "settingsLabel_field_integer",
  "pool.name": "settingsLabel_pool_name",
  "pool.blindMode": "settingsLabel_pool_blindMode",
  "pool.reviewsPerSubmission": "settingsLabel_pool_reviewsPerSubmission",
  "pool.guidelines": "settingsLabel_pool_guidelines",
  "criterion.label": "settingsLabel_criterion_label",
  "criterion.description": "settingsLabel_criterion_description",
  "criterion.min": "settingsLabel_criterion_min",
  "criterion.max": "settingsLabel_criterion_max",
  "form.comments.description": "settingsLabel_form_comments_description",
  "form.comments.minWords": "settingsLabel_form_comments_minWords",
  "form.comments.maxWords": "settingsLabel_form_comments_maxWords",
  "form.chairNote.enabled": "settingsLabel_form_chairNote_enabled",
  "form.chairNote.description": "settingsLabel_form_chairNote_description",
  "form.recommendation.enabled": "settingsLabel_form_recommendation_enabled",
  "form.recommendation.description": "settingsLabel_form_recommendation_description",
  "message.subject": "settingsLabel_message_subject",
  "message.body": "settingsLabel_message_body",
  "agreement.title": "settingsLabel_agreement_title",
  "agreement.text": "settingsLabel_agreement_text",
  "agreement.url": "settingsLabel_agreement_url",
  "agreement.version": "settingsLabel_agreement_version",
  "other.name": "settingsLabel_other_name",
  "other.description": "settingsLabel_other_description",
  "group.name": "settingsLabel_group_name",
  "group.summary": "settingsLabel_group_summary",
  "track.name": "settingsLabel_track_name",
  "topic.label": "settingsLabel_topic_label",
};

/**
 * The invitation's two texts (the front page and the top of the conference page show them),
 * each with the hint that says where it appears. They come after the title and the theme.
 */
const INVITATION_TEXTS = [
  { id: "distinction", hint: "settingsDistinctionHint" },
  { id: "invitation", hint: "settingsInvitationHint" },
] as const satisfies readonly { id: SettingId; hint: MessageKey }[];

/** How a pool's reviewers are shown the authors: the choices, most hidden first. */
const BLIND_MODES = ["double", "single", "open"] as const satisfies readonly BlindMode[];

/**
 * The value a control stands for. Blank is absent; a blank number that is needed is null. An
 * email's text has its own rule (typedText).
 */
function typed(s: Setting, raw: Raw): unknown {
  // A box never ticked stays absent rather than becoming an explicit "no".
  if (s.kind === "bool") return raw === true ? true : s.value === undefined ? undefined : false;
  const text = String(raw).trim();
  if (s.kind === "int" || s.kind === "number") {
    if (text === "") return s.optional ? undefined : null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return typedText(s, raw);
}

/**
 * What the three boxes of a deadline show while nothing is typed in them: the stored instant,
 * as it was written. A deadline that is optional and not set (the day reviews are due) has no
 * date; its time and its offset start at the end of the day, on the clock the day decisions are
 * sent is written on, so that typing a date is enough. They are shown, and can be changed.
 */
function deadlineBase(s: Setting, config: ConferenceConfig) {
  if (s.value !== undefined || !s.optional) return parts(s.value);
  return {
    date: "",
    time: "23:59",
    seconds: "00",
    offset: parts(config.deadlines.notification).offset,
  };
}

/**
 * A deadline as typed; undefined when none of its parts was touched; null when an optional one
 * is left without a date, which is how it is taken away. The offset is never worked out or
 * converted: it is the one shown, stored or written by the person.
 */
function composed(s: Setting, config: ConferenceConfig, edits: Edits): string | null | undefined {
  const date = edits[`${s.path}#date`];
  const time = edits[`${s.path}#time`];
  const offset = edits[`${s.path}#offset`];
  if (date === undefined && time === undefined && offset === undefined) return undefined;
  const base = deadlineBase(s, config);
  if (s.optional && String(date ?? base.date).trim() === "") return null;
  const seconds = time === undefined ? base.seconds : "00";
  return `${date ?? base.date}T${time ?? base.time}:${seconds}${String(offset ?? base.offset).trim()}`;
}

/** The configuration with what was typed put in. */
function build(config: ConferenceConfig, settings: Setting[], edits: Edits): ConferenceConfig {
  let next = config;
  for (const s of settings) {
    if (s.kind === "datetime") {
      const iso = composed(s, config, edits);
      if (iso !== undefined) next = withSetting(next, s.path, iso ?? undefined);
    } else if (edits[s.path] !== undefined) {
      next = withSetting(next, s.path, typed(s, edits[s.path] as Raw));
    }
  }
  return next;
}

/** The collapsible section a path belongs to ("submissionTypes.paper"), if it is in one. */
const sectionOf = (path: string) => {
  const [list, key] = path.split(".");
  return list === "submissionTypes" ||
    list === "reviewPools" ||
    list === "otherFormats" ||
    list === "contributionGroups" ||
    list === "messages" ||
    list === "agreements"
    ? `${list}.${key}`
    : null;
};

export function SettingsPage() {
  const { slug = "" } = useParams();
  const { t } = useT();
  const [loaded, setLoaded] = useState<ApiResult<SettingsData> | null>(null);
  /** Whose unsaved changes are kept in this browser: the person signed in. */
  const [personId, setPersonId] = useState<string | null>(null);
  const load = useCallback(() => api<SettingsData>(`/api/conferences/${slug}/settings`), [slug]);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    Promise.all([load(), api<Me>("/api/me")]).then(([r, me]) => {
      if (!live) return;
      setPersonId(me.ok && me.data.kind === "person" ? (me.data.person?.id ?? null) : null);
      setLoaded(r);
    });
    return () => {
      live = false;
    };
  }, [load]);

  if (!loaded) return <p role="status">{t("loading")}</p>;
  if (!loaded.ok) {
    if (loaded.status === 404) return <PageHeading>{t("confNotFound")}</PageHeading>;
    return (
      <>
        <PageHeading>{t("settingsTitle")}</PageHeading>
        <p role="alert">{t(loaded.status === 403 ? "settingsNoAccess" : "errorGeneric")}</p>
      </>
    );
  }
  return <SettingsForm key={slug} initial={loaded.data} personId={personId} reload={load} />;
}

function SettingsForm({
  initial,
  personId,
  reload,
}: {
  initial: SettingsData;
  personId: string | null;
  reload: () => Promise<ApiResult<SettingsData>>;
}) {
  const { lang, t } = useT();
  const [data, setData] = useState(initial);
  const { found, keep } = useUnsaved(personId, `settings:${initial.slug}`);
  /** What an earlier visit left typed and unsaved in this browser, where it is still a setting. */
  const [start] = useState(() => restoredEdits(found?.values, stageOneSettings(initial.config)));
  const [edits, setEdits] = useState<Edits>(start);
  /**
   * The edits as they are at this very moment. The form stays open to typing while a request
   * is on its way, and the answer to a save has to be set against what is typed by then.
   */
  const editsNow = useRef(edits);
  const changeEdits = (next: Edits) => {
    editsNow.current = next;
    setEdits(next);
  };
  /** Restored changes that the person has not saved or discarded yet. */
  const [restored, setRestored] = useState(false);
  /** The server's review, and the exact configuration it was a review of. */
  const [review, setReview] = useState<{ of: string; result: Review } | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // A section that holds a restored change starts open: it is not to be saved unseen.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        Object.keys(start).flatMap((key) => {
          const section = sectionOf(key.split("#")[0] ?? "");
          return section ? [section] : [];
        }),
      ),
  );
  const inFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);

  const config = data.config;
  const settings = useMemo(() => stageOneSettings(config), [config]);
  const built = useMemo(() => build(config, settings, edits), [config, settings, edits]);
  const unsaved = useMemo(() => configChanges(config, built).length, [config, built]);
  const dirty = unsaved > 0;
  const builtKey = useMemo(() => JSON.stringify(built), [built]);
  // A review of something else (the form was edited since) is no review of this.
  const shown = review && review.of === builtKey ? review.result : null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Said after the first render, so that the notice is announced.
  useEffect(() => {
    if (Object.keys(start).length > 0) setRestored(true);
  }, [start]);

  // What is typed and would change something is kept in this browser; once nothing would
  // change (saved, taken back, discarded), nothing is kept.
  useEffect(() => {
    keep(dirty ? edits : {}, null);
  }, [keep, dirty, edits]);

  // In-app navigation asks before unsaved changes are lost, as in the proposal editor.
  // Switching the interface language keeps the page, so it is not blocked.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, "") !==
        nextLocation.pathname.replace(/^\/[a-z]{2}(?=\/|$)/, ""),
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(t("editLeaveUnsaved"))) blocker.proceed();
    else blocker.reset();
  }, [blocker, t]);

  // The review is new content below the form: its heading takes focus when it arrives.
  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);

  const say = (text: string) => {
    setMessage(text);
    statusRef.current?.focus();
  };

  const set = (path: string, raw: Raw, stored: Raw) => {
    setMessage("");
    const next = { ...editsNow.current };
    if (raw === stored) delete next[path];
    else next[path] = raw;
    changeEdits(next);
  };

  /** One request at a time: a second tap while one is on its way does nothing. */
  async function exclusive(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const based = { "If-Match": `"${data.token}"` };

  /**
   * Problems the server found are shown beside their values (the summary takes focus), in open
   * sections. Says whether there were any.
   */
  function showIssues(found: Issue[]): boolean {
    setIssues(
      found.map((i) => ({
        path: i.path,
        code: `settings_${i.code}`,
        ...(i.params ? { params: i.params } : {}),
      })),
    );
    setOpen((current) => {
      const next = new Set(current);
      for (const i of found) {
        const section = sectionOf(i.path);
        if (section) next.add(section);
      }
      return next;
    });
    return found.length > 0;
  }

  function reviewChanges(e: FormEvent) {
    e.preventDefault();
    if (!dirty) {
      setIssues([]);
      return say(t("settingsNothingChanged"));
    }
    return exclusive(async () => {
      setMessage("");
      const res = await api<Review>(`/api/conferences/${data.slug}/config/preview`, {
        method: "POST",
        body: built,
        headers: based,
      });
      if (!res.ok) return say(t(res.status === 403 ? "settingsNoAccess" : "errorGeneric"));
      setStale(res.data.stale);
      const found = showIssues(res.data.issues);
      setReview(found ? null : { of: builtKey, result: res.data });
    });
  }

  function save() {
    if (!shown?.canSave) return;
    // What is sent is what was reviewed. The form stays open meanwhile: see editsAfterSave.
    const sent = edits;
    return exclusive(async () => {
      const res = await api<{ config: ConferenceConfig; token: string }>(
        `/api/conferences/${data.slug}/config`,
        { method: "PUT", body: built, headers: based },
      );
      if (res.ok) {
        // The saved configuration is the new base. Whatever was typed while the save was on
        // its way stays in the form as an unsaved change to it, to be reviewed in its turn.
        // The browser's buffer follows the form: once this is saved it keeps only what is left.
        const saved = res.data.config;
        const now = stageOneSettings(saved);
        const typedSince = editsNow.current !== sent;
        const left = editsAfterSave(sent, editsNow.current, settings, now);
        const more = configChanges(saved, build(saved, now, left)).length > 0;
        setData({ ...data, config: saved, token: res.data.token });
        changeEdits(left);
        // What an earlier visit left was reviewed and saved; what is left was typed just now.
        setRestored(false);
        setReview(null);
        setIssues([]);
        const text = t(more ? "settingsSavedMore" : "settingsSaved");
        // Someone who is typing is not taken out of the form: the status line is a live region.
        return typedSince ? setMessage(text) : say(text);
      }
      if (res.status === 409 && res.error === "stale") {
        setStale(true);
        setReview(null);
        return;
      }
      // A reviewer was assigned between the review and the save, and a value would now show
      // them the authors of an anonymized proposal; or a review was sent, and a value would now
      // leave it outside its form: said beside that value, as a review of the changes would.
      // (An agreement reworded under its old version is refused the same way; the review has
      // always said so first, so this answer is only ever seen by another client.)
      if (res.status === 409 && res.issues.length > 0) {
        showIssues(res.issues);
        setReview(null);
        return;
      }
      // A proposal was submitted between the review and the save: show what it changes.
      if (res.status === 409 && res.error === "submitted_work_invalid") {
        const blocked = res.body?.blocked as Review["blocked"];
        setReview({ of: builtKey, result: { ...shown, blocked, canSave: false } });
        // Typed in since: that review is of something else and is not shown. Say so instead.
        if (JSON.stringify(build(config, settings, editsNow.current)) !== builtKey) {
          setMessage(t("settingsNotSaved"));
        }
        return;
      }
      say(t(res.status === 403 ? "settingsNoAccess" : "errorGeneric"));
    });
  }

  /** Back to the saved settings. The notice goes away: focus moves to the line that says so. */
  function discardRestored() {
    changeEdits({});
    setRestored(false);
    setReview(null);
    setIssues([]);
    say(t("unsavedDiscarded"));
  }

  function reloadSettings() {
    return exclusive(async () => {
      const res = await reload();
      if (!res.ok) return say(t("errorGeneric"));
      // What was typed stays: it is kept apart from the configuration, by path.
      setData(res.data);
      setStale(false);
      setReview(null);
      setIssues([]);
      say(t("settingsReloaded"));
    });
  }

  const text = (value: Record<string, string>) => localize(value, lang, config.defaultLanguage);
  const label = (s: Setting) =>
    s.lang
      ? t("settingsInLanguage", {
          label: t(LABELS[s.id]),
          language: LANG_NAMES[s.lang as keyof typeof LANG_NAMES] ?? s.lang,
        })
      : t(LABELS[s.id]);

  /** A value's full name ("Paper · Most words in the abstract"), for the summary and the review. */
  const nameOf = (path: string): string => {
    const s = settings.find((x) => x.path === path);
    if (!s) return path;
    const [list, key, , innerKey] = path.split(".");
    const context: string[] = [];
    if (list === "submissionTypes") {
      const type = config.submissionTypes.find((x) => x.key === key);
      if (type) context.push(text(type.name));
      const field = s.id.startsWith("field.") && type?.fields.find((f) => f.key === innerKey);
      if (field) context.push(text(field.label));
    } else if (list === "reviewPools") {
      const pool = config.reviewPools.find((x) => x.key === key);
      if (pool) context.push(text(pool.name));
      const criterion =
        s.id.startsWith("criterion.") && pool?.criteria.find((k) => k.key === innerKey);
      if (criterion) context.push(text(criterion.label));
    } else if (list === "otherFormats") {
      const other = config.otherFormats.find((x) => x.key === key);
      if (other) context.push(text(other.name));
    } else if (list === "contributionGroups") {
      const group = config.contributionGroups.find((x) => x.key === key);
      if (group) context.push(text(group.name));
    } else if (list === "tracks") {
      const track = config.tracks.find((x) => x.key === key);
      if (track) context.push(text(track.name));
    } else if (list === "topics") {
      const topic = config.topics.find((x) => x.key === key);
      if (topic) context.push(text(topic.label));
    } else if (list === "messages") {
      const email = MESSAGE_KEYS.find((x) => x === key);
      if (email) context.push(t(emailNameKey(email)));
    } else if (list === "agreements") {
      const agreement = config.agreements.find((x) => x.key === key);
      if (agreement) context.push(text(agreement.title));
    }
    return [...context, label(s)].join(" · ");
  };

  const show = (path: string, value: unknown): string => {
    if (value === undefined || value === null || value === "") {
      // An email's text that the conference has not written is the standard text, not nothing.
      const standard = settings.find((s) => s.path === path)?.standard !== undefined;
      return t(standard ? "settingsStandardText" : "settingsEmpty");
    }
    // A deadline: the instant in the conference's time zone, and the text as it is stored.
    if (path.startsWith("deadlines.") && typeof value === "string" && DATETIME.test(value)) {
      return t("settingsInstant", {
        when: formatDateTime(value, lang, config.timezone),
        tz: config.timezone,
        stored: value,
      });
    }
    if (typeof value === "boolean") return t(value ? "settingsYes" : "settingsNo");
    if (path === "modality" && (value === "online" || value === "in_person" || value === "hybrid"))
      return t(modalityKey(value));
    const mode = BLIND_MODES.find((m) => m === value);
    if (mode && settings.some((s) => s.path === path && s.kind === "blindMode"))
      return t(blindChoiceKey(mode));
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  };

  /** `sharedHint` is the id of a hint that these controls have in common (a text's languages). */
  const controls = (list: Setting[], sharedHint?: string) =>
    list.map((s) =>
      s.kind === "datetime" ? (
        <Deadline key={s.path} s={s} config={config} edits={edits} set={set} issues={issues} />
      ) : (
        <Control
          key={s.path}
          s={s}
          label={label(s)}
          raw={edits[s.path] ?? rawOf(s)}
          onChange={(raw) => set(s.path, raw, rawOf(s))}
          issues={issues}
          sharedHint={sharedHint}
        />
      ),
    );
  const under = (prefix: string) => settings.filter((s) => s.path.startsWith(prefix));
  const profile = settings.filter(
    (s) =>
      !/^(deadlines|rules|submissionTypes|reviewPools|messages|agreements|otherFormats|contributionGroups|tracks|topics)\./.test(
        s.path,
      ),
  );
  // The conference's own texts lead: its title and theme, then the invitation's two.
  const named = (s: Setting) => s.id === "title" || s.id === "theme";
  const invitationText = (s: Setting) => INVITATION_TEXTS.some((x) => x.id === s.id);
  // The days before the reminder are kept among the rules and offered among the deadlines,
  // right after the day they count back from.
  const reminderDays = (s: Setting) => s.id === "rules.reviewReminderDays";
  const rules = under("rules.").filter((s) => !reminderDays(s));
  const deadlines = settings.filter((s) => s.path.startsWith("deadlines.") || reminderDays(s));
  const emails = under("messages.");

  /**
   * What a pool's settings apply to: the formats it reviews, and any of them that has a blind
   * mode of its own, which the pool's choice does not change.
   */
  const reviewedBy = (poolKey: string): string => {
    const types = config.submissionTypes.filter((type) => type.reviewPool === poolKey);
    if (types.length === 0) return t("settingsPoolNoFormats");
    return [
      t("settingsPoolFormats", { formats: types.map((type) => text(type.name)).join(", ") }),
      ...types.flatMap((type) =>
        type.blindMode ? [t(ownModeKey(type.blindMode), { format: text(type.name) })] : [],
      ),
    ].join(" ");
  };

  /** The formats a way to contribute leads to, by their names: submitted here or not. */
  const formatsOf = (keys: string[]): string =>
    keys
      .flatMap((key) => {
        const format =
          config.submissionTypes.find((x) => x.key === key) ??
          config.otherFormats.find((x) => x.key === key);
        return format ? [text(format.name)] : [];
      })
      .join(", ");

  const section = (key: string, title: ReactNode, body: ReactNode) => (
    <details
      key={key}
      // A section with a problem in it stays open, so that the summary's links can reach it.
      open={open.has(key) || issues.some((i) => sectionOf(i.path) === key)}
      onToggle={(e) => {
        const isOpen = e.currentTarget.open;
        setOpen((current) => {
          if (current.has(key) === isOpen) return current;
          const next = new Set(current);
          if (isOpen) next.add(key);
          else next.delete(key);
          return next;
        });
      }}
    >
      <summary>{title}</summary>
      <div className="stack wide">{body}</div>
    </details>
  );

  const reasons = shown?.blocked
    ? Object.entries(shown.blocked.byCode).map(([code, n]) => {
        const key = `issueLabel_${code}`;
        return t("settingsBlockedReason", { label: isMessageKey(key) ? t(key) : code, n });
      })
    : [];
  const hidden = shown?.blocked ? shown.blocked.count - shown.blocked.submissionIds.length : 0;
  /** The agreements this save gives a new version, each by its title in quotation marks. */
  const newVersions = (shown?.changes ?? []).flatMap((c) => {
    const [list, key, leaf, more] = c.path.split(".");
    const agreement =
      list === "agreements" && leaf === "version" && more === undefined
        ? config.agreements.find((a) => a.key === key)
        : undefined;
    return agreement ? [t("settingsQuotedTitle", { title: text(agreement.title) })] : [];
  });

  return (
    <>
      <PageHeading title={t("settingsTitle")}>{t("settingsTitle")}</PageHeading>
      <p className="meta">
        <Localized text={config.title} fallback={config.defaultLanguage} />
      </p>
      <p>{t("settingsIntro")}</p>
      <p className="meta">{t("settingsScopeNote")}</p>
      <p>
        <Link className="block-link" to={`/${lang}/c/${data.slug}/manage`}>
          {t("settingsBackToManage")}
        </Link>
      </p>

      <RestoredNotice shown={restored && dirty} disabled={busy} onDiscard={discardRestored} />
      <form className="settings" onSubmit={reviewChanges} noValidate>
        <ErrorSummary issues={issues} title={t("settingsFixFirst")} where={nameOf} />

        <h2>{t("settingsSectionConference")}</h2>
        <div className="stack wide">
          {controls(profile.filter(named))}
          {INVITATION_TEXTS.map(({ id, hint }) => {
            const hintId = `${fieldId(id)}-hint`;
            return (
              <fieldset key={id}>
                <legend>{t(LABELS[id])}</legend>
                <p className="setting-hint" id={hintId}>
                  {t(hint)}
                </p>
                {controls(
                  profile.filter((s) => s.id === id),
                  hintId,
                )}
              </fieldset>
            );
          })}
          {controls(profile.filter((s) => !named(s) && !invitationText(s)))}
        </div>

        <h2>{t("settingsSectionDeadlines")}</h2>
        <p className="setting-hint" id="settings-offset-hint">
          {t("settingsDeadlineOffsetHint")}
        </p>
        <div className="stack wide">{controls(deadlines)}</div>

        {rules.length > 0 && (
          <>
            <h2>{t("settingsSectionRules")}</h2>
            <div className="stack wide">{controls(rules)}</div>
          </>
        )}

        <h2>{t("settingsSectionFormats")}</h2>
        {config.submissionTypes.map((type) =>
          section(
            `submissionTypes.${type.key}`,
            text(type.name),
            <>
              {controls(
                under(`submissionTypes.${type.key}.`).filter((s) => !s.id.startsWith("field.")),
              )}
              {type.fields.map((field) => (
                <fieldset key={field.key}>
                  <legend>{t("settingsField", { name: text(field.label) })}</legend>
                  {controls(under(`submissionTypes.${type.key}.fields.${field.key}.`))}
                </fieldset>
              ))}
            </>,
          ),
        )}

        <h2>{t("settingsSectionReview")}</h2>
        {config.reviewPools.map((pool) => {
          const at = `reviewPools.${pool.key}.`;
          const own = under(at).filter((s) => s.id.startsWith("pool."));
          const guidelinesHint = `${fieldId(`${at}guidelines`)}-hint`;
          return section(
            `reviewPools.${pool.key}`,
            text(pool.name),
            <>
              <p className="meta">{reviewedBy(pool.key)}</p>
              {controls(own.filter((s) => s.id !== "pool.guidelines"))}
              <fieldset>
                <legend>{t("settingsLabel_pool_guidelines")}</legend>
                <p className="setting-hint" id={guidelinesHint}>
                  {t("settingsGuidelinesHint")}
                </p>
                {controls(
                  own.filter((s) => s.id === "pool.guidelines"),
                  guidelinesHint,
                )}
              </fieldset>
              {pool.criteria.map((criterion) => {
                const mine = under(`${at}criteria.${criterion.key}.`);
                const described = (s: Setting) => s.id === "criterion.description";
                const hint = `${fieldId(`${at}criteria.${criterion.key}.description`)}-hint`;
                return (
                  <fieldset key={criterion.key}>
                    <legend>{t("settingsCriterion", { name: text(criterion.label) })}</legend>
                    {controls(mine.filter((s) => s.id === "criterion.label"))}
                    <p className="setting-hint" id={hint}>
                      {t("settingsCriterionDescriptionHint")}
                    </p>
                    {controls(mine.filter(described), hint)}
                    {controls(mine.filter((s) => s.id !== "criterion.label" && !described(s)))}
                  </fieldset>
                );
              })}
              {/* The fixed part of the committee's form: the chairs word it, and set its limits. */}
              <fieldset>
                <legend>{t("settingsFormTitle")}</legend>
                <p className="setting-hint">{t("settingsFormIntro")}</p>
                {(
                  [
                    ["comments", "reviewCommentsHelp", []],
                    ["chairNote", "reviewChairNoteHelp", ["form.chairNote.enabled"]],
                    ["recommendation", null, ["form.recommendation.enabled"]],
                  ] as const
                ).map(([part, standard, first]) => {
                  const mine = under(`${at}form.${part}.`);
                  const described = (s: Setting) => s.id === `form.${part}.description`;
                  const leads = (s: Setting) => (first as readonly string[]).includes(s.id);
                  const hint = `${fieldId(`${at}form.${part}.description`)}-hint`;
                  return (
                    <div key={part} className="stack wide">
                      {controls(mine.filter(leads))}
                      <p className="setting-hint" id={hint}>
                        {standard
                          ? t("settingsFormDescriptionHint", { standard: t(standard) })
                          : t("settingsFormDescriptionHintNone")}
                      </p>
                      {controls(mine.filter(described), hint)}
                      {controls(mine.filter((s) => !described(s) && !leads(s)))}
                    </div>
                  );
                })}
              </fieldset>
            </>,
          );
        })}

        {/* Every conference has these: the emails are offered in the three languages the app
            writes mail in, whichever of them are the conference's own. */}
        <h2>{t("settingsSectionEmails")}</h2>
        <p className="section-intro">{t("settingsEmailsIntro")}</p>
        <p className="setting-hint">{t("settingsEmailsNote")}</p>
        {MESSAGE_KEYS.map((key) =>
          section(
            `messages.${key}`,
            t(emailNameKey(key)),
            <Email
              emailKey={key}
              list={emails.filter((s) => s.path.startsWith(`messages.${key}.`))}
              config={config}
              edits={edits}
              set={set}
              controls={controls}
            />,
          ),
        )}

        {config.agreements.length > 0 && (
          <>
            <h2>{t("settingsSectionAgreements")}</h2>
            <p className="section-intro">{t("settingsAgreementsIntro")}</p>
            {config.agreements.map((agreement) => {
              const at = `agreements.${agreement.key}.`;
              const own = under(at);
              const textHint = `${fieldId(`${at}text`)}-hint`;
              return section(
                `agreements.${agreement.key}`,
                text(agreement.title),
                <>
                  <p className="meta">{t("settingsAgreementHint")}</p>
                  {controls(own.filter((s) => s.id === "agreement.title"))}
                  <fieldset>
                    <legend>{t("settingsLabel_agreement_text")}</legend>
                    <p className="setting-hint" id={textHint}>
                      {t("settingsAgreementTextHint")}
                    </p>
                    {controls(
                      own.filter((s) => s.id === "agreement.text"),
                      textHint,
                    )}
                  </fieldset>
                  {controls(
                    own.filter((s) => s.id === "agreement.url" || s.id === "agreement.version"),
                  )}
                </>,
              );
            })}
          </>
        )}

        {config.otherFormats.length > 0 && (
          <>
            <h2>{t("settingsSectionOther")}</h2>
            {config.otherFormats.map((other) =>
              section(
                `otherFormats.${other.key}`,
                text(other.name),
                controls(under(`otherFormats.${other.key}.`)),
              ),
            )}
          </>
        )}

        {config.contributionGroups.length > 0 && (
          <>
            <h2>{t("settingsSectionWays")}</h2>
            <p className="section-intro">{t("settingsWaysIntro")}</p>
            {config.contributionGroups.map((group) =>
              section(
                `contributionGroups.${group.key}`,
                text(group.name),
                <>
                  <p className="meta">
                    {t("settingsWayFormats", { formats: formatsOf(group.formats) })}
                  </p>
                  {controls(under(`contributionGroups.${group.key}.`))}
                </>,
              ),
            )}
          </>
        )}

        {config.tracks.length > 0 && (
          <>
            <h2>{t("settingsSectionTracks")}</h2>
            <div className="stack wide">{controls(under("tracks."))}</div>
          </>
        )}
        {config.topics.length > 0 && (
          <>
            <h2>{t("settingsSectionTopics")}</h2>
            <div className="stack wide">{controls(under("topics."))}</div>
          </>
        )}

        {stale && (
          <div className="notice stack wide" role="alert">
            <p>{t("settingsStale")}</p>
            <p className="actions">
              <button type="button" className="secondary" onClick={reloadSettings}>
                {t("settingsReload")}
              </button>
            </p>
          </div>
        )}
        {dirty && !shown && <p className="meta">{t("settingsUnsaved", { n: unsaved })}</p>}
        <p className="actions">
          {/* aria-disabled while a request is on its way, so focus stays on the button. */}
          <button
            type="submit"
            className={shown ? "secondary" : undefined}
            aria-disabled={busy ? "true" : undefined}
          >
            {t("settingsReview")}
          </button>
        </p>
      </form>

      {shown && (
        <section className="review" aria-labelledby="settings-review-title">
          <h2 id="settings-review-title" tabIndex={-1} ref={reviewRef}>
            {t("settingsReviewTitle")}
          </h2>
          <ul className="changes">
            {shown.changes.map((c) => (
              <li key={c.path}>
                <strong>{nameOf(c.path)}</strong>
                {t("settingsChangeFromTo", {
                  before: show(c.path, c.before),
                  after: show(c.path, c.after),
                })}
              </li>
            ))}
          </ul>
          {shown.blocked && (
            <div className="notice stack wide" role="alert">
              <p>{t("settingsBlocked", { count: shown.blocked.count })}</p>
              <p>{reasons.join(" · ")}</p>
              <p>{t("settingsBlockedHelp")}</p>
              {shown.blocked.submissionIds.length > 0 && (
                <ul>
                  {shown.blocked.submissionIds.map((id, i) => (
                    <li key={id}>
                      <Link className="block-link" to={`/${lang}/s/${id}`}>
                        {t("settingsBlockedOpen", { n: i + 1 })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {hidden > 0 && <p>{t("settingsBlockedHidden", { n: hidden })}</p>}
            </div>
          )}
          {newVersions.length > 0 && (
            <p className="notice">
              {t("settingsWarnNewVersion", { agreements: newVersions.join(", ") })}
            </p>
          )}
          {shown.warnings.callCloses && <p className="notice">{t("settingsWarnCloses")}</p>}
          {shown.warnings.callOpens && <p className="notice">{t("settingsWarnOpens")}</p>}
          {shown.warnings.pastDeadlines.map((key) => (
            <p className="notice" key={key}>
              {t("settingsWarnPast", { deadline: nameOf(`deadlines.${key}`) })}
            </p>
          ))}
          {shown.warnings.drafts > 0 && (
            <p className="notice">{t("settingsWarnDrafts", { n: shown.warnings.drafts })}</p>
          )}
          {shown.canSave && (
            <>
              <p className="meta">{t("settingsReviewIntro")}</p>
              <p className="actions">
                <button type="button" onClick={save} aria-disabled={busy ? "true" : undefined}>
                  {t("settingsSave")}
                </button>
              </p>
            </>
          )}
        </section>
      )}
      <p className="status-line" role="status" tabIndex={-1} ref={statusRef}>
        {message}
      </p>
    </>
  );
}

/** One value: a labelled control of the setting's kind, its hint and its problem. */
function Control({
  s,
  label,
  raw,
  onChange,
  issues,
  sharedHint,
}: {
  s: Setting;
  label: string;
  raw: Raw;
  onChange: (raw: Raw) => void;
  issues: Issue[];
  /** The id of a hint shown once for this control and its neighbours. */
  sharedHint?: string;
}) {
  const { t } = useT();
  const id = fieldId(s.path);
  const hint =
    s.id === "type.abstract.minWords"
      ? t("settingsNoMinimumHint")
      : s.kind === "blindMode"
        ? t("settingsBlindHint")
        : s.id === "agreement.url"
          ? t("settingsAgreementUrlHint")
          : s.id === "agreement.version"
            ? t("settingsAgreementVersionHint")
            : s.id === "rules.reviewReminderDays"
              ? t("settingsReminderDaysHint", {
                  days: REVIEW_EMAILS.reminderDays,
                  hour: `${REVIEW_EMAILS.dailyHour}:00`,
                })
              : s.optional && !s.lang
                ? t("settingsOptionalHint")
                : "";
  const common = {
    id,
    "aria-invalid": issues.some((i) => i.path === s.path) ? (true as const) : undefined,
    "aria-describedby": describedBy(
      s.path,
      issues,
      ...(sharedHint ? [sharedHint] : []),
      ...(hint ? [`${id}-hint`] : []),
    ),
  };
  const after = (
    <>
      {hint && (
        <p className="setting-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <FieldError path={s.path} issues={issues} />
    </>
  );

  if (s.kind === "bool") {
    return (
      <div className="stack wide">
        <label className="choice">
          <input
            type="checkbox"
            {...common}
            checked={raw === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{label}</span>
        </label>
        {after}
      </div>
    );
  }
  if (s.kind === "blindMode") {
    // The choices are sentences: each is shown whole, which a closed list on a phone cannot do.
    return (
      <fieldset id={id} tabIndex={-1}>
        <legend>{label}</legend>
        {BLIND_MODES.map((mode) => (
          <label key={mode} className="choice">
            <input
              type="radio"
              name={id}
              value={mode}
              checked={raw === mode}
              aria-invalid={common["aria-invalid"]}
              aria-describedby={common["aria-describedby"]}
              onChange={() => onChange(mode)}
            />
            <span>{t(blindChoiceKey(mode))}</span>
          </label>
        ))}
        {after}
      </fieldset>
    );
  }
  const value = String(raw);
  return (
    <div className="stack wide">
      <label htmlFor={id}>{label}</label>
      {s.kind === "longtext" ? (
        <textarea
          {...common}
          // Guidelines, emails, agreements and the invitation run to paragraphs; the other
          // long texts are a sentence or two.
          rows={
            s.id === "message.body"
              ? 8
              : s.id === "pool.guidelines" || s.id === "agreement.text" || s.id === "invitation"
                ? 6
                : 3
          }
          lang={s.lang}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : s.kind === "modality" ? (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          {(["online", "in_person", "hybrid"] as const).map((m) => (
            <option key={m} value={m}>
              {t(modalityKey(m))}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={
            s.kind === "int" || s.kind === "number" ? "number" : s.kind === "text" ? "text" : s.kind
          }
          inputMode={s.kind === "int" ? "numeric" : s.kind === "number" ? "decimal" : undefined}
          step={s.kind === "int" ? 1 : s.kind === "number" ? "any" : undefined}
          lang={s.lang}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {after}
    </div>
  );
}

/**
 * A deadline: its date, its time and its offset from UTC, each as stored. The line under them
 * says which instant that is, in the conference's time zone and in the reader's, as it is typed.
 */
function Deadline({
  s,
  config,
  edits,
  set,
  issues,
}: {
  s: Setting;
  config: ConferenceConfig;
  edits: Edits;
  set: (path: string, raw: Raw, stored: Raw) => void;
  issues: Issue[];
}) {
  const { lang, t } = useT();
  const id = fieldId(s.path);
  const stored = deadlineBase(s, config);
  const typedNow = composed(s, config, edits);
  /** An optional deadline that has no date, stored or typed: there is none. */
  const none = typedNow === null || (typedNow === undefined && s.value === undefined);
  const iso = typedNow ?? String(s.value);
  const complete = !none && DATETIME.test(iso) && Number.isFinite(Date.parse(iso));
  const mine = viewerTimeZone();
  const name = s.path.split(".")[1] as keyof ConferenceConfig["deadlines"];
  const invalid = issues.some((i) => i.path === s.path) ? (true as const) : undefined;
  const part = (which: "date" | "time" | "offset", labelKey: MessageKey, type: string) => (
    <div>
      <label htmlFor={`${id}-${which}`}>{t(labelKey)}</label>
      <input
        id={`${id}-${which}`}
        type={type}
        autoComplete="off"
        spellCheck={which === "offset" ? false : undefined}
        aria-invalid={invalid}
        // Each part says which instant it makes and, when the deadline was refused, why.
        aria-describedby={describedBy(
          s.path,
          issues,
          ...(s.optional ? [`${id}-hint`] : []),
          `${id}-when`,
          ...(which === "offset" ? ["settings-offset-hint"] : []),
        )}
        value={String(edits[`${s.path}#${which}`] ?? stored[which])}
        onChange={(e) => set(`${s.path}#${which}`, e.target.value, stored[which])}
      />
    </div>
  );
  return (
    <fieldset id={id} tabIndex={-1}>
      <legend>{t(deadlineKey(name))}</legend>
      {/* The one deadline a conference may do without: the day reviews are due. */}
      {s.optional && (
        <p className="setting-hint" id={`${id}-hint`}>
          {t("settingsReviewsDueHint")}
        </p>
      )}
      <div className="trio">
        {part("date", "settingsDeadlineDate", "date")}
        {part("time", "settingsDeadlineTime", "time")}
        {part("offset", "settingsDeadlineOffset", "text")}
      </div>
      <p className="setting-hint" id={`${id}-when`}>
        {none
          ? t("settingsDeadlineNone")
          : complete
            ? [
                `${formatDateTime(iso, lang, config.timezone)} · ${t("confConferenceTime", { tz: config.timezone })}`,
                ...(mine === config.timezone
                  ? []
                  : [`${formatDateTime(iso, lang, mine)} · ${t("confYourTime", { tz: mine })}`]),
              ].join(" — ")
            : t("settingsDeadlineIncomplete")}
      </p>
      <FieldError path={s.path} issues={issues} />
    </fieldset>
  );
}

/** The placeholders that stand for fixed words in each language, and those words. */
const WORDS = { role: ROLE_WORDS, answer: ANSWER_WORDS, reason: DECLINE_REASON_WORDS };

/**
 * One email the app sends: when it goes and to whom, what its texts may name, and its subject
 * and body in each language, with the email as it would be sent.
 */
function Email({
  emailKey,
  list,
  config,
  edits,
  set,
  controls,
}: {
  emailKey: MailMessageKey;
  /** This email's settings: a subject and a body in each language the app writes mail in. */
  list: Setting[];
  config: ConferenceConfig;
  edits: Edits;
  set: (path: string, raw: Raw, stored: Raw) => void;
  controls: (list: Setting[], sharedHint?: string) => ReactNode;
}) {
  const { t } = useT();
  const hint = `${fieldId(`messages.${emailKey}`)}-placeholders`;
  const placeholders: readonly MessagePlaceholder[] = MESSAGES[emailKey].placeholders;
  const required: readonly string[] = MESSAGES[emailKey].required;
  const bodyOnly: readonly string[] = MESSAGES[emailKey].bodyOnly;
  const names: readonly string[] = MESSAGES[emailKey].names;
  /** What a text must or must not do with a placeholder, if anything. */
  const rules = (name: string): MessageKey[] => {
    const out: MessageKey[] = [];
    if (required.includes(name)) {
      out.push(bodyOnly.includes(name) ? "settingsEmailRequiredBodyOnly" : "settingsEmailRequired");
    } else if (bodyOnly.includes(name)) out.push("settingsEmailBodyOnly");
    if (names.includes(name)) out.push("settingsEmailNameRule");
    return out;
  };
  const langs = [...new Set(list.flatMap((s) => (s.lang ? [s.lang] : [])))].filter(isMailLanguage);
  return (
    <>
      {/* The hour and the days are the server's own: the sentences that name them are told. */}
      <p className="meta">
        {t(emailWhenKey(emailKey), {
          hour: `${REVIEW_EMAILS.dailyHour}:00`,
          days: REVIEW_EMAILS.reminderDays,
        })}
      </p>
      {/* The whole list describes the two boxes of each language: the sentence and what it lists. */}
      <div className="placeholders" id={hint}>
        <p>{t("settingsEmailPlaceholders")}</p>
        <dl>
          {placeholders.map((name) => {
            const must = rules(name);
            return (
              <div key={name}>
                <dt>
                  <code>{`{${name}}`}</code>
                </dt>
                <dd>
                  <span>{t(placeholderKey(emailKey, name))}</span>
                  {/* Words the app supplies: a chair who rewords the sentence needs them. */}
                  {(name === "role" || name === "answer" || name === "reason") &&
                    langs.map((lang) => (
                      <span key={lang} lang={lang}>
                        {t("settingsEmailWords", {
                          language: LANG_NAMES[lang],
                          words: Object.values(WORDS[name][lang]).join(" · "),
                        })}
                      </span>
                    ))}
                  {must.map((key) => (
                    <strong key={key}>{t(key)}</strong>
                  ))}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {langs.map((lang) => {
        const at = (part: string) => list.find((s) => s.path.endsWith(`.${part}.${lang}`));
        const subject = at("subject");
        const body = at("body");
        return subject && body ? (
          <EmailLanguage
            key={lang}
            emailKey={emailKey}
            lang={lang}
            subject={subject}
            body={body}
            config={config}
            edits={edits}
            set={set}
            controls={controls}
            hint={hint}
          />
        ) : null;
      })}
    </>
  );
}

/**
 * An email in one language. The two boxes show what is sent: the conference's own text, or the
 * standard text while it has none. A box that holds the standard text stores nothing, so "Use
 * the standard text" puts it back in both and the customization is gone once that is saved.
 * It asks first when that would lose text typed and not saved. Below them is the email filled
 * with made-up values, as it is typed.
 */
function EmailLanguage({
  emailKey,
  lang,
  subject,
  body,
  config,
  edits,
  set,
  controls,
  hint,
}: {
  emailKey: MailMessageKey;
  lang: MailLang;
  subject: Setting;
  body: Setting;
  config: ConferenceConfig;
  edits: Edits;
  set: (path: string, raw: Raw, stored: Raw) => void;
  controls: (list: Setting[], sharedHint?: string) => ReactNode;
  /** The id of the list that says what the placeholders are. */
  hint: string;
}) {
  const { t } = useT();
  const shown = (s: Setting) => String(edits[s.path] ?? rawOf(s));
  const changed = [subject, body].some((s) => typedText(s, shown(s)) !== undefined);
  // Made up once for a stored configuration, not at every key pressed anywhere in the form.
  const values = useMemo(
    () => sampleValues(emailKey, lang, config, window.location.origin),
    [emailKey, lang, config],
  );
  /** Typed here, not saved, and not the standard text: the button would lose it for good. */
  const typedOwn = [subject, body].some(
    (s) => edits[s.path] !== undefined && typedText(s, shown(s)) !== undefined,
  );
  const toStandard = () => {
    if (typedOwn && !window.confirm(t("settingsEmailUseStandardConfirm"))) return;
    for (const s of [subject, body]) set(s.path, s.standard ?? "", rawOf(s));
  };
  return (
    <fieldset>
      <legend lang={lang}>{LANG_NAMES[lang]}</legend>
      {controls([subject, body], hint)}
      {/* Said again when it changes: after "Use the standard text", and at the first change. */}
      <p className="setting-hint" aria-live="polite">
        {t(changed ? "settingsEmailChanged" : "settingsEmailIsStandard")}
      </p>
      <p className="actions">
        {/* Always there, so that focus stays on it once it has been used. Its name says which
            email and language it is for: the page has one for each. */}
        <button
          type="button"
          className="secondary"
          aria-label={t("settingsEmailUseStandardFor", {
            email: t(emailNameKey(emailKey)),
            language: LANG_NAMES[lang],
          })}
          aria-disabled={changed ? undefined : "true"}
          onClick={() => changed && toStandard()}
        >
          {t("settingsEmailUseStandard")}
        </button>
      </p>
      <figure className="email-preview">
        <figcaption className="setting-hint">{t("settingsEmailPreview")}</figcaption>
        <dl>
          <dt>{t("settingsLabel_message_subject")}</dt>
          <dd className="email-subject" lang={lang}>
            {fillMessage(emailKey, "subject", emailText(shown(subject)), values)}
          </dd>
          <dt>{t("settingsLabel_message_body")}</dt>
          <dd className="email-body" lang={lang}>
            {fillMessage(emailKey, "body", emailText(shown(body)), values)}
          </dd>
        </dl>
      </figure>
    </fieldset>
  );
}
