import {
  actingPerson,
  type ChairSubmission,
  isConferenceChair,
  type PersonViewer,
  projectSubmission,
  type Viewer,
} from "@elochair/policy";
import {
  ConferenceConfig,
  ConferencePhase,
  CreateSubmissionInput,
  callState,
  findType,
  isCallOpen,
  OneLine,
  SubmissionQuery,
  SubmissionStatus,
} from "@elochair/schema";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../audit";
import type { AppEnv } from "../context";
import { contributorsCsv, submissionsCsv } from "../csv";
import { cursorsFor } from "../cursor";
import type { Db } from "../db/client";
import { contributions, submissions } from "../db/schema";
import {
  type ConferenceRow,
  getConference,
  listConferences,
  loadSentReviews,
  loadSubmission,
  loadSubmissionRecords,
  lockConference,
  movePhase,
  shareConference,
  writeConfig,
} from "../repo";
import { everAssigned } from "../services/assignments";
import { capReportFor, chairsOf, conferenceOverview } from "../services/reports";
import { stillChair } from "../services/roles";
import { configToken, reviewConfig } from "../services/settings";
import {
  COUNTED_STATUSES,
  CursorRefused,
  QueryNotAllowed,
  queryAllSubmissions,
  querySubmissions,
  viewerChairs,
} from "../services/submissions";
import { Refusal, writer } from "./common";

/** Chairs (and their agents, for this conference) may see a conference before it is public. */
function canChair(viewer: Viewer, conferenceId: string): boolean {
  if (viewer.kind === "agent" && viewer.conferenceId !== conferenceId) return false;
  const p = actingPerson(viewer);
  return p !== null && isConferenceChair(p, conferenceId);
}

const visible = (viewer: Viewer, k: ConferenceRow) => k.phase !== "draft" || canChair(viewer, k.id);

/**
 * The person changing a conference's configuration, moving its phase or managing its people
 * (routes/people.ts), or a refusal. All of that is human-only: an agent may read a conference
 * but never reconfigure it, move it or give anyone a role. It is for the conference's chairs,
 * who are one group with its admins and the site admins (isConferenceChair). Track chairs and
 * reviewers are refused.
 *
 * This is the check before the transaction. A route that then writes reads the chair again
 * inside its transaction, under the conference's roles lock (stillChair, services/roles.ts): a
 * chair removed in between changes nothing.
 */
export async function chairInPerson(
  c: Context<AppEnv>,
): Promise<{ viewer: PersonViewer; k: ConferenceRow }> {
  const viewer = c.get("viewer");
  const k = await getConference(c.get("deps").db, c.req.param("slug") ?? "");
  // Draft conferences do not exist for people who cannot see them.
  if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
  if (viewer.kind !== "person" || !isConferenceChair(viewer, k.id)) {
    throw new Refusal(403, "forbidden");
  }
  return { viewer, k };
}

