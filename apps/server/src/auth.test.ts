import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginTokens } from "./db/schema";
import { call, makeTestApp, signIn, type TestApp } from "./testkit";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(() => t.close());

async function linkToken(email: string, lang = "en") {
  await call(t.public, "POST", "/api/auth/request-link", { body: { email, lang } });
  const mail = await call(t.public, "GET", `/api/_test/outbox/latest?to=${email}`);
  return { mail: mail.json, token: /#token=([A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1] as string };
}

describe("magic-link sign in", () => {
  it("signs in, creates the account on first use, and signs out", async () => {
    const cookie = await signIn(t, "New.Person@Example.org");
    const me = await call(t.public, "GET", "/api/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.json.person.email).toBe("new.person@example.org");
    expect(me.json.roles).toEqual([]);

    expect((await call(t.public, "POST", "/api/auth/logout", { cookie, body: {} })).status).toBe(
      204,
    );
    expect((await call(t.public, "GET", "/api/me", { cookie })).status).toBe(401);
  });

  it("puts the token in the URL fragment and localizes the email", async () => {
    const { mail } = await linkToken("idioma@example.org", "es");
    expect(mail.subject).toBe("Tu enlace para entrar en ELOchair");
    expect(mail.text).toMatch(/https:\/\/chair\.example\.org\/es\/auth\/verify#token=/);
  });

  it("stores only a hash of the token", async () => {
    const { token } = await linkToken("hash@example.org");
    const rows = await t.db
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.email, "hash@example.org"));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("refuses a token twice, or after 20 minutes", async () => {
    const { token } = await linkToken("once@example.org");
    expect((await call(t.public, "POST", "/api/auth/verify", { body: { token } })).status).toBe(
      200,
    );
    expect((await call(t.public, "POST", "/api/auth/verify", { body: { token } })).status).toBe(
      400,
    );

    const late = await linkToken("late@example.org");
    t.setNow(new Date("2027-02-01T12:21:00Z"));
    const res = await call(t.public, "POST", "/api/auth/verify", { body: { token: late.token } });
    t.setNow(new Date("2027-02-01T12:00:00Z"));
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_or_expired");
  });

  it("answers the same for any address, and rate-limits per address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await call(t.public, "POST", "/api/auth/request-link", {
            body: { email: "limit@example.org" },
          })
        ).status,
      );
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("sets an HttpOnly, SameSite=Lax, Secure cookie on an https origin", async () => {
    const { token } = await linkToken("cookie@example.org");
    const res = await call(t.public, "POST", "/api/auth/verify", { body: { token } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i);
  });
});

describe("cross-site request protection", () => {
  it("rejects writes from another origin or without an origin", async () => {
    const body = { email: "x@example.org" };
    expect(
      (
        await call(t.public, "POST", "/api/auth/request-link", {
          body,
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(t.public, "POST", "/api/auth/request-link", { body, origin: null })).status,
    ).toBe(403);
  });

  it("rejects non-JSON writes (HTML forms cannot send JSON)", async () => {
    const res = await call(t.public, "POST", "/api/auth/request-link", {
      body: "email=x@example.org",
      contentType: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(415);
  });

  it("reports invalid input with paths", async () => {
    const res = await call(t.public, "POST", "/api/auth/request-link", { body: { email: "nope" } });
    expect(res.status).toBe(400);
    expect(res.json.issues[0].path).toBe("email");
  });
});

describe("health and headers", () => {
  it("answers on both listeners and sends security headers", async () => {
    const pub = await call(t.public, "GET", "/healthz");
    expect(pub.json).toEqual({ ok: true, exposure: "public" });
    expect(pub.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect((await call(t.internal, "GET", "/healthz")).json.exposure).toBe("internal");
  });
});
