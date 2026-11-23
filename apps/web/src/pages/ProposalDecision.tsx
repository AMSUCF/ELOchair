import type { DecisionOutcome } from "@elochair/schema";
import { noCommentsSentence, RECOMMENDATIONS, reviewerLabel } from "@elochair/schema/pure";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  type ApiResult,
  type AuthorDecision,
  api,
  type ProposalDecision,
  type RecommendationCounts,
} from "../api";
import { StatusLine, useSaid } from "../asking";
import { formatDateTime, viewerTimeZone } from "../format";
import { type MessageKey, useT } from "../i18n";
import { phaseKey, statusKey } from "../labels";
import { useHashTarget } from "../ui";
import { useApi } from "../useApi";

/*
 * Decisions on a proposal's page (spec 03, §1.6), in two parts that never meet.
 *
 * For a chair who manages the proposal, the Decision section: what its reviewers recommend, the
 * decision that is recorded, and recording one, changing it or taking it back. Recording tells
 * nobody, and the section says so: the authors are told when the chairs send the decisions, on
 * the Decisions page. The server decides what can be recorded; this page shows what arrives.
 *
 * For the proposal's owner and its confirmed co-authors, once the decision was sent: what was
 * decided, and the comments the reviewers wrote for the authors, each under a number and never
 * a name. Before that the server gives them nothing, and nothing is shown.
 */

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** What the reviews recommend, in words: "2 accept, 1 unsure"; null where none recommends. */
export function recommendationsInWords(t: Translate, counts: RecommendationCounts): string | null {
  const parts = RECOMMENDATIONS.filter((r) => counts[r] > 0).map((r) =>
    t(`decisionRec_${r}`, { n: counts[r] }),
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/** The decision of one proposal, read again after every change; what is shown stays meanwhile. */
function useDecision(url: string) {
  const [view, setView] = useState<ApiResult<ProposalDecision> | null>(null);
  /** The proposal this section is about now: an answer about another one is dropped. */
  const shown = useRef(url);

  useEffect(() => {
    shown.current = url;
    setView(null);
    api<ProposalDecision>(url).then((r) => {
      if (shown.current === url) setView(r);
    });
  }, [url]);

  /** A reading that fails for want of an answer leaves the page as it is. */
  const reread = useCallback(async () => {
    const r = await api<ProposalDecision>(url);
    if ((r.ok || r.status === 403 || r.status === 404) && shown.current === url) setView(r);
    return r.ok ? r.data : null;
  }, [url]);

  return { view, reread };
}

export function ProposalDecisionSection({
  slug,
  submissionId,
}: {
  slug: string;
  submissionId: string;
}) {
  const { lang, t } = useT();
  const url = `/api/conferences/${slug}/decisions/submissions/${submissionId}`;
  const { view, reread } = useDecision(url);
  /** The outcome chosen in the form; what is recorded, until the chair chooses another. */
  const [chosen, setChosen] = useState<DecisionOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const said = useSaid();
  // A link from the Decisions page leads here ("#decision"), once the section is drawn.
  useHashTarget(view !== null);

  const recorded = view?.ok ? (view.data.recorded?.outcome ?? null) : null;
  // What is recorded is what the form starts from, each time it is read.
  useEffect(() => setChosen(recorded), [recorded]);

  const heading = (
    <h2 id="decision" tabIndex={-1}>
      {t("decisionTitle")}
    </h2>
  );
  if (!view) {
    return (
      <section className="decision" aria-labelledby="decision">
        {heading}
        <p role="status">{t("loading")}</p>
      </section>
    );
  }
  if (!view.ok) {
    return (
      <section className="decision" aria-labelledby="decision">
        {heading}
        <p role="alert">{t("decisionLoadFailed")}</p>
      </section>
    );
  }
  const data = view.data;
  const when = (iso: string) => formatDateTime(iso, lang, viewerTimeZone());
  const word = (outcome: DecisionOutcome) => t(`decisionOutcome_${outcome}`);
  const recommendations = recommendationsInWords(t, data.reviews.recommendations);

  /** One request that changes something; then the section is read again and says what it did. */
  async function act(run: () => Promise<string>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const text = await run();
    await reread();
    inFlight.current = false;
    setBusy(false);
    said.say(text);
  }

  /** What a refusal is said as, whichever of the two requests it answers. */
  const refusal = (res: { status: number; error: string }, gone: MessageKey): string => {
    if (res.status === 409) return t(res.error === "no_decision" ? gone : "decisionNotNow");
    if (res.status === 403 || res.status === 404) return t("decisionNoAccess");
    if (res.status === 429) return t("signInRateLimited");
    return t("peopleUnconfirmed");
  };

  function record(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return said.say(t("decisionChooseFirst"));
    act(async () => {
      const res = await api(url, { method: "PUT", body: { outcome: chosen } });
      return res.ok
        ? t("decisionSaidRecorded", { outcome: word(chosen) })
        : refusal(res, "decisionNotNow");
    });
  }

  const takeBack = () =>
    act(async () => {
      const res = await api(url, { method: "DELETE", body: {} });
      return res.ok ? t("decisionSaidTakenBack") : refusal(res, "decisionGone");
    });

  const takeBackButton = (
    <button
      type="button"
      className="secondary"
      aria-disabled={busy ? "true" : undefined}
      onClick={takeBack}
    >
      {t("decisionTakeBack")}
    </button>
  );

  return (
    <section className="decision" aria-labelledby="decision">
      {heading}
      {data.takes === "yes" && <p>{t("decisionDoes")}</p>}
      <p>
        {t("decisionReviews", { sent: data.reviews.sent, asked: data.reviews.asked })}{" "}
        {data.reviews.sent > 0 &&
          (recommendations
            ? t("decisionRecs", { list: recommendations })
            : t("decisionRecsNone"))}{" "}
        {data.reviews.sent > 0 && t("decisionReviewsBelow")}
      </p>
      {data.told && (
        <p>
          {t("decisionTold", {
            date: when(data.told.at),
            status: t(statusKey(data.told.outcome)),
          })}{" "}
          {data.takes === "decided" && t("decisionFinal")}
          {data.takes === "yes" && t("decisionWaitlistNext")}
        </p>
      )}
      {data.takes === "not_in_review" && (
        <p className="notice">{t("decisionTakes_not_in_review")}</p>
      )}
      {data.takes === "not_under_consideration" && (
        <p className="notice">
          {t("decisionTakes_not_under_consideration")}
          {data.recorded && ` ${t("decisionWillNotBeSent")}`}
        </p>
      )}
      {(data.recorded || (data.takes === "yes" && !data.told)) && (
        <p>
          {data.recorded
            ? t("decisionRecorded", { outcome: word(data.recorded.outcome) })
            : t("decisionNone")}{" "}
          {data.recorded &&
            data.takes === "yes" &&
            (data.canSend
              ? t("decisionSendWhere")
              : t("decisionSendLater", { deciding: t(phaseKey("deciding")) }))}
        </p>
      )}
      <StatusLine said={said} />
      {data.takes === "yes" ? (
        <form className="stack wide" onSubmit={record} noValidate>
          <fieldset>
            <legend>{t("decisionChoose")}</legend>
            {data.outcomes.map((outcome) => (
              <label key={outcome} className="choice">
                <input
                  type="radio"
                  name={`decision-${submissionId}`}
                  value={outcome}
                  checked={chosen === outcome}
                  onChange={() => setChosen(outcome)}
                />
                <span>{t(`decisionChoice_${outcome}`)}</span>
              </label>
            ))}
          </fieldset>
          <p className="actions">
            {/* aria-disabled while a request is on its way, so focus stays on the button. */}
            <button type="submit" aria-disabled={busy ? "true" : undefined}>
              {t(data.recorded ? "decisionChange" : "decisionRecord")}
            </button>
            {data.recorded && takeBackButton}
          </p>
        </form>
      ) : (
        data.recorded && <p className="actions">{takeBackButton}</p>
      )}
      <p>
        <Link className="block-link" to={`/${lang}/c/${slug}/decisions`}>
          {t("decisionToPage")}
        </Link>
      </p>
    </section>
  );
}

/** The statuses a proposal has while nothing was decided about it, or it was withdrawn. */
const UNDECIDED = ["draft", "submitted", "withdrawn"];

/**
 * The decision about a proposal, for its owner and its confirmed co-authors, once it was sent:
 * what was decided, when, and the reviewers' comments for the authors. It asks only for a
 * proposal whose status says that a decision was sent, and shows nothing unless the server
 * answers with one: for anyone else, and before the decisions are sent, there is none.
 */
export function AuthorDecisionSection({
  submissionId,
  status,
}: {
  submissionId: string;
  status: string;
}) {
  const { lang, t } = useT();
  const res = useApi<AuthorDecision>(
    UNDECIDED.includes(status) ? null : `/api/submissions/${submissionId}/decision`,
  );
  if (UNDECIDED.includes(status) || !res?.ok) return null;
  const { outcome, sentAt, comments } = res.data;
  return (
    <section className="author-decision" aria-labelledby="author-decision">
      <h2 id="author-decision">{t("authorDecisionTitle")}</h2>
      <p className="decided">{t(`authorDecision_${outcome}`)}</p>
      <p className="meta">
        {t("authorDecisionSent", { date: formatDateTime(sentAt, lang, viewerTimeZone()) })}
      </p>
      <h3>{t("authorCommentsTitle")}</h3>
      {comments.length === 0 ? (
        <p>{noCommentsSentence(lang)}</p>
      ) : (
        <>
          <p className="meta">{t("authorCommentsIntro")}</p>
          {comments.map((text, i) => (
            // The comments never change once they were sent: their place is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, numbered by its order
            <div key={i} className="author-comment">
              <h4>{reviewerLabel(i + 1, lang)}</h4>
              {/* As the reviewer wrote them: their line breaks are kept (.review-text). */}
              <p className="review-text">{text}</p>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
