import type { ConferenceConfig, ConferencePhase } from "@elochair/schema";
import {
  DECISION_MESSAGES,
  DECISION_OUTCOMES,
  fillMessage,
  localize,
  messageText,
} from "@elochair/schema/pure";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type ApiResult,
  api,
  type ConferenceDetail,
  type Decisions,
  type DecisionsPool,
  type DecisionsProposal,
  type SendConfirmation,
  type SendSummary,
} from "../api";
import { Ask, StatusLine, useSaid } from "../asking";
import { sampleValues } from "../emailPreview";
import { LANG_NAMES, useT } from "../i18n";
import { phaseKey } from "../labels";
import { Localized, PageHeading, useHashTarget } from "../ui";
import { recommendationsInWords } from "./ProposalDecision";

/*
 * The chairs' Decisions page (spec 03, §1.6): by committee, every proposal that still awaits a
 * decision, with what its reviewers recommend and the decision recorded for it, those with none
 * first. A decision is recorded on the proposal's own page, which each title leads to, where
 * its reviews are.
 *
 * At the top is the step that sends them. A button opens a confirmation in its place, which
 * says in numbers what will be sent and to how many people, and shows the email for each
 * outcome. The page is read again as the button is pressed, so that the numbers and the emails
 * are those of that moment, and what stays behind the confirmation agrees with it. Nothing is sent without it, and nothing is sent that it did not show: where the
 * decisions have changed since, the server sends nothing, and the confirmation shows them as
 * they are now.
 */

/** How many of a committee's proposals arrive at a time ("Show more" follows the server's cursor). */
const PAGE_SIZE = 50;

/** Whether a committee's list says how much of it is shown: when it is, or was, more than a page. */
const paged = (proposals: number, shown: number) => proposals > shown || shown > PAGE_SIZE;

/** Whether there is a decision to send. */
const waits = (s: SendSummary) => s.accepted + s.waitlisted + s.rejected > 0;

type Loaded = {
  conf: ApiResult<ConferenceDetail>;
  page: ApiResult<Decisions>;
  waiting: ApiResult<SendConfirmation>;
};

