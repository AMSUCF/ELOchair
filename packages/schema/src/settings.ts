import type { ConferenceConfig } from "./config";
import {
  type MailMessageKey,
  MESSAGE_KEYS,
  MESSAGE_PARTS,
  MESSAGES,
  mailLanguagesFor,
} from "./messages";

/*
 * Conference settings: the values of a configuration that the settings screen offers, and what
 * differs between two configurations. Zod-free, so that the server (which names what a save
 * changes) and the settings screen share this one definition.
 *
 * Paths name a value by keys, never by position: "submissionTypes.paper.abstract.maxWords",
 * "submissionTypes.workshop.fields.needs.label.es", "deadlines.submissionsClose",
 * "messages.invitation.subject.es".
 */

/** How a setting is edited. "int" is a whole number, "number" any number. */
export type SettingKind =
  | "text"
  | "longtext"
  | "int"
  | "number"
  | "bool"
  | "date"
  | "datetime"
  | "email"
  | "url"
  | "modality"
  | "blindMode";

type Definition = {
  /** Names the setting whatever format or field it belongs to; screens label it by this. */
  id: string;
  /**
   * "*" stands for the key of an existing format, field, track, topic, review pool or
   * criterion; "@" for a language; "#" for the key of an email the app sends (messages.ts).
   *
   * "*" walks what a configuration holds. "#" does not: the emails are a fixed list, and each
   * of their texts is offered whether or not the conference has written it. A text that is not
   * written is absent from the configuration, all the way up (no empty `messages`), and stands
   * for the standard text. Below a "#", "@" is each language the app writes mail in, not each
   * language of the conference.
   */
  pattern: string;
  kind: SettingKind;
  /** May be left empty: the value is then absent from the configuration. */
  optional?: true;
  /** For settings of a custom field: the kinds of field that have it. */
  fieldKinds?: readonly string[];
};

/**
 * Stage one: the values the settings screen offers. Everything else in a configuration (adding,
 * removing, reordering or re-keying anything; languages and the time zone; which pool reviews a
 * format, and a format's own blind mode; agreements; what kind a field is and who sees it) has
 * no screen yet. This list is what is offered, not a permission: the server lets a chair save
 * any valid configuration.
 */
