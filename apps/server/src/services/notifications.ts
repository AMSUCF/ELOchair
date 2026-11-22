import {
  choicesInForce,
  type EmailChoicesView,
  emailRoles,
  type NoticeEmail,
  noticesWait,
  type PendingNotice,
  type PersonViewer,
  planNotices,
  projectEmailChoices,
  reviewsOpen,
  type StoredChoices,
  unsentReviews,
} from "@elochair/policy";
import {
  type DeclineReason,
  dailyHourAtOrBefore,
  formatDeadline,
  localize,
  type NoticeFrequency,
  type NotificationChoicesInput,
  type NotificationKind,
  type Person,
  REVIEW_EMAILS,
  reviewReminderWindow,
} from "@elochair/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { audit } from "../audit";
import type { Deps } from "../context";
import type { Db } from "../db/client";
import {
  conferenceRoles,
  conferences,
  notificationChoices,
  notifications,
  reviewReminders,
} from "../db/schema";
import { enqueueMail, type MailMessage } from "../mail";
import {
  type ConferenceRow,
  getConference,
  getConferenceById,
  getPerson,
  listConferences,
  loadPersonViewer,
  loadSentReviews,
  loadSubmissionRecords,
} from "../repo";
import { Refusal } from "../routes/common";
import {
  mailLang,
  newAssignmentsMessage,
  reviewerDeclinedMessage,
  reviewReminderMessage,
  reviewsCompleteMessage,
} from "../templates";

/*
 * The emails of the review phase (spec 03, §1.7): new assignments and one reminder to a
 * reviewer; a proposal given back, and a proposal with all its reviews, to a chair.
 *
 * Two halves, and nothing else sends these emails:
 * - WHEN SOMETHING HAPPENS it is recorded, in the transaction of what caused it, as a row of
 *   `notifications` for each person to be told (recordNotifications): who, which conference,
 *   which proposal, what kind, when. No email is made there, and no choice is read. Nobody is
 *   told of what they did themselves.
 * - ONE JOB (runNotifications) looks at what is waiting, each time the server's mail timer
 *   turns (main.ts), and decides by each person's choice as it is then: an email for each one
 *   at once; one summary a day, once the conference's clock has passed the summary's hour; or
 *   none. The reminder before reviews are due is decided by the same job. What it composes
 *   goes to the outbox, and is delivered as every other email is.
 *
 * What a notification is made into is decided in packages/policy (planNotices): whether it
 * still holds for that person is asked again there, and an email is handed a number and
 * reasons out of three, never a title or a name.
 *
 * The job may run twice, and may miss a run:
 * - a notification is answered once: its row is marked in the transaction that writes the
 *   outbox row, and a run that finds it marked (or held by another run) leaves it alone;
 * - a reminder goes out once for a conference and a day: `review_reminders` holds a row for
 *   every day that was reminded, written in the transaction that writes the reminders;
 * - a summary whose hour passed while the server was down is due at the next run, and so is a
 *   reminder, until the day reviews are due.
 * The job takes none of the locks of services/roles.ts: what it reads may be a moment old, and
 * someone taken off a proposal in that moment may still be told of it.
 */

/** The message each kind of notification is sent as: also the `kind` of its outbox row. */
const MESSAGE_OF = {
  assigned: "new_assignments",
  declined: "reviewer_declined",
  reviews_complete: "reviews_complete",
} as const satisfies Record<NotificationKind, string>;

/**
 * Record that people are to be told of something, inside the transaction of what happened.
 * `by` is whoever did it: they are told nothing of their own act (a chair who assigns a
 * proposal to themself, or who reviews and gives one back). `reason` is for a proposal given
 * back: why the reviewer said they cannot review it.
 */
export async function recordNotifications(
  tx: Db,
  v: {
    conferenceId: string;
    submissionId: string;
    kind: NotificationKind;
    personIds: readonly string[];
    by: string;
    reason?: DeclineReason;
    now: Date;
  },
): Promise<void> {
  const told = [...new Set(v.personIds)].filter((personId) => personId !== v.by);
  if (told.length === 0) return;
  await tx.insert(notifications).values(
    told.map((personId) => ({
      conferenceId: v.conferenceId,
      personId,
      kind: v.kind,
      submissionId: v.submissionId,
      reason: v.reason ?? null,
      createdAt: v.now,
    })),
  );
}

