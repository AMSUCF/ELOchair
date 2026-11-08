import { type AgentViewer, projectSubmission } from "@elochair/policy";
import { ParticipationMode, SubmissionQuery, SubmissionStatus } from "@elochair/schema";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { audit } from "./audit";
import type { AppEnv, Deps } from "./context";
import { conferences } from "./db/schema";
import { type ConferenceRow, getConference, loadSubmission, loadSubmissionRecords } from "./repo";
import { capReportFor, chairsOf, conferenceOverview } from "./services/reports";
import {
  COUNTED_STATUSES,
  QueryNotAllowed,
  querySubmissions,
  viewerChairs,
} from "./services/submissions";

/*
 * MCP for chairs' agents, read-only. Mounted at /api/mcp so it inherits token resolution, the
 * tier C refusal on the public listener, and the agent audit. Every tool calls the same service
 * as its REST counterpart, through projections: tier M gets metadata, tier C exactly what its
 * owner would see. Each call writes one audit row with the tool name and its enum/ID arguments.
 */

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
const failure = (code: string) => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ error: code }) }],
});

async function tokenConference(deps: Deps, agent: AgentViewer): Promise<ConferenceRow | null> {
  const [row] = await deps.db
    .select({ slug: conferences.slug })
    .from(conferences)
    .where(eq(conferences.id, agent.conferenceId));
  return row ? getConference(deps.db, row.slug) : null;
}

function buildServer(deps: Deps, agent: AgentViewer): McpServer {
  const server = new McpServer({ name: "elochair", version: "0.2.0" });
  const record = (tool: string, args: Record<string, unknown>) =>
    audit(deps.db, agent, {
      action: "agent.mcp_tool",
      conferenceId: agent.conferenceId,
      details: { tool, args },
    });

  const withConference = async (
    tool: string,
    args: Record<string, unknown>,
    fn: (k: ConferenceRow) => Promise<unknown>,
  ) => {
    await record(tool, args);
    const k = await tokenConference(deps, agent);
    if (!k || !viewerChairs(agent, k.id)) return failure("forbidden");
    return json(await fn(k));
  };

  server.registerTool(
    "conference_overview",
    {
      title: "Conference overview",
      description:
        "Phase, deadlines, formats and tracks of the token's conference, with counts of submitted proposals by status, type, track, language and participation mode; the number of drafts in progress; submissions per day; and how many have self-identification warnings, pending co-author invitations, rule problems, or no chair who can manage them.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      withConference("conference_overview", {}, async (k) =>
        conferenceOverview(
          k,
          await loadSubmissionRecords(deps.db, k),
          await chairsOf(deps.db, k.id),
        ),
      ),
  );

  server.registerTool(
    "list_submissions",
    {
      title: "List submissions",
      description:
        "Submissions of the token's conference that the token may see, filtered and paged. Tier M (cloud) tokens get metadata only: IDs, statuses, enumerations, counts and dates. Title search (q) is refused for tier M.",
      inputSchema: {
        status: z.array(SubmissionStatus.exclude(["draft"])).optional(),
        type: z.string().max(60).optional(),
        track: z.string().max(60).optional(),
        language: z.string().max(10).optional(),
        participationMode: ParticipationMode.optional(),
        hasSelfIdWarnings: z.boolean().optional(),
        hasPendingInvitations: z.boolean().optional(),
        incomplete: z.boolean().optional(),
        q: z.string().max(200).optional(),
        cursor: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { q, ...rest } = args;
      return withConference("list_submissions", { ...rest, hasQuery: Boolean(q) }, async (k) => {
        try {
          return await querySubmissions(
            deps.db,
            agent,
            k,
            SubmissionQuery.parse({ ...args, limit: args.limit ?? 100 }),
          );
        } catch (err) {
          if (err instanceof QueryNotAllowed) return { error: "q_not_allowed" };
          throw err;
        }
      });
    },
  );

  server.registerTool(
    "get_submission",
    {
      title: "Get a submission",
      description: "One submission of the token's conference, as the token may see it.",
      inputSchema: { id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) =>
      withConference("get_submission", { id }, async (k) => {
        const loaded = await loadSubmission(deps.db, id);
        const out =
          loaded && loaded.conference.id === k.id ? projectSubmission(agent, loaded.rec) : null;
        return out ?? { error: "not_found" };
      }),
  );

  server.registerTool(
    "presenter_cap_report",
    {
      title: "Presenter-cap report",
      description:
        "Who holds more than the conference's cap of lead or presenting roles across submitted work: confirmed roles only, person IDs and counts, over the submissions the token's owner may manage, plus how many counted roles still await confirmation.",
      inputSchema: { statuses: z.array(SubmissionStatus.exclude(["draft"])).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ statuses }) =>
      withConference(
        "presenter_cap_report",
        { statuses: statuses ?? COUNTED_STATUSES },
        async (k) => ({
          statuses: statuses ?? COUNTED_STATUSES,
          ...capReportFor(
            agent,
            k,
            await loadSubmissionRecords(deps.db, k),
            statuses ?? COUNTED_STATUSES,
          ),
        }),
      ),
  );

  return server;
}

/** POST /api/mcp: stateless Streamable HTTP, JSON responses, agent tokens only. */
export async function mcpHandler(c: Context<AppEnv>): Promise<Response> {
  const viewer = c.get("viewer");
  if (viewer.kind !== "agent") {
    return c.json(
      {
        error: "token_required",
        message: "MCP is for agent tokens (Authorization: Bearer elo_m_… or elo_c_…).",
      },
      401,
    );
  }
  const server = buildServer(c.get("deps"), viewer);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}