const STAGE_ONE = [
  { id: "title", pattern: "title.@", kind: "text" },
  { id: "theme", pattern: "theme.@", kind: "longtext" },
  { id: "host", pattern: "host", kind: "text" },
  { id: "location", pattern: "location.@", kind: "text" },
  { id: "modality", pattern: "modality", kind: "modality" },
  { id: "contactEmail", pattern: "contactEmail", kind: "email" },
  { id: "website", pattern: "website", kind: "url", optional: true },
  { id: "dates.start", pattern: "dates.start", kind: "date" },
  { id: "dates.end", pattern: "dates.end", kind: "date" },
  { id: "placeholder", pattern: "placeholder", kind: "bool" },
  { id: "deadlines.submissionsOpen", pattern: "deadlines.submissionsOpen", kind: "datetime" },
  { id: "deadlines.submissionsClose", pattern: "deadlines.submissionsClose", kind: "datetime" },
  { id: "deadlines.notification", pattern: "deadlines.notification", kind: "datetime" },
  { id: "deadlines.finalMaterials", pattern: "deadlines.finalMaterials", kind: "datetime" },
  { id: "rules.presenterCap.max", pattern: "rules.presenterCap.max", kind: "int" },
  { id: "rules.bio.maxWords", pattern: "rules.bio.maxWords", kind: "int" },
  { id: "type.name", pattern: "submissionTypes.*.name.@", kind: "text" },
  { id: "type.description", pattern: "submissionTypes.*.description.@", kind: "longtext" },
  { id: "type.abstract.label", pattern: "submissionTypes.*.abstract.label.@", kind: "text" },
  {
    id: "type.abstract.minWords",
    pattern: "submissionTypes.*.abstract.minWords",
    kind: "int",
    optional: true,
  },
  { id: "type.abstract.maxWords", pattern: "submissionTypes.*.abstract.maxWords", kind: "int" },
  {
    id: "type.durationMinutes",
    pattern: "submissionTypes.*.durationMinutes",
    kind: "int",
    optional: true,
  },
  { id: "type.team.min", pattern: "submissionTypes.*.team.min", kind: "int" },
  { id: "type.team.max", pattern: "submissionTypes.*.team.max", kind: "int" },
  { id: "field.label", pattern: "submissionTypes.*.fields.*.label.@", kind: "text" },
  {
    id: "field.help",
    pattern: "submissionTypes.*.fields.*.help.@",
    kind: "longtext",
    optional: true,
  },
  { id: "field.required", pattern: "submissionTypes.*.fields.*.required", kind: "bool" },
  {
    id: "field.maxWords",
    pattern: "submissionTypes.*.fields.*.maxWords",
    kind: "int",
    optional: true,
    fieldKinds: ["text", "longtext"],
  },
  {
    id: "field.min",
    pattern: "submissionTypes.*.fields.*.min",
    kind: "number",
    optional: true,
    fieldKinds: ["number"],
  },
  {
    id: "field.max",
    pattern: "submissionTypes.*.fields.*.max",
    kind: "number",
    optional: true,
    fieldKinds: ["number"],
  },
  {
    id: "field.integer",
    pattern: "submissionTypes.*.fields.*.integer",
    kind: "bool",
    fieldKinds: ["number"],
  },
  { id: "pool.name", pattern: "reviewPools.*.name.@", kind: "text" },
  { id: "pool.blindMode", pattern: "reviewPools.*.blindMode", kind: "blindMode" },
  {
    id: "pool.reviewsPerSubmission",
    pattern: "reviewPools.*.reviewsPerSubmission",
    kind: "int",
  },
  {
    id: "pool.guidelines",
    pattern: "reviewPools.*.guidelines.@",
    kind: "longtext",
    optional: true,
  },
  { id: "criterion.label", pattern: "reviewPools.*.criteria.*.label.@", kind: "text" },
  { id: "criterion.min", pattern: "reviewPools.*.criteria.*.min", kind: "int" },
  { id: "criterion.max", pattern: "reviewPools.*.criteria.*.max", kind: "int" },
  { id: "message.subject", pattern: "messages.#.subject.@", kind: "text", optional: true },
  { id: "message.body", pattern: "messages.#.body.@", kind: "longtext", optional: true },
  { id: "other.name", pattern: "otherFormats.*.name.@", kind: "text" },
  { id: "other.description", pattern: "otherFormats.*.description.@", kind: "longtext" },
  { id: "track.name", pattern: "tracks.*.name.@", kind: "text" },
  { id: "topic.label", pattern: "topics.*.label.@", kind: "text" },
] as const satisfies readonly Definition[];

export type SettingId = (typeof STAGE_ONE)[number]["id"];

