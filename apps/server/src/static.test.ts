import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conferences } from "@elochair/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApiToken,
  findOrCreatePerson,
  grantRole,
  revokeApiToken,
  saveConference,
} from "./repo";
import { makeTestApp, type TestApp } from "./testkit";

let t: TestApp;
beforeAll(async () => {
  const dist = mkdtempSync(join(tmpdir(), "elochair-web-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>ELOchair</title>");
  writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log(1)");
  t = await makeTestApp({ WEB_DIST: dist });
});
afterAll(() => t.close());

describe("serving the built web app", () => {
  it("never caches the app shell, at / or on client-side routes", async () => {
    for (const path of ["/", "/en/c/elo2027"]) {
      const res = await t.public.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(await res.text()).toContain("<title>ELOchair</title>");
    }
  });

  it("caches hashed assets forever, and 404s missing ones instead of serving HTML", async () => {
    const found = await t.public.request("/assets/app-abc123.js");
    expect(found.headers.get("cache-control")).toContain("immutable");
    const missing = await t.public.request("/assets/app-OLD999.js");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});

describe("token revocation", () => {
  it("keeps the original revocation time when revoked twice", async () => {
    const k = await saveConference(t.db, conferences.elo2026, "archived");
    const p = await findOrCreatePerson(t.db, "revoker@example.org");
    await grantRole(t.db, { conferenceId: k.id, personId: p.id, role: "chair" });
    const tok = await createApiToken(t.db, {
      personId: p.id,
      conferenceId: k.id,
      tier: "M",
      name: "x",
    });
    expect(await revokeApiToken(t.db, tok.id)).toBe(true);
    expect(await revokeApiToken(t.db, tok.id)).toBe(false);
  });
});