/** The token (configToken) of the configuration a change was based on, from If-Match. */
function baseToken(c: Context<AppEnv>): string | null {
  const raw = c.req.header("if-match")?.trim();
  return raw ? raw.replace(/^W\//, "").replace(/^"|"$/g, "") : null;
}

/** A configuration from a request body, which must be for the conference in the address. */
async function configBody(c: Context<AppEnv>, k: ConferenceRow): Promise<unknown> {
  const body = (await c.req.json()) as { slug?: unknown } | null;
  if (body?.slug !== k.slug) throw new Refusal(400, "slug_mismatch");
  return body;
}

function summary(k: ConferenceRow, now: Date) {
  const c = k.config;
  return {
    slug: k.slug,
    phase: k.phase,
    year: c.year,
    title: c.title,
    theme: c.theme,
    location: c.location,
    modality: c.modality,
    dates: c.dates,
    placeholder: c.placeholder,
    // The server clock decides, here as on the conference's own page.
    callOpen: isCallOpen(c, k.phase, now),
    callState: callState(c, k.phase, now),
  };
}

/** Drafts are never counted: they are visible to their contributors only. */
const Statuses = z
  .string()
  .default("submitted")
  .transform((s) => s.split(","))
  .pipe(z.array(SubmissionStatus.exclude(["draft"])).min(1));

export const conferenceRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const viewer = c.get("viewer");
    const { db, now } = c.get("deps");
    const all = await listConferences(db);
    const at = now();
    return c.json({
      conferences: all.filter((k) => visible(viewer, k)).map((k) => summary(k, at)),
    });
  })
  .get("/:slug", async (c) => {
    const k = await getConference(c.get("deps").db, c.req.param("slug"));
    if (!k || !visible(c.get("viewer"), k)) return c.json({ error: "not_found" }, 404);
    // The server clock decides whether the call is open, and whether it has yet to open or has
    // closed; the browser only displays it.
    const now = c.get("deps").now();
    return c.json({
      slug: k.slug,
      phase: k.phase,
      config: k.config,
      callOpen: isCallOpen(k.config, k.phase, now),
      callState: callState(k.config, k.phase, now),
    });
  })
  .get("/:slug/settings", async (c) => {
    const { k } = await chairInPerson(c);
    return c.json({
      slug: k.slug,
      phase: k.phase,
      callOpen: isCallOpen(k.config, k.phase, c.get("deps").now()),
      config: k.config,
      token: configToken(k.config),
    });
  })
  .post("/:slug/config/preview", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const { db, now } = c.get("deps");
    const input = await configBody(c, k);
    // What a save would do, without saving: changed values, problems, what blocks, what warns.
    const { review } = reviewConfig({
      viewer,
      conference: k,
      records: await loadSubmissionRecords(db, k),
      everAssigned: await everAssigned(db, k.id),
      sentReviews: await loadSentReviews(db, k.id),
      input,
      base: baseToken(c),
      now: now(),
    });
    return c.json(review);
  })
  .put("/:slug/config", async (c) => {
    const { viewer, k } = await chairInPerson(c);
    const deps = c.get("deps");
    const input = await configBody(c, k);
    const base = baseToken(c);
    // Two people saving at once: each says which configuration they started from.
    if (!base) throw new Refusal(428, "base_required");
    const next = ConferenceConfig.parse(input);
    const now = deps.now();
    // Under the conference's row lock, against the configuration and the submissions as they
    // are at that moment: submitted work stays valid, or nothing is saved (spec 02, §1.9).
    const warnings = await deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // Still a chair, read under the roles lock, which comes before the conference's row (the
      // one lock order, services/roles.ts): someone removed since the check above saves nothing.
      const actor = await stillChair(tx, viewer, k.id);
      const stored = await lockConference(tx, k.id);
      if (!stored) throw new Refusal(404, "not_found");
      const { review } = reviewConfig({
        viewer: actor,
        conference: stored,
        records: await loadSubmissionRecords(tx, stored),
        // Read under the conference's row: an assignment shares that row, so none is being
        // made while this is checked (services/assignments.ts).
        everAssigned: await everAssigned(tx, stored.id),
        // And so does every write of a review (services/reviews.ts): none is being sent while
        // this checks that the reviews already sent stay within their form.
        sentReviews: await loadSentReviews(tx, stored.id),
        input: next,
        base,
        now,
      });
      if (review.stale) throw new Refusal(409, "stale", { token: review.token });
      // What a valid configuration still may not do is named at the value that would do it,
      // as in the review: show the authors of a proposal that has been given a reviewer and is
      // reviewed anonymized (`reviewers_assigned`), change what an agreement says under the
      // version people have accepted (`agreement_version_required`), or leave a review that
      // was sent outside its form (`reviews_…`). The answer carries every such issue, under
      // the code of the first.
      const [refused] = review.issues;
      if (refused) throw new Refusal(409, refused.code, { issues: review.issues });
      if (review.blocked) {
        throw new Refusal(409, "submitted_work_invalid", { blocked: review.blocked });
      }
      if (review.changes.length === 0) return review.warnings;
      await writeConfig(tx, stored.id, next, now);
      await audit(tx, viewer, {
        action: "conference.config_updated",
        conferenceId: stored.id,
        targetType: "conference",
        targetId: stored.id,
        // Configuration holds no personal data: the values themselves are the record.
        details: { changes: review.changes, draftsAffected: review.warnings.drafts },
      });
      return review.warnings;
    });
    return c.json({
      slug: k.slug,
      phase: k.phase,
      config: next,
      token: configToken(next),
      warnings,
    });
  })
  .get("/:slug/overview", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
    if (!viewerChairs(viewer, k.id)) throw new Refusal(403, "forbidden");
    const records = await loadSubmissionRecords(db, k);
    return c.json(conferenceOverview(k, records, await chairsOf(db, k.id)));
  })
  .post("/:slug/submissions", async (c) => {
    const viewer = writer(c);
    const deps = c.get("deps");
    const k = await getConference(deps.db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
    const input = CreateSubmissionInput.parse(await c.req.json());
    const now = deps.now();
    const id = await deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // Like every write to a submission, a new one shares the conference's row (spec 02,
      // §1.9): it is checked against the phase and the configuration in force when it commits.
      const live = await shareConference(tx, k.id);
      if (!live || !visible(viewer, live)) throw new Refusal(404, "not_found");
      if (!isCallOpen(live.config, live.phase, now)) throw new Refusal(409, "call_closed");
      const issues = [];
      if (!findType(live.config, input.typeKey)) {
        issues.push({ path: "typeKey", code: "unknown_type" });
      }
      if (!live.config.languages.includes(input.language)) {
        issues.push({ path: "language", code: "unknown_language" });
      }
      if (issues.length) throw new Refusal(422, "invalid", { issues });
      const [row] = await tx
        .insert(submissions)
        .values({
          conferenceId: k.id,
          ownerPersonId: viewer.personId,
          typeKey: input.typeKey,
          language: input.language,
          participationMode: input.participationMode ?? null,
          title: "",
          abstract: "",
          fields: {},
          status: "draft",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: submissions.id });
      if (!row) throw new Error("insert failed");
      await tx.insert(contributions).values({
        submissionId: row.id,
        personId: viewer.personId,
        role: input.ownRole,
        position: 0,
        status: "confirmed",
      });
      await audit(tx, viewer, {
        action: "submission.created",
        conferenceId: k.id,
        targetType: "submission",
        targetId: row.id,
        details: { typeKey: input.typeKey },
      });
      return row.id;
    });
    const loaded = await loadSubmission(deps.db, id);
    return c.json(loaded && projectSubmission(viewer, loaded.rec), 201);
  })
  .get("/:slug/submissions", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
    const query = SubmissionQuery.parse(c.req.query());
    try {
      const cursors = cursorsFor(c.get("deps").env.SECRET_KEY);
      return c.json(await querySubmissions(db, viewer, k, query, { cursors }));
    } catch (err) {
      if (err instanceof QueryNotAllowed) throw new Refusal(400, "q_not_allowed");
      if (err instanceof CursorRefused) {
        // Shaped like any other malformed input (a ZodError): the paging has to start again.
        throw new Refusal(400, "invalid", {
          issues: [{ path: "cursor", message: "not a cursor from a previous page" }],
        });
      }
      throw err;
    }
  })
  .get("/:slug/submissions.csv", async (c) => csvExport(c, "submissions"))
  .get("/:slug/contributors.csv", async (c) => csvExport(c, "contributors"))
  .put("/:slug/phase", async (c) => {
    // Like the configuration, the phase is moved by a chair, in person.
    const { viewer, k } = await chairInPerson(c);
    const deps = c.get("deps");
    const input = PhaseInput.parse(await c.req.json());
    const now = deps.now();
    // Check and move under a row lock, against the phase the conference holds at that moment:
    // two chairs moving it at once cannot combine into a backward move nobody forced.
    await deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      // Still a chair, read under the roles lock, before movePhase() takes the conference's
      // row: someone removed since the check above moves nothing.
      await stillChair(tx, viewer, k.id);
      const moved = await movePhase(tx, k.id, {
        to: input.phase,
        from: input.from,
        force: input.force,
        reason: input.reason,
        now,
      });
      if (!moved.ok) {
        if (moved.code === "not_found") throw new Refusal(404, "not_found");
        throw new Refusal(409, moved.code, { from: moved.from, to: input.phase });
      }
      await audit(tx, viewer, {
        action: "conference.phase_changed",
        conferenceId: k.id,
        targetType: "conference",
        targetId: k.id,
        details: {
          from: moved.from,
          to: input.phase,
          forced: Boolean(input.force),
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
    });
    return c.json({ slug: k.slug, phase: input.phase });
  })
  .get("/:slug/cap-report", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) return c.json({ error: "not_found" }, 404);
    if (!canChair(viewer, k.id)) return c.json({ error: "forbidden" }, 403);
    const statuses = Statuses.parse(c.req.query("statuses"));
    // IDs and counts only: safe for tier M (cloud) agents. Decided on the acting person, so a
    // chair and their agents (either tier) get the same report.
    const report = capReportFor(viewer, k, await loadSubmissionRecords(db, k), statuses);
    return c.json({ statuses, ...report });
  });

