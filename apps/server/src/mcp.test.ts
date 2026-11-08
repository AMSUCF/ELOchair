import { findLeaks } from "@elochair/policy/testing";
import { conferences } from "@elochair/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "./context";
import { auditLog, people, submissions } from "./db/schema";
import { type SandboxSummary, seedSandbox } from "./fixtures";
import { createApiToken, saveConference } from "./repo";
import { call, makeTestApp, personId, type TestApp } from "./testkit";

let t: TestApp;
let s: SandboxSummary;
let tokenM: string;
let tokenC: string;
let markers: string[];

/** A real MCP client whose HTTP requests go straight into the in-process app. */
async function connect(app: Hono<AppEnv>, token: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://local/api/mcp"), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.request(String(input), init as RequestInit),
  });
  await client.connect(transport);
  return client;
}

const parse = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0]?.text ?? "null");

beforeAll(async () => {
  t = await makeTestApp();
  await saveConference(t.db, conferences.elo2027, "draft");
  s = await seedSandbox(t.db);
  const chairId = await personId(t, s.chairEmail);
  tokenM = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "M",
      name: "cloud",
    })
  ).token;
  tokenC = (
    await createApiToken(t.db, {
      personId: chairId,
      conferenceId: s.conferenceId,
      tier: "C",
      name: "local",
    })
  ).token;
  const ps = await t.db.select().from(people);
  const subs = await t.db.select().from(submissions);
  markers = [
    ...ps
      .flatMap((p) => [p.email, p.displayName ?? "", p.affiliation ?? ""])
      .filter((x) => x.length > 5),
    ...subs.flatMap((x) => [x.title, x.abstract.slice(0, 60)]),
  ];
}, 120_000);
afterAll(() => t.close());

describe("MCP for chairs' agents", () => {
  it("lists exactly the four read-only tools", async () => {
    const client = await connect(t.public, tokenM);
    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual([
      "conference_overview",
      "get_submission",
      "list_submissions",
      "presenter_cap_report",
    ]);
    expect(tools.every((x) => x.annotations?.readOnlyHint === true)).toBe(true);
    await client.close();
  });

  it("every tool answers a tier M token with no names, emails, titles or abstracts", async () => {
    const client = await connect(t.public, tokenM);
    const overview = parse(await client.callTool({ name: "conference_overview", arguments: {} }));
    expect(overview.total).toBe(s.submissionCount);
    const list = parse(
      await client.callTool({
        name: "list_submissions",
        arguments: { status: ["submitted"], limit: 500 },
      }),
    );
    expect(list.items).toHaveLength(s.submissionCount);
    expect(list.items[0].view).toBe("metadata");
    const one = parse(
      await client.callTool({ name: "get_submission", arguments: { id: list.items[0].id } }),
    );
    expect(one.view).toBe("metadata");
    const cap = parse(await client.callTool({ name: "presenter_cap_report", arguments: {} }));
    expect(cap.over.map((o: { personId: string }) => o.personId).sort()).toEqual(
      s.overCapPersonIds,
    );
    for (const result of [overview, list, one, cap]) expect(findLeaks(result, markers)).toEqual([]);
    const q = parse(await client.callTool({ name: "list_submissions", arguments: { q: "poem" } }));
    expect(q).toEqual({ error: "q_not_allowed" });
    await client.close();
  });

  it("answers the same as the REST API for the same token", async () => {
    const client = await connect(t.public, tokenM);
    const viaMcp = parse(
      await client.callTool({ name: "list_submissions", arguments: { type: "talk", limit: 20 } }),
    );
    const viaRest = await call(
      t.public,
      "GET",
      `/api/conferences/${s.slug}/submissions?type=talk&limit=20`,
      { token: tokenM },
    );
    expect(viaMcp).toEqual(viaRest.json);
    await client.close();
  });

  it("writes one audit row per tool call, with enum and ID arguments only", async () => {
    const client = await connect(t.public, tokenM);
    await client.callTool({
      name: "list_submissions",
      arguments: { type: "talk", q: "secret words" },
    });
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, "agent.mcp_tool"));
    const last = rows.at(-1);
    expect(last?.details).toEqual({
      tool: "list_submissions",
      args: { type: "talk", hasQuery: true },
    });
    expect(findLeaks(rows, ["secret words"])).toEqual([]);
    await client.close();
  });

  it("refuses tier C on the public listener and serves it on the internal one", async () => {
    await expect(connect(t.public, tokenC)).rejects.toThrow();
    const refused = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "agent.refused_tier_c_on_public"));
    expect(refused.at(-1)?.details).toMatchObject({ path: "/api/mcp" });
    const client = await connect(t.internal, tokenC);
    const list = parse(
      await client.callTool({ name: "list_submissions", arguments: { limit: 1 } }),
    );
    expect(list.items[0].view).toBe("chair");
    await client.close();
  });

  it("is closed to cookie sessions and the public", async () => {
    const res = await call(t.public, "POST", "/api/mcp", {
      body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("token_required");
  });
});
