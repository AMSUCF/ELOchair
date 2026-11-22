import type { ConferenceConfig, ReviewPool, SubmissionType } from "@elochair/schema";
import {
  ANSWER_WORDS,
  committeeList,
  formatDeadline,
  localize,
  type MailLang,
  type MailMessageKey,
  ROLE_WORDS,
} from "@elochair/schema/pure";
import { translate } from "./i18n";

/** What a preview takes from the conference itself. */
export type PreviewSource = Pick<ConferenceConfig, "title" | "defaultLanguage" | "timezone"> & {
  deadlines: Pick<ConferenceConfig["deadlines"], "submissionsClose">;
  submissionTypes: readonly Pick<SubmissionType, "name">[];
  reviewPools: readonly Pick<ReviewPool, "name">[];
};

/**
 * Made-up values for every placeholder, to show a chair an email as it would be sent. People
 * and titles are invented and say so, in the language of the email (not of the interface: a
 * chair reading in English still previews the Spanish email with Spanish samples). What the
 * conference itself supplies is real: its title, its first format, its review pools and the
 * close of its call, written as the server writes them, which for a language the conference has not written them
 * in means in its main language. The links have the shape of the real ones and lead nowhere.
 *
 * `config` is the stored configuration, which is always valid, never the form as it is typed.
 */
export function sampleValues(
  key: MailMessageKey,
  lang: MailLang,
  config: PreviewSource,
  origin: string,
): Record<string, string> {
  const type = config.submissionTypes[0];
  return {
    owner: translate(lang, "settingsEmailSample_owner"),
    person: translate(lang, "settingsEmailSample_person"),
    title: translate(lang, "settingsEmailSample_title"),
    role: ROLE_WORDS[lang].coauthor,
    answer: ANSWER_WORDS[lang].confirmed,
    conference: localize(config.title, lang, config.defaultLanguage),
    format: type ? localize(type.name, lang, config.defaultLanguage) : "",
    deadline: formatDeadline(config.deadlines.submissionsClose, config.timezone, lang),
    // A reviewer may be invited to any of the pools: the preview lists them all.
    committees: committeeList(
      config.reviewPools.map((pool) => localize(pool.name, lang, config.defaultLanguage)),
    ),
    link:
      key === "invitation"
        ? `${origin}/${lang}/invitation#token=…`
        : key === "reviewer_invitation" || key === "chair_invitation"
          ? `${origin}/${lang}/role-invitation#token=…`
          : `${origin}/${lang}/s/…`,
  };
}