const PhaseInput = z
  .object({
    phase: ConferencePhase,
    /** The phase the person saw when they asked: the move is refused (409 stale) if it has changed. */
    from: ConferencePhase.optional(),
    force: z.boolean().optional(),
    reason: OneLine(500).optional(),
  })
  .strict();

/**
 * Chair exports. Only humans who chair the conference, or their tier C agents on the internal
 * listener (tier C never reaches the public one). Rows: what the acting person may manage.
 */
async function csvExport(c: Context<AppEnv>, kind: "submissions" | "contributors") {
  const viewer = c.get("viewer");
  const { db } = c.get("deps");
  const k = await getConference(db, c.req.param("slug") ?? "");
  if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
  if (viewer.kind === "agent" && viewer.tier !== "C") throw new Refusal(403, "forbidden");
  if (!viewerChairs(viewer, k.id)) throw new Refusal(403, "forbidden");
  const person = actingPerson(viewer);
  const records = await loadSubmissionRecords(db, k);
  // Every matching row, page by page: a client's cursor or limit never shortens an export.
  const { cursor: _cursor, limit: _limit, ...filters } = c.req.query();
  const query = SubmissionQuery.parse(filters);
  const result = await queryAllSubmissions(db, viewer, k, query, records);
  const rows = result.items.filter((p): p is ChairSubmission => p.view === "chair");
  // Flag a row only where it counts toward an over-cap person's total: a confirmed, counted role
  // on a counted type (not a panelist on a panel, a coauthor, or a pending invitee).
  const overCap = new Set(
    capReportFor(viewer, k, records, COUNTED_STATUSES).over.flatMap((o) => o.submissionIds),
  );
  const body =
    kind === "submissions" ? submissionsCsv(k.config, rows, overCap) : contributorsCsv(rows);
  await audit(db, viewer, {
    action: "submissions.exported",
    conferenceId: k.id,
    details: {
      kind,
      rows: rows.length,
      omitted: result.excludedCount ?? 0,
      filters: Object.keys(filters).sort(),
      person: person?.personId ?? null,
    },
  });
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${k.slug}-${kind}.csv"`);
  c.header("Cache-Control", "no-store");
  c.header("X-Omitted-Rows", String(result.excludedCount ?? 0));
  return c.body(body);
}
