import {
  ACTION_TIMING,
  canActOnSubmission,
  type PersonViewer,
  type SubmissionAction,
  type SubmissionRecord,
  submissionAccess,
  WITHDRAW_PHASES,
} from "@elochair/policy";
import {
  findType,
  isCallOpen,
  localize,
  type Person,
  type SubmissionIssue,
} from "@elochair/schema";
import { eq } from "drizzle-orm";
import type { Deps } from "../context";
import type { Db } from "../db/client";
import { submissions } from "../db/schema";
import { deliverPending, enqueueMail, type MailMessage } from "../mail";
import { type ConferenceRow, loadSubmission } from "../repo";
import { Refusal } from "../routes/common";
import { type MailLang, mailLang } from "../templates";

export type MutationContext = {
  tx: Db;
  viewer: PersonViewer;
  conference: ConferenceRow;
  rec: SubmissionRecord;
  now: Date;
  /** Queue mail inside the transaction: it is sent only if the change commits. */
  mail: (kind: string, msg: MailMessage) => Promise<void>;
};

/**
 * Run one change to a submission: lock its row, re-read it, check the policy, the call window
 * and phase, then apply `fn` — all in one transaction with one `now`. Mail queued by `fn` goes
 * out after commit.
 */
export async function mutateSubmission<T>(
  deps: Deps,
  viewer: PersonViewer,
  submissionId: string,
  action: SubmissionAction,
  fn: (ctx: MutationContext) => Promise<T>,
): Promise<T> {
  const now = deps.now();
  const result = await deps.db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .for("update");
    const loaded = await loadSubmission(tx, submissionId);
    if (!loaded || submissionAccess(viewer, loaded.rec) === "none") {
      throw new Refusal(404, "not_found");
    }
    const { conference, rec } = loaded;
    if (!canActOnSubmission(viewer, rec, action)) throw new Refusal(403, "forbidden");
    const timing = ACTION_TIMING[action];
    if (timing === "open_call" && !isCallOpen(conference.config, conference.phase, now)) {
      throw new Refusal(409, "call_closed");
    }
    if (timing === "withdraw_phases" && !WITHDRAW_PHASES.has(conference.phase)) {
      throw new Refusal(409, "call_closed");
    }
    return fn({
      tx,
      viewer,
      conference,
      rec,
      now,
      mail: (kind, msg) => enqueueMail(tx, kind, msg, now),
    });
  });
  deliverPending(deps.db, deps.mail, { now: deps.now }).catch((err) =>
    console.error("mail delivery failed", err),
  );
  return result;
}

export function requireVersion(rec: SubmissionRecord, version: number): void {
  if (rec.submission.version !== version) {
    throw new Refusal(409, "stale", { version: rec.submission.version });
  }
}

export function unprocessable(issues: SubmissionIssue[]): never {
  throw new Refusal(422, "invalid", { issues });
}

/** Localized conference title and format label, and a link to the submission, for mail. */
export function mailContext(
  conference: ConferenceRow,
  rec: SubmissionRecord,
  lang: MailLang,
  origin: string,
) {
  const config = conference.config;
  const type = findType(config, rec.submission.typeKey);
  return {
    conference: localize(config.title, lang, config.defaultLanguage),
    format: type ? localize(type.name, lang, config.defaultLanguage) : rec.submission.typeKey,
    link: `${origin}/${lang}/s/${rec.submission.id}`,
  };
}

export function personLang(person: Person | undefined, conference: ConferenceRow): MailLang {
  return mailLang(person?.languages ?? [], conference.config.defaultLanguage);
}
