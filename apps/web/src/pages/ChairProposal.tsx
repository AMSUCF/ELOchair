import type { ConferenceConfig } from "@elochair/schema";
import { localize, reviewPoolFor } from "@elochair/schema/pure";
import { Link } from "react-router";
import { answerOf } from "../answers";
import type { ChairSubmission } from "../api";
import { formatDateTime } from "../format";
import { LANG_NAMES, useT } from "../i18n";
import { contribStatusKey, type IssueCode, issueLabelKey, modeKey, roleKey } from "../labels";
import { Localized, PageHeading, StatusBadge } from "../ui";
import { ProposalDecisionSection } from "./ProposalDecision";
import { ProposalReviewersSection } from "./ProposalReviewers";
import { ReviewSection } from "./ReviewForm";

/**
 * A proposal as a chair is given it (the chair projection in packages/policy): everything the
 * owner wrote and everyone on it, in the order of the submission form, with nothing of it to
 * change. It is what the CSV exports hold, on one page. Chairs never get this view of their own
 * work or of work they have a conflict with: the policy decides that, not this page.
 *
 * Under the proposal, a chair of the conference finds its decision, and records one there (spec
 * 03, §1.6), and then its reviewers with the reviews they sent, and assigns and removes them
 * there (§1.3). The decision comes first, so that it is not under the long list of who could be
 * assigned; it says what the reviewers recommend, and their reviews are right below it. A track
 * chair is given the proposal and neither part.
 *
 * A chair may also review: where they hold the reviewer's role and this proposal is assigned to
 * them, their own review is here too, above the reviewers, with the committee's guidelines (spec
 * 03, §1.4). They read the proposal as a chair all the same; the server says whether the review
 * is theirs to write (ReviewSection asks, and shows nothing where it is not).
 */
export function ChairProposal({
  sub,
  slug,
  phase,
  config,
  managesReviewers,
  reviewsHere,
  personId,
}: {
  sub: ChairSubmission;
  slug: string;
  /** The phase the conference is in. */
  phase: string;
  config: ConferenceConfig;
  /** The person looking is a chair of the conference (a chair, an admin or a site admin). */
  managesReviewers: boolean;
  /** The person looking also holds the reviewer's role at the conference. */
  reviewsHere: boolean;
  /** The person signed in: their unsaved review text is kept in this browser under their id. */
  personId: string | null;
}) {
  const { lang, t } = useT();
  const fallback = config.defaultLanguage;
  const type = config.submissionTypes.find((x) => x.key === sub.typeKey);
  const pool = reviewPoolFor(config, sub.typeKey);
  const track = config.tracks.find((x) => x.key === sub.trackKey);
  const topics = config.topics.filter((x) => sub.topicKeys.includes(x.key));
  const words = { lang, fallback, yes: t("editYes"), no: t("editNo") };
  const answers = (type?.fields ?? []).flatMap((field) => {
    const answer = answerOf(field, sub.fields[field.key], words);
    return answer ? [{ field, answer }] : [];
  });
  const people = [...sub.contributors].sort((a, b) => a.position - b.position);
  const problems: IssueCode[] = [
    ...sub.issueCodes,
    ...(sub.selfIdWarningCount ? (["self_identification"] as const) : []),
  ];
  const when = (iso: string) => formatDateTime(iso, lang, config.timezone);

  return (
    <article>
      <PageHeading title={sub.title || t("editUntitled")}>
        {sub.title || t("editUntitled")}
      </PageHeading>
      <p>
        <StatusBadge status={sub.status} /> <Localized text={config.title} fallback={fallback} />
        {type && (
          <>
            {" · "}
            <Localized text={type.name} fallback={fallback} />
          </>
        )}
      </p>
      <p className="notice">{t("editReadOnly")}</p>
      {problems.length > 0 && (
        <p className="notice">
          {t("manageIssues")}: {problems.map((code) => t(issueLabelKey(code))).join(", ")}
        </p>
      )}
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
        {sub.participationMode && (
          <div>
            <dt>{t("chairTakingPart")}</dt>
            <dd>{t(modeKey(sub.participationMode))}</dd>
          </div>
        )}
        {sub.submittedAt && (
          <div>
            <dt>{t("chairSubmittedAt")}</dt>
            <dd>{when(sub.submittedAt)}</dd>
          </div>
        )}
        <div>
          <dt>{t("chairUpdatedAt")}</dt>
          <dd>{when(sub.updatedAt)}</dd>
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
      <h2>{t("editPeople")}</h2>
      <ul>
        {people.map((c) => {
          // Until someone confirms, they are what the owner typed, and nothing else.
          const contact = [c.email || c.invitedEmail, c.affiliation, c.country].filter(Boolean);
          return (
            <li key={c.personId}>
              {c.displayName ?? c.invitedName ?? "—"} · {t(roleKey(c.role))} ·{" "}
              {t(contribStatusKey(c.status))}
              {contact.length > 0 && <p className="meta">{contact.join(" · ")}</p>}
            </li>
          );
        })}
      </ul>
      {reviewsHere && pool && (
        <ReviewSection
          key={sub.id}
          submissionId={sub.id}
          language={sub.language}
          pool={pool}
          config={config}
          personId={personId}
          whereTheirs
          before={
            pool.guidelines && (
              <details className="guidelines-box">
                <summary>{t("reviewGuidelines")}</summary>
                {/* As the chairs wrote them: their line breaks are kept (.guidelines). */}
                <p className="guidelines">
                  <Localized text={pool.guidelines} fallback={fallback} />
                </p>
              </details>
            )
          }
        />
      )}
      {managesReviewers && <ProposalDecisionSection slug={slug} submissionId={sub.id} />}
      {managesReviewers && (
        <ProposalReviewersSection
          slug={slug}
          submissionId={sub.id}
          typeKey={sub.typeKey}
          phase={phase}
          config={config}
        />
      )}
      <p>
        <Link className="block-link" to={`/${lang}/c/${slug}/manage`}>
          {t("settingsBackToManage")}
        </Link>
      </p>
    </article>
  );
}