/**
 * The people a conference's notices about reviewing are recorded for: everyone who holds the
 * `chair` or the `admin` role there. Whether a notice is one of theirs to get (never about
 * their own proposal, or one they have a conflict with) is decided when the email is made,
 * where it is asked again anyway (notificationHolds in packages/policy).
 */
export async function chairsToTell(tx: Db, conferenceId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ personId: conferenceRoles.personId })
    .from(conferenceRoles)
    .where(
      and(
        eq(conferenceRoles.conferenceId, conferenceId),
        inArray(conferenceRoles.role, ["chair", "admin"]),
      ),
    );
  return rows.map((r) => r.personId);
}

type ChoicesRow = typeof notificationChoices.$inferSelect;

const toStored = (row: ChoicesRow): StoredChoices => ({
  personId: row.personId,
  conferenceId: row.conferenceId,
  assignments: row.assignments as NoticeFrequency,
  reminder: row.reminder,
  chairNotices: row.chairNotices as NoticeFrequency,
});

/**
 * "Your account": the person's own choices at each conference where they review or chair
 * (projectEmailChoices). Conferences where they hold no role are not even loaded.
 */
export async function readEmailChoices(db: Db, viewer: PersonViewer): Promise<EmailChoicesView[]> {
  const held = new Set(viewer.grants.map((g) => g.conferenceId));
  if (held.size === 0) return [];
  const stored = (
    await db
      .select()
      .from(notificationChoices)
      .where(eq(notificationChoices.personId, viewer.personId))
  ).map(toStored);
  const out: EmailChoicesView[] = [];
  for (const k of await listConferences(db)) {
    if (!held.has(k.id)) continue;
    const view = projectEmailChoices(
      viewer,
      k,
      stored.find((s) => s.conferenceId === k.id),
    );
    if (view) out.push(view);
  }
  return out;
}

/**
 * A person changes their own choices at one conference. A choice that is left out stays as it
 * is. Returns the choices as they are afterwards.
 * - 404 `not_found` for a conference where none of these emails is theirs (they neither review
 *   nor chair there, or it is archived, or there is no such conference): one answer for all.
 * - 403 `forbidden` for a choice that belongs to a role they do not hold there: a reviewer's
 *   (`assignments`, `reminder`) or a chair's (`chairNotices`).
 * Audited with the values chosen, which are enumerations and a yes or no.
 */
export async function saveEmailChoices(
  deps: Deps,
  viewer: PersonViewer,
  slug: string,
  input: NotificationChoicesInput,
): Promise<EmailChoicesView> {
  const k = await getConference(deps.db, slug);
  if (!k || !projectEmailChoices(viewer, k, null)) throw new Refusal(404, "not_found");
  const roles = emailRoles(viewer, k.id);
  const reviewers = input.assignments !== undefined || input.reminder !== undefined;
  if ((reviewers && !roles.reviewer) || (input.chairNotices !== undefined && !roles.chair)) {
    throw new Refusal(403, "forbidden");
  }
  const chosen = {
    ...(input.assignments === undefined ? {} : { assignments: input.assignments }),
    ...(input.reminder === undefined ? {} : { reminder: input.reminder }),
    ...(input.chairNotices === undefined ? {} : { chairNotices: input.chairNotices }),
  };
  const row = await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const [saved] = await tx
      .insert(notificationChoices)
      .values({ personId: viewer.personId, conferenceId: k.id, ...chosen })
      .onConflictDoUpdate({
        target: [notificationChoices.personId, notificationChoices.conferenceId],
        set: chosen,
      })
      .returning();
    await audit(tx, viewer, {
      action: "person.email_choices_changed",
      conferenceId: k.id,
      targetType: "person",
      targetId: viewer.personId,
      details: chosen,
    });
    return saved;
  });
  const view = projectEmailChoices(viewer, k, row ? toStored(row) : null);
  if (!view) throw new Refusal(404, "not_found");
  return view;
}

