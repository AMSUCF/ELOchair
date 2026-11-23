import type { ConferenceConfig, ReviewPool, SubmissionType } from "@elochair/schema";
import {
  ANSWER_WORDS,
  commentsBlock,
  committeeList,
  DECLINE_REASON_WORDS,
  formatDeadline,
  localize,
  type MailLang,
  type MailMessageKey,
  ROLE_WORDS,
  reviewsDueSentence,
} from "@elochair/schema/pure";
import { translate } from "./i18n";

/** What a preview takes from the conference itself. */
export type PreviewSource = Pick<
  ConferenceConfig,
  "slug" | "title" | "defaultLanguage" | "timezone"
> & {
  deadlines: Pick<ConferenceConfig["deadlines"], "submissionsClose" | "reviewsDue">;
  submissionTypes: readonly Pick<SubmissionType, "name">[];
  reviewPools: readonly Pick<ReviewPool, "name">[];
};

/**
 * Made-up values for every placeholder, to show a chair an email as it would be sent. People
 * and titles are invented and say so, in the language of the email (not of the interface: a
 * chair reading in English still previews the Spanish email with Spanish samples). What the
 * conference itself supplies is real: its title, its first format, its review pools, the close
 * of its call and the day reviews are due, written as the server writes them, which for a
 * language the conference has not written them in means in its main language. The links have
 * the shape of the real ones and lead nowhere: those of the emails of the review phase are the
 * real addresses, which are the same for everyone. The reviewers' comments in the emails about
 * a decision are two made-up ones, put together as the server puts the real ones together.
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
  const forReviewer = key === "new_assignments" || key === "review_reminder";
  const forChair = key === "reviewer_declined" || key === "reviews_complete";
  // The day reviews are due, where the chairs have set one. (A reminder is only ever sent
  // where they have: until then its preview says, as the server would, that none is set.)
  const { reviewsDue, submissionsClose } = config.deadlines;
  const due = reviewsDue ? formatDeadline(reviewsDue, config.timezone, lang) : null;
  const link =
    key === "invitation"
      ? `${origin}/${lang}/invitation#token=…`
      : key === "reviewer_invitation" || key === "chair_invitation"
        ? `${origin}/${lang}/role-invitation#token=…`
        : forReviewer
          ? `${origin}/${lang}/reviews`
          : forChair
            ? `${origin}/${lang}/c/${config.slug}/assignments`
            : `${origin}/${lang}/s/…`;
  return {
    owner: translate(lang, "settingsEmailSample_owner"),
    person: translate(lang, "settingsEmailSample_person"),
    title: translate(lang, "settingsEmailSample_title"),
    role: ROLE_WORDS[lang].coauthor,
    answer: ANSWER_WORDS[lang].confirmed,
    conference: localize(config.title, lang, config.defaultLanguage),
    format: type ? localize(type.name, lang, config.defaultLanguage) : "",
    deadline: formatDeadline(submissionsClose, config.timezone, lang),
    // The emails of the review phase: a number, a sentence about the day reviews are due, a
    // reason in the app's own words, and the link to the reader's own choices.
    count: "3",
    due: reviewsDueSentence(due, lang),
    reason: DECLINE_REASON_WORDS[lang].time,
    choices: `${origin}/${lang}/me#emails`,
    // A reviewer may be invited to any of the pools: the preview lists them all.
    committees: committeeList(
      config.reviewPools.map((pool) => localize(pool.name, lang, config.defaultLanguage)),
    ),
    // The emails about a decision: what two reviewers might have written for the authors,
    // each under its number.
    comments: commentsBlock(
      [
        translate(lang, "settingsEmailSample_comment1"),
        translate(lang, "settingsEmailSample_comment2"),
      ].map((text) => ({ text, cut: false })),
      link,
      lang,
    ),
    link,
  };
}
