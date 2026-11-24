import type { ConferenceConfig } from "@elochair/schema";
import { LIMITS, localize, ROLE_INVITATIONS } from "@elochair/schema/pure";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import {
  type ApiResult,
  api,
  type ConferenceDetail,
  type InvitableRole,
  type Me,
  type People,
  type PeopleInvitation,
  type RemovableRole,
  type RoleHolder,
} from "../api";
import { Ask, type Asking, type Outcome, type Said, StatusLine, useSaid } from "../asking";
import { formatDateTime, viewerTimeZone } from "../format";
import { cleanName } from "../forms";
import { LANG_NAMES, LANGS, type Lang, type MessageKey, useT } from "../i18n";
import { nobodySignedIn, SignInHere } from "../signIn";
import { Localized, PageHeading } from "../ui";
import { useApi } from "../useApi";

/*
 * The chairs' People page (spec 03, §1.2): who holds a role at the conference, inviting
 * someone to one, and taking one away. Nothing here changes anything at a single press but
 * "Send the invitation" and "Send again": removing a role and cancelling an invitation ask
 * first, in place, and say what will happen.
 */

const LIMITS_SAID = {
  perInviter: ROLE_INVITATIONS.perInviterPerDay,
  perRecipient: ROLE_INVITATIONS.perRecipientPerDay,
};

/**
 * Who holds a role, read again after every change. Unlike useApi, what is on the page stays
 * there until the new answer arrives, so that the page keeps its place and the focus it has.
 */
function usePeople(slug: string) {
  const url = `/api/conferences/${slug}/people`;
  const [people, setPeople] = useState<ApiResult<People> | null>(null);
  /** The conference this page is on now: an answer about another one is dropped. */
  const shown = useRef(url);

  useEffect(() => {
    shown.current = url;
    setPeople(null);
    api<People>(url).then((r) => {
      if (shown.current === url) setPeople(r);
    });
  }, [url]);

  /** A reading that fails leaves the page as it is. */
  const reread = useCallback(async () => {
    const r = await api<People>(url);
    if (r.ok && shown.current === url) setPeople(r);
  }, [url]);

  return { people, reread };
}