/** What one run of the job did. */
export type NotificationRun = {
  /** Emails put in the outbox, and how many of them were reminders. */
  emails: number;
  reminders: number;
  /** Notifications answered by no email. */
  dropped: number;
};

type Recipient = { viewer: PersonViewer; person: Person };

async function recipient(db: Db, personId: string): Promise<Recipient | null> {
  const viewer = await loadPersonViewer(db, personId);
  const person = await getPerson(db, personId);
  return viewer && person ? { viewer, person } : null;
}

/** The links every one of these emails carries, in the reader's language. */
const links = (origin: string, lang: string, slug: string) => ({
  reviews: `${origin}/${lang}/reviews`,
  assignments: `${origin}/${lang}/c/${slug}/assignments`,
  choices: `${origin}/${lang}/me#emails`,
});

/** One email of one kind, for one person, from what the policy handed over. */
function noticeMail(
  kind: NotificationKind,
  conference: ConferenceRow,
  to: Person,
  email: NoticeEmail,
  origin: string,
): MailMessage {
  const { config } = conference;
  const lang = mailLang(to.languages, config.defaultLanguage);
  const at = links(origin, lang, conference.slug);
  const common = {
    conference: localize(config.title, lang, config.defaultLanguage),
    count: email.count,
    choices: at.choices,
  };
  if (kind === "assigned") {
    return newAssignmentsMessage(config, lang, to.email, {
      ...common,
      link: at.reviews,
      deadline: config.deadlines.reviewsDue
        ? formatDeadline(config.deadlines.reviewsDue, config.timezone, lang)
        : null,
    });
  }
  return kind === "declined"
    ? reviewerDeclinedMessage(config, lang, to.email, {
        ...common,
        link: at.assignments,
        reasons: email.reasons,
      })
    : reviewsCompleteMessage(config, lang, to.email, { ...common, link: at.assignments });
}

type NotificationRow = typeof notifications.$inferSelect;

const toPending = (row: NotificationRow): PendingNotice => ({
  id: row.id,
  kind: row.kind as NotificationKind,
  submissionId: row.submissionId,
  reason: row.reason as DeclineReason | null,
  createdAt: row.createdAt.toISOString(),
});