/** One value the settings screen offers, as it stands in a configuration. */
export type Setting = {
  path: string;
  id: SettingId;
  kind: SettingKind;
  optional: boolean;
  /** For a text: the language this value is in. */
  lang?: string;
  /** The value now; undefined when it is absent (an optional setting, or a text not written). */
  value: unknown;
  /**
   * For a text of an email: the standard text, which is what is sent while `value` is absent.
   * A control starts from it, and a text equal to it is not a value to store.
   */
  standard?: string;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hasKey = (v: unknown): v is { key: string } & Record<string, unknown> =>
  isObject(v) && typeof v.key === "string";
/** A list whose items are told apart by their keys (formats, fields, tracks, pools...). */
const isKeyed = (v: unknown): v is ({ key: string } & Record<string, unknown>)[] =>
  Array.isArray(v) && v.length > 0 && v.every(hasKey);

/**
 * Every value of a configuration that the settings screen offers, in the order of STAGE_ONE:
 * texts once per language of the conference, and the settings of each existing format, field,
 * review pool and criterion.
 * - A text is offered only in the languages the conference has: one in any other language would
 *   add a language to the conference.
 * - A setting that only some kinds of field have (most words; a number's range) is offered only
 *   on a field of such a kind, although the schema would take it on any field.
 * - A rule the conference does not have (no presenter cap, no bio rule) has no setting: adding
 *   one is not a change of value.
 * - The subject and the body of every email the app sends are offered, written or not, in all
 *   three languages the app writes mail in, the conference's main language first
 *   (mailLanguagesFor). Mail goes out in each of them whatever the conference's languages are,
 *   so here, and only here, a text is offered in a language the conference may not have. One
 *   that is not written has no value and stands for its `standard`.
 */
export function stageOneSettings(config: ConferenceConfig): Setting[] {
  const out: Setting[] = [];
  for (const def of STAGE_ONE as readonly Definition[]) {
    const emit = (path: string[], value: unknown, lang?: string, standard?: string) =>
      out.push({
        path: path.join("."),
        id: def.id as SettingId,
        kind: def.kind,
        optional: def.optional ?? false,
        ...(lang ? { lang } : {}),
        value,
        ...(standard === undefined ? {} : { standard }),
      });
    /** `email` is the message the walk is inside, once it has passed a "#". */
    const walk = (
      node: unknown,
      tokens: string[],
      path: string[],
      email?: MailMessageKey,
    ): void => {
      const [head, ...rest] = tokens;
      if (head === undefined) {
        emit(path, node);
        return;
      }
      if (head === "@") {
        const text = (lang: string) => (isObject(node) ? node[lang] : undefined);
        const part = MESSAGE_PARTS.find((p) => p === path.at(-1));
        if (!email) {
          for (const lang of config.languages) emit([...path, lang], text(lang), lang);
        } else if (part) {
          // An email is written in the languages the app writes mail in, and has a standard text.
          for (const lang of mailLanguagesFor(config.defaultLanguage)) {
            emit([...path, lang], text(lang), lang, MESSAGES[email].standard[lang][part]);
          }
        }
        return;
      }
      if (head === "#") {
        for (const key of MESSAGE_KEYS) {
          walk(isObject(node) ? node[key] : undefined, rest, [...path, key], key);
        }
        return;
      }
      if (head === "*") {
        if (!Array.isArray(node)) return;
        for (const item of node) {
          if (!hasKey(item)) continue;
          const last = !rest.includes("*");
          if (last && def.fieldKinds && "kind" in item && !def.fieldKinds.includes(`${item.kind}`))
            continue;
          walk(item, rest, [...path, item.key]);
        }
        return;
      }
      // A missing parent (no bio rule) has no settings; a missing text or leaf is just absent.
      // The emails are the exception: each is offered although nothing is written for it, so
      // the walk goes on to them, and inside one, through what the configuration does not hold.
      const offeredAbsent = email !== undefined || rest[0] === "#";
      const next = isObject(node) ? node[head] : undefined;
      if (!offeredAbsent) {
        if (!isObject(node)) return;
        if (rest.length > 0 && rest[0] !== "@" && next == null) return;
      }
      walk(next, rest, [...path, head], email);
    };
    walk(config, def.pattern.split("."), []);
  }
  return out;
}

/**
 * The keys of two objects in an order that respects both (each is in the schema's order, with
 * its optional keys left out), so that changes are listed in the order of the configuration.
 */
function mergedKeys(xs: string[], ys: string[]): string[] {
  const out: string[] = [];
  let from = 0;
  for (const y of ys) {
    const at = xs.indexOf(y, from);
    if (at >= 0) {
      out.push(...xs.slice(from, at + 1));
      from = at + 1;
    } else if (!xs.includes(y)) out.push(y);
  }
  out.push(...xs.slice(from));
  return [...new Set(out)];
}

/** One value that differs between two configurations. A missing side means it was absent. */
export type ConfigChange = { path: string; before?: unknown; after?: unknown };

/**
 * What differs between two configurations, value by value. Items of keyed lists are matched by
 * key; a list whose keys differ (something added, removed or moved) is itself one change, at
 * the list's path, with the two key orders as its values.
 */
export function configChanges(before: unknown, after: unknown): ConfigChange[] {
  const out: ConfigChange[] = [];
  const walk = (a: unknown, b: unknown, path: string[]): void => {
    const objects = (a === undefined || isObject(a)) && (b === undefined || isObject(b));
    if (objects && (isObject(a) || isObject(b))) {
      const x = (a ?? {}) as Record<string, unknown>;
      const y = (b ?? {}) as Record<string, unknown>;
      for (const key of mergedKeys(Object.keys(x), Object.keys(y))) {
        walk(x[key], y[key], [...path, key]);
      }
      return;
    }
    const listable = (v: unknown) =>
      v === undefined || isKeyed(v) || (Array.isArray(v) && !v.length);
    if (listable(a) && listable(b) && (isKeyed(a) || isKeyed(b))) {
      const x = isKeyed(a) ? a : [];
      const y = isKeyed(b) ? b : [];
      const keys = (list: { key: string }[]) => list.map((item) => item.key);
      if (JSON.stringify(keys(x)) !== JSON.stringify(keys(y))) {
        out.push({ path: path.join("."), before: keys(x), after: keys(y) });
      }
      for (const item of x) {
        const other = y.find((o) => o.key === item.key);
        if (other) walk(item, other, [...path, item.key]);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({
        path: path.join("."),
        ...(a === undefined ? {} : { before: a }),
        ...(b === undefined ? {} : { after: b }),
      });
    }
  };
  walk(before, after, []);
  return out;
}

const step = (node: unknown, token: string): unknown =>
  Array.isArray(node)
    ? node.find((item) => hasKey(item) && item.key === token)
    : isObject(node)
      ? node[token]
      : undefined;

/** The value at a keyed path, or undefined. */
export function settingAt(root: unknown, path: string): unknown {
  return path.split(".").reduce(step, root);
}

/**
 * A copy of `root` with the value at a keyed path replaced; undefined removes it. A text that
 * loses its last language, or any object left empty, is removed with it, so that an optional
 * text can be cleared. Objects that the path needs and `root` lacks are made on the way, so an
 * email's text can be written where there was no `messages`, and removing the last one leaves
 * none. Items of keyed lists are only ever changed, never added.
 */
export function withSetting<T>(root: T, path: string, value: unknown): T {
  const put = (node: unknown, tokens: string[]): unknown => {
    const [head, ...rest] = tokens;
    if (head === undefined) return value;
    if (Array.isArray(node)) {
      return node.map((item) => (hasKey(item) && item.key === head ? put(item, rest) : item));
    }
    const copy: Record<string, unknown> = isObject(node) ? { ...node } : {};
    const next = put(copy[head], rest);
    if (next === undefined || (isObject(next) && Object.keys(next).length === 0)) delete copy[head];
    else copy[head] = next;
    return copy;
  };
  return put(root, path.split(".")) as T;
}

/**
 * A path as the schema reports it (positions in lists: "submissionTypes.0.team") turned into a
 * keyed path ("submissionTypes.paper.team"), by looking the positions up in `root`.
 */
export function keyedPath(root: unknown, path: readonly (string | number)[]): string {
  const out: string[] = [];
  let node: unknown = root;
  for (const token of path) {
    const item = Array.isArray(node) ? node[Number(token)] : undefined;
    if (Array.isArray(node)) {
      out.push(hasKey(item) ? item.key : String(token));
      node = item;
    } else {
      out.push(String(token));
      node = isObject(node) ? node[String(token)] : undefined;
    }
  }
  return out.join(".");
}