export function PeoplePage() {
  const { slug = "" } = useParams();
  const { lang, t } = useT();
  const conf = useApi<ConferenceDetail>(`/api/conferences/${slug}`);
  const me = useApi<Me>("/api/me");
  const { people, reread } = usePeople(slug);
  const [asking, setAsking] = useState<Asking>(null);
  /** Said inside the open confirmation when it stays open: what went wrong, to try again. */
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** The id of what takes focus after the next render (a button that reappears). */
  const focusAfter = useRef<string | null>(null);
  const saidInvite = useSaid();
  const saidChairs = useSaid();
  const saidReviewers = useSaid();
  const saidTracks = useSaid();
  const saidInvitations = useSaid();

  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    document.getElementById(id)?.focus();
  });

  // Nobody is signed in: the sign-in form, whatever was answered about the conference (its
  // requests refuse a visitor and someone who does not chair it alike).
  if (me && nobodySignedIn(me)) {
    return <SignInHere title={t("peopleTitle")} why={t("chairsNeedSignIn")} />;
  }
  if (!conf || !people || !me) return <p role="status">{t("loading")}</p>;
  if (!conf.ok) return <PageHeading>{t("confNotFound")}</PageHeading>;
  if (!people.ok) {
    return (
      <>
        <PageHeading>{t("peopleTitle")}</PageHeading>
        <p role="alert">{t(people.status === 403 ? "peopleNoAccess" : "errorGeneric")}</p>
      </>
    );
  }
  const config = conf.data.config;
  const data = people.data;
  const poolName = (key: string) => {
    const pool = config.reviewPools.find((p) => p.key === key);
    return pool ? localize(pool.name, lang, config.defaultLanguage) : key;
  };
  const trackName = (key: string) => {
    const track = config.tracks.find((x) => x.key === key);
    return track ? localize(track.name, lang, config.defaultLanguage) : key;
  };
  const when = (iso: string) => formatDateTime(iso, lang, viewerTimeZone());
  const called = (p: RoleHolder) => p.displayName ?? p.email;

  function ask(key: string, opener: string) {
    if (inFlight.current) return;
    setNote("");
    setAsking({ key, opener });
  }
  /** "No, go back": the buttons return, and the one that asked takes focus again. */
  function dismiss() {
    if (inFlight.current || !asking) return;
    focusAfter.current = asking.opener;
    setAsking(null);
    setNote("");
  }

  /**
   * One request that changes something, then what the page says about it. When it is done (or
   * can no longer be done), the confirmation closes, the list is read again and `said` says
   * so. When it may be tried again, an open confirmation stays and says why.
   */
  async function act(said: Said, done: string, run: () => Promise<Outcome>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNote("");
    const outcome = await run();
    inFlight.current = false;
    setBusy(false);
    if (!outcome.ok && outcome.keep && asking) {
      setNote(outcome.text);
      return;
    }
    setAsking(null);
    await reread();
    said.say(outcome.ok ? done : outcome.text);
  }

  /**
   * What a refusal of a change to an invitation means, in words. `limited` is the sentence for
   * 429: the limits on sending an invitation again, or else the limit on requests of any kind.
   */
  const refusal = (res: { status: number }, limited: MessageKey): Outcome => {
    if (res.status === 429) return { ok: false, keep: false, text: t(limited, LIMITS_SAID) };
    if (res.status === 403) return { ok: false, keep: false, text: t("peopleNoAccess") };
    // Answered, cancelled or gone meanwhile: what the page showed is no longer so.
    if (res.status === 404 || res.status === 409) {
      return { ok: false, keep: false, text: t("peopleInvitationChanged") };
    }
    return { ok: false, keep: true, text: t("peopleUnconfirmed") };
  };

  const resend = (inv: PeopleInvitation) =>
    act(saidInvitations, t("peopleResent", { email: inv.email }), async () => {
      const res = await api(`/api/conferences/${slug}/people/invitations/${inv.id}/resend`, {
        method: "POST",
        body: {},
      });
      if (res.ok) return { ok: true };
      // Its review pools are no longer the conference's: the link could give nothing.
      if (res.error === "pools_gone") return { ok: false, keep: false, text: t("peoplePoolsGone") };
      // Nothing is open to keep: whatever happened is said at the list.
      const refused = refusal(res, "peopleResendLimited");
      return refused.ok ? refused : { ok: false, keep: false, text: refused.text };
    });

  const cancel = (inv: PeopleInvitation) =>
    act(
      saidInvitations,
      t(inv.state === "waiting" ? "peopleCancelled" : "peopleDismissed", { email: inv.email }),
      async () => {
        const res = await api(`/api/conferences/${slug}/people/invitations/${inv.id}/cancel`, {
          method: "POST",
          body: {},
        });
        return res.ok ? { ok: true } : refusal(res, "signInRateLimited");
      },
    );

  const remove = (
    said: Said,
    p: RoleHolder,
    role: RemovableRole,
    assigned?: number,
    sent?: number,
  ) =>
    act(said, t(`peopleRemoved_${role}`, { name: called(p) }), async () => {
      const res = await api(`/api/conferences/${slug}/people/${p.personId}/roles/${role}`, {
        method: "DELETE",
        // What the confirmation said: the server removes nothing if it is no longer so.
        body: role === "reviewer" ? { assignments: assigned ?? 0, reviews: sent ?? 0 } : {},
      });
      if (res.ok) return { ok: true };
      if (res.status === 409 && res.error === "stale") {
        // The number changed: the list is read again, and the question now says the new one.
        await reread();
        return { ok: false, keep: true, text: t("peopleRemoveStale") };
      }
      if (res.status === 403) return { ok: false, keep: false, text: t("peopleNoAccess") };
      if (res.status === 404 || res.status === 409) {
        return { ok: false, keep: false, text: t("peopleRemoveGone") };
      }
      if (res.status === 429) return { ok: false, keep: true, text: t("signInRateLimited") };
      return { ok: false, keep: true, text: t("peopleUnconfirmed") };
    });

  /** One role holder: who they are, what is known of them, and "Remove" where it is offered. */
  const person = (
    p: RoleHolder,
    v: {
      said: Said;
      role: RemovableRole;
      /** Unique on the page: a reviewer is listed once under each of their pools. */
      id: string;
      level: "h3" | "h4";
      you?: boolean;
      lines?: ReactNode;
      assigned?: number;
      /** How many of the assigned proposals have a review of theirs that was sent. */
      sent?: number;
    },
  ) => {
    const sent = v.sent ?? 0;
    /** The proposals that lose this reviewer: those without a review of theirs that was sent. */
    const losing = (v.assigned ?? 0) - sent;
    const key = `remove-${v.id}`;
    const opener = `${key}-open`;
    const name = called(p);
    return (
      <li key={v.id}>
        <p className="who">
          {p.displayName ?? t("peopleNoName")}{" "}
          {v.you && (
            <span className="badge" data-tone="info">
              {t("peopleYou")}
            </span>
          )}
        </p>
        <p className="meta">{p.email}</p>
        {v.lines}
        {asking?.key === key ? (
          <Ask
            level={v.level}
            question={t(`peopleAskRemove_${v.role}`, { name })}
            yes={t("peopleDoRemove")}
            busy={busy}
            note={note}
            onYes={() => remove(v.said, p, v.role, v.assigned, v.sent)}
            onNo={dismiss}
          >
            <p>{t(`peopleRemoveDoes_${v.role}`, { name })}</p>
            {v.role === "reviewer" && sent === 0 && (
              <p>
                <strong>
                  {v.assigned === 0
                    ? t("peopleRemoveAssignedNone")
                    : v.assigned === 1
                      ? t("peopleRemoveAssignedOne")
                      : t("peopleRemoveAssignedMany", { n: v.assigned ?? 0 })}
                </strong>
              </p>
            )}
            {/* A review that was sent stays, with the assignment it belongs to. */}
            {v.role === "reviewer" && sent > 0 && (
              <p>
                <strong>
                  {sent === 1 ? t("peopleRemoveKeepOne") : t("peopleRemoveKeepMany", { n: sent })}{" "}
                  {losing === 0
                    ? t("peopleRemoveLoseNone")
                    : losing === 1
                      ? t("peopleRemoveLoseOne")
                      : t("peopleRemoveLoseMany", { n: losing })}
                </strong>
              </p>
            )}
            {v.role === "reviewer" && <p>{t("peopleRemoveDrafts")}</p>}
          </Ask>
        ) : (
          // A chair cannot remove their own role: the button is not offered (the server refuses).
          !v.you && (
            <p className="actions">
              <button
                type="button"
                className="secondary"
                id={opener}
                aria-label={t(`peopleRemoveFor_${v.role}`, { name })}
                onClick={() => ask(key, opener)}
              >
                {t("peopleRemove")}
              </button>
            </p>
          )
        )}
      </li>
    );
  };

  const assignedText = (n: number) =>
    n === 0
      ? t("peopleAssignedNone")
      : n === 1
        ? t("peopleAssignedOne")
        : t("peopleAssignedMany", { n });
  const reviewer = (r: People["reviewers"][number], group: string) =>
    person(r, {
      said: saidReviewers,
      role: "reviewer",
      id: `reviewer-${group}-${r.personId}`,
      level: "h4",
      assigned: r.assigned,
      sent: r.sent,
      lines: (
        <>
          <p>
            {assignedText(r.assigned)}
            {r.sent > 0 &&
              ` · ${r.sent === 1 ? t("peopleSentOne") : t("peopleSentMany", { n: r.sent })}`}
          </p>
          {r.maxLoad !== null && (
            <p className="meta">
              {t("peopleOffers", {
                max: r.maxLoad,
                languages: r.languages.map((l) => LANG_NAMES[l as Lang] ?? l).join(", "),
              })}
            </p>
          )}
        </>
      ),
    });
  const known = new Set(config.reviewPools.map((p) => p.key));
  /** Reviewers none of whose pools the conference still has: listed, so that nobody is hidden. */
  const adrift = data.reviewers.filter((r) => !r.pools.some((k) => known.has(k)));

  return (
    <div className="people-page">
      <PageHeading title={t("peopleTitle")}>{t("peopleTitle")}</PageHeading>
      <p className="meta">
        <Localized text={config.title} fallback={config.defaultLanguage} />
      </p>
      <p>{t("peopleIntro")}</p>
      <p>
        <Link className="block-link" to={`/${lang}/c/${slug}/manage`}>
          {t("settingsBackToManage")}
        </Link>
      </p>

      <section aria-labelledby="people-invite-title">
        <h2 id="people-invite-title">{t("peopleInviteTitle")}</h2>
        <p>{t("peopleInviteIntro", { days: ROLE_INVITATIONS.days })}</p>
        <InviteForm
          slug={slug}
          config={config}
          said={saidInvite}
          onInvited={async (email) => {
            await reread();
            saidInvite.say(t("peopleInvited", { email }));
          }}
        />
        <StatusLine said={saidInvite} />
      </section>

      <section aria-labelledby="people-chairs-title">
        <h2 id="people-chairs-title">{t("peopleChairsTitle")}</h2>
        <p className="meta">{t("peopleChairsIntro")}</p>
        <StatusLine said={saidChairs} />
        <ul className="roster">
          {data.chairs.map((c) =>
            person(c, {
              said: saidChairs,
              role: "chair",
              id: `chair-${c.personId}`,
              level: "h3",
              you: c.you,
            }),
          )}
        </ul>
      </section>

      <section aria-labelledby="people-reviewers-title">
        <h2 id="people-reviewers-title">{t("peopleReviewersTitle")}</h2>
        <p className="meta">{t("peopleReviewersIntro")}</p>
        <StatusLine said={saidReviewers} />
        {config.reviewPools.map((pool) => {
          const members = data.reviewers.filter((r) => r.pools.includes(pool.key));
          return (
            <div key={pool.key} className="stack wide">
              <h3>
                <Localized text={pool.name} fallback={config.defaultLanguage} />
              </h3>
              {members.length === 0 ? (
                <p className="meta">{t("peoplePoolEmpty")}</p>
              ) : (
                <ul className="roster">{members.map((r) => reviewer(r, pool.key))}</ul>
              )}
            </div>
          );
        })}
        {adrift.length > 0 && (
          <div className="stack wide">
            <h3>{t("peoplePoolGone")}</h3>
            <ul className="roster">{adrift.map((r) => reviewer(r, "none"))}</ul>
          </div>
        )}
      </section>

      {/* Kept while its line has something to say: removing the last track chair is said here. */}
      {(data.trackChairs.length > 0 || saidTracks.text !== "") && (
        <section aria-labelledby="people-tracks-title">
          <h2 id="people-tracks-title">{t("peopleTrackChairsTitle")}</h2>
          <p className="meta">{t("peopleTrackChairsIntro")}</p>
          <StatusLine said={saidTracks} />
          <ul className="roster">
            {data.trackChairs.map((x) =>
              person(x, {
                said: saidTracks,
                role: "track_chair",
                id: `track-${x.personId}`,
                level: "h3",
                lines: (
                  <p>
                    {x.tracks.length === 0
                      ? t("peopleAllTracks")
                      : t("peopleTracks", { tracks: x.tracks.map(trackName).join(", ") })}
                  </p>
                ),
              }),
            )}
          </ul>
        </section>
      )}

      <section aria-labelledby="people-invitations-title">
        <h2 id="people-invitations-title">{t("peopleInvitationsTitle")}</h2>
        <p className="meta">{t("peopleInvitationsIntro")}</p>
        <StatusLine said={saidInvitations} />
        {data.invitations.length === 0 ? (
          <p className="meta">{t("peopleInvitationsNone")}</p>
        ) : (
          <ul className="roster">
            {data.invitations.map((inv) => {
              const key = `invitation-${inv.id}`;
              const opener = `${key}-open`;
              const waiting = inv.state === "waiting";
              return (
                <li key={inv.id}>
                  {/* As the chair typed it: the address, and the name if one was typed. */}
                  <p className="who">{inv.email}</p>
                  {inv.name && <p className="meta">{inv.name}</p>}
                  <p>
                    {inv.role === "chair"
                      ? t("peopleInvitationRole_chair")
                      : t("peopleInvitationRole_reviewer", {
                          pools: inv.pools.map(poolName).join(", "),
                        })}
                  </p>
                  <p>
                    <span className="badge" data-tone={waiting ? "warn" : undefined}>
                      {t(`peopleInvState_${inv.state}`)}
                    </span>
                  </p>
                  <p className="meta">
                    {t("peopleInvSent", { date: when(inv.sentAt) })}
                    {" · "}
                    {inv.state === "declined" && inv.answeredAt
                      ? t("peopleInvDeclined", { date: when(inv.answeredAt) })
                      : t(waiting ? "peopleInvExpires" : "peopleInvExpired", {
                          date: when(inv.expiresAt),
                        })}
                  </p>
                  {asking?.key === key ? (
                    <Ask
                      level="h3"
                      question={t(waiting ? "peopleAskCancel" : "peopleAskDismiss", {
                        email: inv.email,
                      })}
                      yes={t(waiting ? "peopleDoCancel" : "peopleDoDismiss")}
                      busy={busy}
                      note={note}
                      onYes={() => cancel(inv)}
                      onNo={dismiss}
                    >
                      <p>{t(waiting ? "peopleCancelDoes" : "peopleDismissDoes")}</p>
                    </Ask>
                  ) : (
                    <p className="actions">
                      {inv.state !== "declined" && (
                        // aria-disabled while a request is on its way, so focus stays put.
                        <button
                          type="button"
                          className="secondary"
                          aria-label={t("peopleResendFor", { email: inv.email })}
                          aria-disabled={busy ? "true" : undefined}
                          onClick={() => resend(inv)}
                        >
                          {t("peopleResend")}
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        id={opener}
                        aria-label={t(waiting ? "peopleCancelFor" : "peopleDismissFor", {
                          email: inv.email,
                        })}
                        onClick={() => ask(key, opener)}
                      >
                        {t(waiting ? "peopleCancel" : "peopleDismiss")}
                      </button>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

type FieldErrors = { email?: MessageKey; name?: MessageKey; pools?: MessageKey };

/** Invite one address: its role, a reviewer's pools, and the language of the email. */
function InviteForm({
  slug,
  config,
  said,
  onInvited,
}: {
  slug: string;
  config: ConferenceConfig;
  said: Said;
  onInvited: (email: string) => Promise<void>;
}) {
  const { lang, t } = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<InvitableRole>("reviewer");
  // A conference with one pool has nothing to choose.
  const [pools, setPools] = useState<Set<string>>(
    () => new Set(config.reviewPools.length === 1 ? config.reviewPools.map((p) => p.key) : []),
  );
  const [mailLang, setMailLang] = useState<Lang>(lang);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const poolsRef = useRef<HTMLFieldSetElement>(null);

  /** Show what is wrong at each field, and put focus in the first of them. */
  function refuse(next: FieldErrors) {
    setErrors(next);
    if (next.email) emailRef.current?.focus();
    else if (next.name) nameRef.current?.focus();
    else if (next.pools) poolsRef.current?.querySelector("input")?.focus();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const address = email.trim();
    const typed = cleanName(name);
    const chosen = config.reviewPools.map((p) => p.key).filter((k) => pools.has(k));
    const wrong: FieldErrors = {};
    if (!address) wrong.email = "peopleEmailInvalid";
    if (role === "reviewer" && chosen.length === 0) wrong.pools = "peoplePoolsRequired";
    if (wrong.email || wrong.pools) return refuse(wrong);
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    said.say("");
    const res = await api<{ id: string }>(`/api/conferences/${slug}/people/invitations`, {
      method: "POST",
      body: {
        email: address,
        ...(typed ? { name: typed } : {}),
        role,
        pools: role === "reviewer" ? chosen : [],
        lang: mailLang,
      },
    });
    inFlight.current = false;
    setBusy(false);
    if (res.ok) {
      // The role, the pools and the language stay as they are: the next invitation is often alike.
      setEmail("");
      setName("");
      return onInvited(address);
    }
    const at = (path: string) => res.issues.some((i) => i.path === path);
    if (res.error === "already_invited") return refuse({ email: "peopleAlreadyInvited" });
    if (res.error === "already_has_role") return refuse({ email: "peopleAlreadyHasRole" });
    if (at("email") || at("name") || at("pools")) {
      return refuse({
        ...(at("email") ? { email: "peopleEmailInvalid" } : {}),
        ...(at("name") ? { name: "peopleNameInvalid" } : {}),
        ...(at("pools") ? { pools: "peoplePoolsRequired" } : {}),
      });
    }
    if (res.status === 429) return said.say(t("peopleInviteLimited", LIMITS_SAID));
    if (res.status === 403) return said.say(t("peopleNoAccess"));
    said.say(t("peopleUnconfirmed"));
  }

  return (
    <form className="stack wide" onSubmit={send} noValidate>
      <label htmlFor="people-email">{t("peopleInviteEmail")} *</label>
      <input
        id="people-email"
        ref={emailRef}
        type="email"
        inputMode="email"
        autoComplete="off"
        maxLength={254}
        required
        value={email}
        aria-invalid={errors.email ? "true" : undefined}
        aria-describedby={errors.email ? "people-email-error" : undefined}
        onChange={(e) => {
          setEmail(e.target.value);
          setErrors((was) => ({ ...was, email: undefined }));
        }}
      />
      {errors.email && (
        <p className="field-error" id="people-email-error">
          {t(errors.email)}
        </p>
      )}

      <label htmlFor="people-name">{t("peopleInviteName")}</label>
      <p className="setting-hint" id="people-name-hint">
        {t("peopleInviteNameHint")}
      </p>
      <input
        id="people-name"
        ref={nameRef}
        type="text"
        autoComplete="off"
        maxLength={LIMITS.name}
        value={name}
        aria-invalid={errors.name ? "true" : undefined}
        aria-describedby={errors.name ? "people-name-hint people-name-error" : "people-name-hint"}
        onChange={(e) => {
          setName(e.target.value);
          setErrors((was) => ({ ...was, name: undefined }));
        }}
      />
      {errors.name && (
        <p className="field-error" id="people-name-error">
          {t(errors.name, { max: LIMITS.name })}
        </p>
      )}

      <fieldset>
        <legend>{t("peopleInviteRole")}</legend>
        {(["reviewer", "chair"] as const).map((r) => (
          <div key={r}>
            <label className="choice">
              <input
                type="radio"
                name="people-role"
                value={r}
                checked={role === r}
                aria-describedby={`people-role-${r}-does`}
                onChange={() => setRole(r)}
              />
              <span>{t(`peopleInviteRole_${r}`)}</span>
            </label>
            {/* What the role may do, said with the choice and not as part of its name. */}
            <p className="choice-hint" id={`people-role-${r}-does`}>
              {t(`peopleInviteRoleDoes_${r}`)}
            </p>
          </div>
        ))}
      </fieldset>

      {role === "reviewer" && (
        <fieldset
          ref={poolsRef}
          aria-describedby={
            errors.pools ? "people-pools-hint people-pools-error" : "people-pools-hint"
          }
        >
          <legend>{t("peopleInvitePools")} *</legend>
          <p className="setting-hint" id="people-pools-hint">
            {t("peopleInvitePoolsHint")}
          </p>
          {config.reviewPools.map((pool) => (
            <label key={pool.key} className="choice">
              <input
                type="checkbox"
                checked={pools.has(pool.key)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setPools((was) => {
                    const next = new Set(was);
                    if (checked) next.add(pool.key);
                    else next.delete(pool.key);
                    return next;
                  });
                  setErrors((was) => ({ ...was, pools: undefined }));
                }}
              />
              <span>
                <Localized text={pool.name} fallback={config.defaultLanguage} />
              </span>
            </label>
          ))}
          {errors.pools && (
            <p className="field-error" id="people-pools-error">
              {t(errors.pools)}
            </p>
          )}
        </fieldset>
      )}

      <label htmlFor="people-lang">{t("peopleInviteLang")}</label>
      <select
        id="people-lang"
        value={mailLang}
        onChange={(e) => setMailLang(e.target.value as Lang)}
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>

      <p className="setting-hint" id="people-limits">
        {t("peopleInviteLimits", LIMITS_SAID)}
      </p>
      <p className="actions">
        {/* aria-disabled while the invitation is on its way, so focus stays on the button. */}
        <button
          type="submit"
          aria-describedby="people-limits"
          aria-disabled={busy ? "true" : undefined}
        >
          {t("peopleInviteSend")}
        </button>
      </p>
    </form>
  );
}