/** One conference's waiting notifications: an email, or none, for each person and kind. */
async function answerNotifications(
  deps: Pick<Deps, "db" | "env">,
  conferenceId: string,
  waiting: NotificationRow[],
  now: Date,
): Promise<{ emails: number; dropped: number }> {
  const { db } = deps;
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  const done = { emails: 0, dropped: 0 };
  const conference = await getConferenceById(db, conferenceId);
  if (!conference) return done;
  const summaryAt = dailyHourAtOrBefore(now, conference.config.timezone, REVIEW_EMAILS.dailyHour);
  const stored = (
    await db
      .select()
      .from(notificationChoices)
      .where(eq(notificationChoices.conferenceId, conferenceId))
  ).map(toStored);

  // One person's notifications of one kind, with how they chose to be told of them.
  const byPersonAndKind = new Map<string, NotificationRow[]>();
  for (const row of waiting) {
    const key = `${row.personId} ${row.kind}`;
    byPersonAndKind.set(key, [...(byPersonAndKind.get(key) ?? []), row]);
  }
  const groups = [...byPersonAndKind.values()].flatMap((rows) => {
    const [first] = rows;
    if (!first) return [];
    const kind = first.kind as NotificationKind;
    const choices = choicesInForce(
      first.personId,
      conferenceId,
      stored.find((s) => s.personId === first.personId),
    );
    const asked = {
      kind,
      frequency: kind === "assigned" ? choices.assignments : choices.chairNotices,
      phase: conference.phase,
      pending: rows.map(toPending),
      summaryAt,
    };
    return [{ personId: first.personId, kind, rows, asked }];
  });
  // Most runs find everything waiting (a summary for its hour, an assignment for review): then
  // nothing of the conference's proposals is read at all.
  const due = groups.filter((g) => !noticesWait(g.asked));
  if (due.length === 0) return done;

  const records = await loadSubmissionRecords(db, conference);
  const submissions = new Map(records.map((r) => [r.submission.id, r]));
  // How many reviews of each proposal are sent now, and nothing of what they say: a proposal
  // that was announced as having all its reviews must still have them (the chairs may have
  // raised the committee's number since).
  const sentReviews = new Map<string, number>();
  if (due.some((g) => g.kind === "reviews_complete")) {
    for (const review of await loadSentReviews(db, conference.id)) {
      sentReviews.set(review.submissionId, (sentReviews.get(review.submissionId) ?? 0) + 1);
    }
  }
  for (const { personId, kind, rows, asked } of due) {
    const to = await recipient(db, personId);
    if (!to) continue;
    const plan = planNotices(to.viewer, { ...asked, submissions, sentReviews });
    if (plan.action === "wait") continue;
    const mails = plan.emails.map((email) =>
      noticeMail(kind, conference, to.person, email, origin),
    );
    const sent = plan.emails.flatMap((email) => email.ids);
    const ids = rows.map((r) => r.id);
    // The marks and the outbox rows are written together, on rows this run holds: a second run
    // finds them marked, or waits here and then finds them so, and writes nothing.
    const written = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const held = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(inArray(notifications.id, ids), eq(notifications.status, "pending")))
        .for("update");
      if (held.length !== ids.length) return false;
      for (const mail of mails) await enqueueMail(tx, MESSAGE_OF[kind], mail, now);
      const mark = (which: string[], status: "sent" | "dropped") =>
        which.length
          ? tx
              .update(notifications)
              .set({ status, doneAt: now })
              .where(inArray(notifications.id, which))
          : null;
      await mark(sent, "sent");
      await mark(plan.dropped, "dropped");
      // What kind of thing, and how much of it: numbers only, and nobody is named. (Who was
      // written to is in the outbox; that something was dropped for someone is nobody's to
      // read.)
      await audit(tx, "system", {
        action: "notifications.answered",
        conferenceId,
        targetType: "conference",
        targetId: conferenceId,
        details: { kind, emails: mails.length, sent: sent.length, dropped: plan.dropped.length },
      });
      return true;
    });
    if (!written) continue;
    done.emails += mails.length;
    done.dropped += plan.dropped.length;
  }
  return done;
}

/**
 * A conference's reminder before reviews are due: to every reviewer who has reviews that are
 * not sent and has not turned it off, from the summary's hour on the day that is the chairs'
 * number of days before the day reviews are due (three, unless they set another), and until
 * that day. Decided once for all of them together, and remembered for the conference and the
 * day: the row is written with the reminders, and a second run finds it.
 *
 * No reminder where no day is set, where the conference is not in review, and once the day has
 * passed. If the chairs move the day afterwards, it is another day: reviewers are reminded of
 * it in its turn. A day that was reminded once stays reminded, also when the chairs move the
 * day away and back. Returns how many reminders were put in the outbox.
 */
