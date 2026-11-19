import type { ConferenceConfig } from "@elochair/schema";
import { localize } from "@elochair/schema/pure";
import { answerOf } from "../answers";
import type { ReviewerSubmission } from "../api";
import { LANG_NAMES, useT } from "../i18n";
import { roleKey } from "../labels";
import { Localized, PageHeading } from "../ui";

/**
 * A proposal as its reviewer is given it (the reviewer projection in packages/policy): the text
 * and the answers, with nothing to change. This page shows what arrives and decides nothing: in
 * anonymized review the server leaves out the authors and the answers that could name them.
 */
export function ReviewerProposal({
  sub,
  config,
}: {
  sub: ReviewerSubmission;
  config: ConferenceConfig;
}) {
  const { lang, t } = useT();
  const fallback = config.defaultLanguage;
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey);
  const track = config.tracks.find((x) => x.key === sub.trackKey);
  const topics = config.topics.filter((x) => sub.topicKeys.includes(x.key));
  const words = { lang, fallback, yes: t("editYes"), no: t("editNo") };
  const answers = (type?.fields ?? []).flatMap((field) => {
    const answer = answerOf(field, sub.fields[field.key], words);
    return answer ? [{ field, answer }] : [];
  });

  return (
    <article>
      <PageHeading title={sub.title || t("editUntitled")}>
        {sub.title || t("editUntitled")}
      </PageHeading>
      <p>
        <Localized text={config.title} fallback={fallback} />
        {type && (
          <>
            {" · "}
            <Localized text={type.name} fallback={fallback} />
          </>
        )}
      </p>
      <p className="notice">
        {t("reviewIntro")}
        {sub.blindMode === "double" && ` ${t("reviewNamesHidden")}`}
      </p>
      <dl className="details">
        {track && (
          <div>
            <dt>{t("editTrack")}</dt>
            <dd>
              <Localized text={track.name} fallback={fallback} />
            </dd>
          </div>
        )}
        {topics.length > 0 && (
          <div>
            <dt>{t("editTopics")}</dt>
            <dd>{topics.map((x) => localize(x.label, lang, fallback)).join(", ")}</dd>
          </div>
        )}
        <div>
          <dt>{t("editLanguage")}</dt>
          <dd>{LANG_NAMES[sub.language as keyof typeof LANG_NAMES] ?? sub.language}</dd>
        </div>
      </dl>
      <h2>{type ? localize(type.abstract.label, lang, fallback) : "Abstract"}</h2>
      <p className="prose" lang={sub.language}>
        {sub.abstract}
      </p>
      {answers.map(({ field, answer }) => (
        <section key={field.key}>
          <h2>
            <Localized text={field.label} fallback={fallback} />
          </h2>
          {answer.href ? (
            <p>
              <a className="block-link" href={answer.href} target="_blank" rel="noreferrer">
                {answer.text}
              </a>
            </p>
          ) : (
            // What the author wrote is in the proposal's language; an option's name is not.
            <p
              className="prose"
              lang={field.kind === "text" || field.kind === "longtext" ? sub.language : undefined}
            >
              {answer.text}
            </p>
          )}
        </section>
      ))}
      {sub.contributors && sub.contributors.length > 0 && (
        <>
          <h2>{t("editPeople")}</h2>
          <ul>
            {sub.contributors.map((c, i) => (
              // The reviewer projection carries no person IDs; the order is the proposal's own.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list with nothing else to key on
              <li key={i}>
                {[c.displayName || "—", c.affiliation, t(roleKey(c.role))]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
