import { type AgentViewer, projectSubmission } from "@elochair/policy";
import {
  Key,
  LanguageCode,
  ParticipationMode,
  SubmissionQuery,
  SubmissionStatus,
} from "@elochair/schema";
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
const failure = (code: string, extra: Record<string, unknown> = {}) => ({
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ error: code, ...extra }) }],
});

/**
 * list_submissions arguments: the REST query, with IDs and machine keys only. Free text cannot
 * pass as a type, track, language or cursor, so none can reach the audit row. Title search (q)
 * is the one free-text argument, and it is never audited.
 */
const ListQuery = SubmissionQuery.extend({
  type: Key.max(60).optional(),
  track: Key.max(60).optional(),
  cursor: z.uuid().optional(),
});
const QUERY_KEYS = new Set(Object.keys(ListQuery.shape));

/** The argument names (never their values) a failed parse complains about. */
const invalidArgs = (error: z.ZodError) => [
  ...new Set(
    error.issues
      .map((i) => String(i.path[0] ?? ""))
      .filter((key) => QUERY_KEYS.has(key))
      .sort(),
  ),
];

/** Keys the conference does not define are refused, not audited: an agent could spell a name. */
function unknownKeys(k: ConferenceRow, query: SubmissionQuery): string[] {
  const out: string[] = [];
  if (query.type && !k.config.submissionTypes.some((t) => t.key === query.type)) out.push("type");
  if (query.track && !k.config.tracks.some((t) => t.key === query.track)) out.push("track");
  if (query.language && !k.config.languages.includes(query.language)) out.push("language");
  return out;
}

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

  /**
   * One audit row per call, holding only arguments already validated as enums, keys or IDs.
   * `invalid` names arguments to refuse once the conference is known (their values not audited).
   */
  const withConference = async (
    tool: string,
    args: Record<string, unknown>,
    fn: (k: ConferenceRow) => Promise<unknown>,
    invalid: (k: ConferenceRow) => string[] = () => [],
  ) => {
    const k = await tokenConference(deps, agent);
    const refused = k ? invalid(k) : [];
    await record(tool, refused.length ? { invalid: refused } : args);
    if (!k || !viewerChairs(agent, k.id)) return failure("forbidden");
    if (refused.length) return failure("invalid", { args: refused });
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
        type: Key.max(60).optional(),
        track: Key.max(60).optional(),
        language: LanguageCode.optional(),
        participationMode: ParticipationMode.optional(),
        hasSelfIdWarnings: z.boolean().optional(),
        hasPendingInvitations: z.boolean().optional(),
        incomplete: z.boolean().optional(),
        q: z.string().max(200).optional(),
        cursor: z.uuid().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const tool = "list_submissions";
      // Validate before anything is written: the audit row holds parsed values only.
      const parsed = ListQuery.safeParse({ ...args, limit: args.limit ?? 100 });
      if (!parsed.success) {
        const invalid = invalidArgs(parsed.error);
        await record(tool, { invalid });
        return failure("invalid", { args: invalid });
      }
      const query = parsed.data;
      const { q, limit, ...filters } = query;
      const audited = {
        ...filters,
        ...(args.limit === undefined ? {} : { limit }),
        hasQuery: Boolean(q),
      };
      return withConference(
        tool,
        audited,
        async (k) => {
          try {
            return await querySubmissions(deps.db, agent, k, query);
          } catch (err) {
            if (err instanceof QueryNotAllowed) return { error: "q_not_allowed" };
            throw err;
          }
        },
        (k) => unknownKeys(k, query),
      );
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