async function remind(
  deps: Pick<Deps, "db" | "env">,
  conference: ConferenceRow,
  now: Date,
): Promise<number> {
  const { db } = deps;
  const window = reviewReminderWindow(conference.config);
  if (!window || !reviewsOpen(conference.phase)) return 0;
  if (now.getTime() < window.opens.getTime() || now.getTime() >= window.closes.getTime()) return 0;
  const [reminded] = await db
    .select({ reviewsDue: reviewReminders.reviewsDue })
    .from(reviewReminders)
    .where(
      and(
        eq(reviewReminders.conferenceId, conference.id),
        eq(reviewReminders.reviewsDue, window.closes),
      ),
    );
  if (reminded) return 0;

  const { config } = conference;
  const origin = new URL(deps.env.APP_ORIGIN).origin;
  const records = await loadSubmissionRecords(db, conference);
  // Which reviews were sent, and nothing of what they say.
  const sent = (await loadSentReviews(db, conference.id)).map((r) => ({
    submissionId: r.submissionId,
    reviewerId: r.reviewerId,
  }));
  const reviewers = await db
    .selectDistinct({ personId: conferenceRoles.personId })
    .from(conferenceRoles)
    .where(
      and(eq(conferenceRoles.conferenceId, conference.id), eq(conferenceRoles.role, "reviewer")),
    );
  const stored = (
    await db
      .select()
      .from(notificationChoices)
      .where(eq(notificationChoices.conferenceId, conference.id))
  ).map(toStored);
  const mails: MailMessage[] = [];
  for (const { personId } of reviewers) {
    const mine = stored.find((s) => s.personId === personId);
    if (!choicesInForce(personId, conference.id, mine).reminder) continue;
    const to = await recipient(db, personId);
    if (!to) continue;
    const count = unsentReviews(to.viewer, records, sent);
    if (count === 0) continue;
    const lang = mailLang(to.person.languages, config.defaultLanguage);
    const at = links(origin, lang, conference.slug);
    mails.push(
      reviewReminderMessage(config, lang, to.person.email, {
        conference: localize(config.title, lang, config.defaultLanguage),
        count,
        link: at.reviews,
        choices: at.choices,
        deadline: formatDeadline(window.closes.toISOString(), config.timezone, lang),
      }),
    );
  }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // One row for the conference and this day, and its key refuses a second: a run that
    // comes second finds the row, or waits here and then finds it, and sends nothing.
    const marked = await tx
      .insert(reviewReminders)
      .values({ conferenceId: conference.id, reviewsDue: window.closes, sentAt: now })
      .onConflictDoNothing({ target: [reviewReminders.conferenceId, reviewReminders.reviewsDue] })
      .returning({ conferenceId: reviewReminders.conferenceId });
    if (marked.length === 0) return 0;
    for (const mail of mails) await enqueueMail(tx, "review_reminder", mail, now);
    await audit(tx, "system", {
      action: "review_reminder.sent",
      conferenceId: conference.id,
      targetType: "conference",
      targetId: conference.id,
      details: { reminded: mails.length, reviewsDue: window.closes.toISOString() },
    });
    return mails.length;
  });
}

/**
 * One run of the job: every waiting notification is answered or left to wait, and every
 * conference in review is asked whether its reminder is due. Safe to run as often as one
 * likes. One conference that fails (a configuration that no longer reads) does not keep the
 * others waiting: it is logged, and tried again at the next run.
 */
export async function runNotifications(
  deps: Pick<Deps, "db" | "env" | "now">,
): Promise<NotificationRun> {
  const { db } = deps;
  const now = deps.now();
  const run: NotificationRun = { emails: 0, reminders: 0, dropped: 0 };
  const failed = (what: string, conferenceId: string, err: unknown) =>
    console.error(`${what} failed for conference ${conferenceId}`, err);

  const waiting = await db
    .select()
    .from(notifications)
    .where(eq(notifications.status, "pending"))
    .orderBy(asc(notifications.createdAt), asc(notifications.id));
  const byConference = new Map<string, NotificationRow[]>();
  for (const row of waiting) {
    byConference.set(row.conferenceId, [...(byConference.get(row.conferenceId) ?? []), row]);
  }
  for (const [conferenceId, rows] of byConference) {
    try {
      const done = await answerNotifications(deps, conferenceId, rows, now);
      run.emails += done.emails;
      run.dropped += done.dropped;
    } catch (err) {
      failed("notifications", conferenceId, err);
    }
  }

  const reviewing = await db
    .select({ id: conferences.id })
    .from(conferences)
    .where(eq(conferences.phase, "reviewing"));
  for (const { id } of reviewing) {
    try {
      const conference = await getConferenceById(db, id);
      if (conference) run.reminders += await remind(deps, conference, now);
    } catch (err) {
      failed("the reminder", id, err);
    }
  }
  run.emails += run.reminders;
  return run;
}
