import {
  actingPerson,
  type ChairSubmission,
  isConferenceAdmin,
  isConferenceChair,
  projectSubmission,
  type Viewer,
} from "@elochair/policy";
import {
  ConferencePhase,
  CreateSubmissionInput,
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
  loadSubmission,
  loadSubmissionRecords,
  movePhase,
  saveConference,
} from "../repo";
import { capReportFor, chairsOf, conferenceOverview } from "../services/reports";
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

function summary(k: ConferenceRow) {
  const c = k.config;
  return {
    slug: k.slug,
    phase: k.phase,
    year: c.year,
    title: c.title,
    location: c.location,
    modality: c.modality,
    dates: c.dates,
    placeholder: c.placeholder,
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
    const all = await listConferences(c.get("deps").db);
    return c.json({ conferences: all.filter((k) => visible(viewer, k)).map(summary) });
  })
  .get("/:slug", async (c) => {
    const k = await getConference(c.get("deps").db, c.req.param("slug"));
    if (!k || !visible(c.get("viewer"), k)) return c.json({ error: "not_found" }, 404);
    // The server clock decides whether the call is open; the browser only displays it.
    const callOpen = isCallOpen(k.config, k.phase, c.get("deps").now());
    return c.json({ slug: k.slug, phase: k.phase, config: k.config, callOpen });
  })
  .put("/:slug/config", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    // Draft conferences do not exist for people who cannot see them.
    if (!k || !visible(viewer, k)) return c.json({ error: "not_found" }, 404);
    // Configuration changes are human-only: agents can read but not reconfigure a conference.
    if (viewer.kind !== "person" || !isConferenceAdmin(viewer, k.id)) {
      return c.json({ error: "forbidden" }, 403);
    }
    const body = (await c.req.json()) as { slug?: unknown };
    if (body.slug !== k.slug) return c.json({ error: "slug_mismatch" }, 400);
    const saved = await saveConference(db, body);
    const before = k.config as Record<string, unknown>;
    const after = saved.config as Record<string, unknown>;
    const changed = Object.keys(after).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    await audit(db, viewer, {
      action: "conference.config_updated",
      conferenceId: k.id,
      targetType: "conference",
      targetId: k.id,
      details: { changed },
    });
    return c.json({ slug: saved.slug, phase: saved.phase, config: saved.config });
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
    if (!isCallOpen(k.config, k.phase, now)) throw new Refusal(409, "call_closed");
    const issues = [];
    if (!findType(k.config, input.typeKey)) issues.push({ path: "typeKey", code: "unknown_type" });
    if (!k.config.languages.includes(input.language))
      issues.push({ path: "language", code: "unknown_language" });
    if (issues.length) throw new Refusal(422, "invalid", { issues });
    const id = await deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
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
    const viewer = c.get("viewer");
    const deps = c.get("deps");
    const k = await getConference(deps.db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) throw new Refusal(404, "not_found");
    // Phase changes are human-only and for conference admins.
    if (viewer.kind !== "person" || !isConferenceAdmin(viewer, k.id))
      throw new Refusal(403, "forbidden");
    const input = PhaseInput.parse(await c.req.json());
    const now = deps.now();
    // Check and move under a row lock, against the phase the conference holds at that moment:
    // two admins moving it at once cannot combine into a backward move nobody forced.
    await deps.db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const moved = await movePhase(tx, k.id, {
        to: input.phase,
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