export function DecisionsPage() {
  const { slug = "" } = useParams();
  const { lang, t } = useT();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** Counts the times the page was read again: each committee's list starts over with it. */
  const [reading, setReading] = useState(0);
  /** The conference this page is on now: an answer about another one is dropped. */
  const shown = useRef(slug);

  /**
   * Everything the page shows, read together: the phase with the wording of the emails, the
   * lists and what waits to be sent. Answers with what waits now, or with nothing where the
   * page could not be read: it then says why, or, where a reading again got no answer (the
   * network, a limit), stays as it was last read.
   */
  const load = useCallback(async (): Promise<SendConfirmation | null> => {
    const at = `/api/conferences/${slug}`;
    const [conf, page, waiting] = await Promise.all([
      api<ConferenceDetail>(at),
      api<Decisions>(`${at}/decisions?limit=${PAGE_SIZE}`),
      api<SendConfirmation>(`${at}/decisions/send`),
    ]);
    if (shown.current !== slug) return null;
    const unanswered = [conf, page, waiting].some(
      (r) => !r.ok && r.status !== 403 && r.status !== 404,
    );
    setLoaded((was) => (was && unanswered ? was : { conf, page, waiting }));
    if (!unanswered) setReading((n) => n + 1);
    return conf.ok && page.ok && waiting.ok ? waiting.data : null;
  }, [slug]);

  useEffect(() => {
    shown.current = slug;
    setLoaded(null);
    load();
  }, [slug, load]);
  // A committee's link at the top of the page leads to its part of it.
  useHashTarget(Boolean(loaded?.conf.ok && loaded.page.ok));

  if (!loaded) return <p role="status">{t("loading")}</p>;
  const { conf, page, waiting } = loaded;
  if (!conf.ok) return <PageHeading>{t("confNotFound")}</PageHeading>;
  if (!page.ok || !waiting.ok) {
    const refused = [page, waiting].some((r) => !r.ok && r.status === 403);
    return (
      <>
        {/* It can take the place of a page that was shown: the heading takes focus then too. */}
        <PageHeading focusOnMount>{t("decisionsTitle")}</PageHeading>
        <p role="alert">{t(refused ? "decisionsNoAccess" : "errorGeneric")}</p>
      </>
    );
  }
  const config = conf.data.config;
  const data = page.data;
  const committee = (key: string) => {
    const pool = config.reviewPools.find((p) => p.key === key);
    return pool ? localize(pool.name, lang, config.defaultLanguage) : key;
  };

  return (
    <div className="decisions-page">
      <PageHeading title={t("decisionsTitle")}>{t("decisionsTitle")}</PageHeading>
      <p className="meta">
        <Localized text={config.title} fallback={config.defaultLanguage} />
      </p>
      <p>{t("decisionsIntro")}</p>
      {!data.canRecord && <p className="notice">{t("decisionsNotYet")}</p>}
      {data.excluded > 0 && (
        <p className="meta">
          {data.excluded === 1
            ? t("decisionsExcludedOne")
            : t("decisionsExcludedMany", { n: data.excluded })}
        </p>
      )}
      <p>
        <Link className="block-link" to={`/${lang}/c/${slug}/manage`}>
          {t("settingsBackToManage")}
        </Link>
      </p>
      <SendDecisions
        slug={slug}
        phase={conf.data.phase}
        config={config}
        waiting={waiting.data}
        onChanged={load}
      />
      {data.pools.length > 1 && (
        <nav aria-label={t("assignmentsCommittees")}>
          <ul className="jump">
            {data.pools.map((pool) => (
              <li key={pool.key}>
                <Link className="block-link" to={{ hash: `#committee-${pool.key}` }}>
                  {committee(pool.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {data.pools.map((pool) => (
        <Committee
          key={`${slug}:${pool.key}:${reading}`}
          slug={slug}
          first={pool}
          name={committee(pool.key)}
          config={config}
        />
      ))}
    </div>
  );
}

/**
 * Sending the decisions: what waits, and the one step that sends it. The button moves nothing:
 * it opens the confirmation in its place.
 */
function SendDecisions({
  slug,
  phase,
  config,
  waiting,
  onChanged,
}: {
  slug: string;
  phase: ConferencePhase;
  config: ConferenceConfig;
  /** What waits to be sent as the page last read it. */
  waiting: SendConfirmation;
  /** The page is read again: what waits now, or nothing where it could not be read. */
  onChanged: () => Promise<SendConfirmation | null>;
}) {
  const { t } = useT();
  /** The confirmation that is open: what it shows is what a send names. */
  const [asked, setAsked] = useState<SendConfirmation | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** The button takes focus again once the confirmation it opened is dismissed. */
  const refocus = useRef(false);
  const opener = useRef<HTMLButtonElement>(null);
  const said = useSaid();

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    opener.current?.focus();
  });

  function dismiss() {
    if (inFlight.current) return;
    refocus.current = true;
    setAsked(null);
    setNote("");
  }

  /**
   * One request at a time, and nothing else is started until the page was read again after
   * it: no button can be pressed on what the request has made old.
   */
  async function busily(run: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  /**
   * The button reads the page again and opens the confirmation on what waits now. What the
   * page read when it was opened may be old by then: a decision recorded since, in another tab
   * or by another chair, or an email reworded.
   */
  const open = () =>
    busily(async () => {
      const now = await onChanged();
      // Not read: the page says why in the place of this section, or it stays and this does.
      if (!now) return said.say(t("errorGeneric"));
      if (!now.canSend) return said.say(t("sendNotDeciding"));
      if (!waits(now)) return said.say(t("sendStaleNothing"));
      setAsked(now);
    });

  /** Read the page again, close the confirmation, and say why at the status line. */
  async function close(text: string) {
    await onChanged();
    setAsked(null);
    setNote("");
    said.say(text);
  }

  const send = () =>
    busily(async () => {
      if (!asked) return;
      setNote("");
      const res = await api<SendSummary>(`/api/conferences/${slug}/decisions/send`, {
        method: "POST",
        body: { token: asked.token },
      });
      if (res.ok) {
        const sent = res.data;
        return close(
          [
            t("sendDone", {
              accepted: sent.accepted,
              waitlisted: sent.waitlisted,
              rejected: sent.rejected,
              people: sent.people,
            }),
            ...(sent.dropped > 0 ? [t("sendDoneDropped", { n: sent.dropped })] : []),
          ].join(" "),
        );
      }
      if (res.status === 409 && res.error === "stale") {
        // What waits is no longer what was shown: nothing was sent. The page is read again,
        // and where something still waits, the confirmation shows it as it is now, to be read
        // and confirmed again. (The answer says it too, should the page not be read.)
        const now = (await onChanged()) ?? (res.body?.summary as SendConfirmation | undefined);
        if (now?.canSend && waits(now)) {
          setAsked(now);
          setNote(t("sendStale"));
          return;
        }
        return close(t("sendStaleNothing"));
      }
      if (res.status === 409 && res.error === "nothing_to_send") {
        return close(t("sendStaleNothing"));
      }
      if (res.status === 409) return close(t("sendNotDeciding"));
      if (res.status === 403 || res.status === 404) return close(t("sendNoAccess"));
      // No answer, or not one that says what happened: the confirmation stays, and says so.
      setNote(t(res.status === 429 ? "signInRateLimited" : "sendUnconfirmed"));
    });

  const numbers = (s: SendSummary) =>
    t("sendWaiting", { accepted: s.accepted, waitlisted: s.waitlisted, rejected: s.rejected });

  return (
    <section className="send-decisions" aria-labelledby="send-decisions">
      <h2 id="send-decisions">{t("sendTitle")}</h2>
      <p>{t("sendDoes")}</p>
      <StatusLine said={said} />
      {asked ? (
        <Ask
          level="h3"
          question={t("sendAsk")}
          yes={t("sendDo")}
          busy={busy}
          note={note}
          onYes={send}
          onNo={dismiss}
        >
          <ul className="send-numbers">
            {DECISION_OUTCOMES.map((outcome) => (
              <li key={outcome}>{t(`sendWill_${outcome}`, { n: asked[outcome] })}</li>
            ))}
            <li>{t("sendWill_people", { n: asked.people })}</li>
            <li>{t("sendWill_undecided", { n: asked.undecided })}</li>
            {asked.dropped > 0 && <li>{t("sendWill_dropped", { n: asked.dropped })}</li>}
          </ul>
          <p>{t("sendCounts")}</p>
          <p>{t("sendFinal")}</p>
          <EmailPreviews config={config} />
        </Ask>
      ) : !waiting.canSend ? (
        <>
          <p className="notice">
            {t("sendNotYet", { phase: t(phaseKey(phase)), deciding: t(phaseKey("deciding")) })}
          </p>
          {waits(waiting) && <p>{numbers(waiting)}</p>}
        </>
      ) : waits(waiting) ? (
        <>
          <p>{numbers(waiting)}</p>
          <p className="actions">
            {/* aria-disabled while the page is read again, so focus stays on the button. */}
            <button
              type="button"
              ref={opener}
              aria-disabled={busy ? "true" : undefined}
              onClick={open}
            >
              {t("sendOpen")}
            </button>
          </p>
        </>
      ) : (
        <p>{t("sendNothing")}</p>
      )}
    </section>
  );
}

/**
 * The email for each outcome as it will be sent: the conference's own wording where its chairs
 * wrote one, otherwise the standard text, filled with a made-up title and made-up comments. In
 * the language the page is read in: each person gets theirs in their own.
 */
function EmailPreviews({ config }: { config: ConferenceConfig }) {
  const { lang, t } = useT();
  const emails = useMemo(
    () =>
      DECISION_OUTCOMES.map((outcome) => {
        const key = DECISION_MESSAGES[outcome];
        const values = sampleValues(key, lang, config, window.location.origin);
        const filled = (part: "subject" | "body") =>
          fillMessage(key, part, messageText(config.messages, key, part, lang), values);
        return { outcome, subject: filled("subject"), body: filled("body") };
      }),
    [lang, config],
  );
  return (
    <>
      <p>{t("sendPreviews", { language: LANG_NAMES[lang] })}</p>
      {emails.map((email) => (
        <figure key={email.outcome} className="email-preview">
          <figcaption>{t(`sendPreview_${email.outcome}`)}</figcaption>
          <dl>
            <dt>{t("settingsLabel_message_subject")}</dt>
            <dd className="email-subject">{email.subject}</dd>
            <dt>{t("settingsLabel_message_body")}</dt>
            <dd className="email-body">{email.body}</dd>
          </dl>
        </figure>
      ))}
    </>
  );
}

/**
 * One committee: its totals, and its proposals a page at a time. The first page came with the
 * page itself; "Show more" asks for the next one, from where this one ended.
 */
function Committee({
  slug,
  first,
  name,
  config,
}: {
  slug: string;
  first: DecisionsPool;
  name: string;
  config: ConferenceConfig;
}) {
  const { lang, t } = useT();
  const [pool, setPool] = useState(first);
  const [loading, setLoading] = useState(false);
  /**
   * "Show more" failed: the list so far stays, with a message by the button. "changed": the
   * server no longer knows where the list ended (400 at path "cursor").
   */
  const [failed, setFailed] = useState<"error" | "changed" | null>(null);
  /** Repeat taps on "Show more" while a page is on its way do nothing. */
  const inFlight = useRef(false);
  /** After "Show more", the first new proposal takes focus so keyboard users continue there. */
  const focusAfter = useRef<string | null>(null);
  const showing = `committee-${first.key}-showing`;

  useEffect(() => {
    if (!focusAfter.current) return;
    document.getElementById(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  async function more() {
    if (!pool.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setFailed(null);
    const r = await api<DecisionsPool>(
      `/api/conferences/${slug}/decisions/pools/${first.key}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(pool.nextCursor)}`,
    );
    inFlight.current = false;
    setLoading(false);
    if (!r.ok) {
      setFailed(
        r.status === 400 && r.issues.some((i) => i.path === "cursor") ? "changed" : "error",
      );
      return;
    }
    // A proposal is listed once, even if a page repeats one already shown: it stays where it
    // is, as the newest answer describes it, so that no card contradicts the totals above it.
    const newest = new Map(r.data.items.map((x) => [x.id, x]));
    const listed = new Set(pool.items.map((x) => x.id));
    const added = r.data.items.filter((x) => !listed.has(x.id));
    const items = [...pool.items.map((x) => newest.get(x.id) ?? x), ...added];
    // Focus goes to the first new proposal. With none, and the button gone, to the count if
    // the page still shows one, or else to the committee's heading: never nowhere.
    focusAfter.current = added[0]
      ? `proposal-${added[0].id}`
      : r.data.nextCursor
        ? null
        : paged(r.data.proposals, items.length)
          ? showing
          : `committee-${first.key}`;
    // The totals are the newest the server gave.
    setPool({ ...r.data, items });
  }

  const formatName = (typeKey: string) => {
    const type = config.submissionTypes.find((x) => x.key === typeKey);
    return type ? localize(type.name, lang, config.defaultLanguage) : typeKey;
  };
  const totals =
    pool.proposals === 0
      ? t("decisionsProposalsNone")
      : [
          pool.proposals === 1
            ? t("decisionsProposalsOne")
            : t("decisionsProposalsMany", { n: pool.proposals }),
          pool.undecided === 0
            ? t("decisionsUndecidedNone")
            : pool.undecided === 1
              ? t("decisionsUndecidedOne")
              : t("decisionsUndecidedMany", { n: pool.undecided }),
        ].join(" ");
  /** What the reviews of a proposal say, in a line: how many were sent, and what they recommend. */
  const reviewsOf = (item: DecisionsProposal) => {
    if (item.sent === 0) return t("decisionsNoReviews");
    const recommendations = recommendationsInWords(t, item.recommendations);
    return `${t("decisionsReviews", { sent: item.sent, asked: pool.needed })} · ${recommendations ?? t("decisionRecsNone")}`;
  };

  return (
    <section aria-labelledby={`committee-${first.key}`}>
      <h2 id={`committee-${first.key}`} tabIndex={-1}>
        {name}
      </h2>
      <p>{totals}</p>
      {paged(pool.proposals, pool.items.length) ? (
        <p className="meta" role="status" id={showing} tabIndex={-1}>
          {t("manageShowing", { shown: pool.items.length, total: pool.proposals })}
        </p>
      ) : null}
      <ul className="cards">
        {pool.items.map((item) => (
          <li key={item.id} className="card">
            <h3>
              {/* To the proposal's page, at the part where its decision is recorded. */}
              <Link id={`proposal-${item.id}`} to={`/${lang}/s/${item.id}#decision`}>
                {item.title || t("editUntitled")}
              </Link>
            </h3>
            <p className="meta">{formatName(item.typeKey)}</p>
            <p>
              {item.waitlisted && <span className="badge">{t("decisionsWaitlisted")}</span>}{" "}
              {item.recorded ? (
                <span className="badge" data-tone="info">
                  {t("decisionsRecorded", { outcome: t(`decisionOutcome_${item.recorded}`) })}
                </span>
              ) : (
                !item.waitlisted && (
                  <span className="badge" data-tone="warn">
                    {t("decisionsNoneYet")}
                  </span>
                )
              )}{" "}
              <span>
                {item.recorded
                  ? t("decisionsNotSent")
                  : item.waitlisted
                    ? t("decisionsWaitlistedTold")
                    : ""}
              </span>
            </p>
            <p>{reviewsOf(item)}</p>
          </li>
        ))}
      </ul>
      {pool.nextCursor && (
        // aria-disabled while a page is on its way, so focus stays on the button.
        <button
          type="button"
          className="secondary"
          aria-disabled={loading ? "true" : undefined}
          onClick={more}
        >
          {t("manageShowMore")}
        </button>
      )}
      <p className="status-line" role="status">
        {failed === "changed" ? t("manageListChanged") : failed ? t("errorGeneric") : ""}
      </p>
    </section>
  );
}
