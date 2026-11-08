import {
  actingPerson,
  isConferenceAdmin,
  isConferenceChair,
  projectSubmission,
  submissionAccess,
  type Viewer,
} from "@elochair/policy";
import { presenterCapReport, SubmissionStatus } from "@elochair/schema";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../audit";
import type { AppEnv } from "../context";
import {
  type ConferenceRow,
  getConference,
  listConferences,
  loadSubmissionRecords,
  saveConference,
} from "../repo";

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
    return c.json({ slug: k.slug, phase: k.phase, config: k.config });
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
  .get("/:slug/submissions", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) return c.json({ error: "not_found" }, 404);
    const records = await loadSubmissionRecords(db, k);
    const projected = records.map((r) => projectSubmission(viewer, r)).filter((p) => p !== null);
    return c.json({ submissions: projected });
  })
  .get("/:slug/cap-report", async (c) => {
    const viewer = c.get("viewer");
    const { db } = c.get("deps");
    const k = await getConference(db, c.req.param("slug"));
    if (!k || !visible(viewer, k)) return c.json({ error: "not_found" }, 404);
    if (!canChair(viewer, k.id)) return c.json({ error: "forbidden" }, 403);
    const statuses = Statuses.parse(c.req.query("statuses"));
    // Count only submissions this viewer may manage: a chair's own or conflicted submissions
    // are left out (another chair checks those), so the report cannot reveal them.
    const records = (await loadSubmissionRecords(db, k)).filter((r) => {
      const access = submissionAccess(viewer, r);
      return access === "chair" || access === "metadata";
    });
    // IDs and counts only: safe for tier M (cloud) agents.
    const report = presenterCapReport(
      k.config,
      records.map((r) => r.submission),
      records.flatMap((r) => r.contributions),
      statuses,
    );
    return c.json({ statuses, ...report });
  });
