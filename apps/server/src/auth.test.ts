import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, loginTokens } from "./db/schema";
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

describe("review fixes: rate limits", () => {
  it("a request refused for its IP does not use up the target address's budget", async () => {
    const u = await makeTestApp();
    for (let i = 0; i < 30; i++) {
      await call(u.public, "POST", "/api/auth/request-link", {
        body: { email: `junk${i}@example.org` },
      });
    }
    for (let i = 0; i < 6; i++) {
      const r = await call(u.public, "POST", "/api/auth/request-link", {
        body: { email: "victim@example.org" },
      });
      expect(r.status).toBe(429);
    }
    // From another IP the victim can still ask for links: their own budget was never touched.
    expect(u.deps.limits.linkPerEmail.hit("victim@example.org")).toBe(true);
    // The first refusal in the window is audited once, without the address or the IP.
    const rows = (await u.db.select().from(auditLog)).filter(
      (r) => r.action === "auth.rate_limited",
    );
    expect(rows.map((r) => r.details)).toEqual([{ limit: "link_per_ip" }]);
    expect(JSON.stringify(rows)).not.toMatch(/example\.org|127\.0\.0\.1/);
    await u.close();
  });

  it("refused code guesses are audited once per window", async () => {
    const u = await makeTestApp();
    let refused = 0;
    for (let i = 0; i < 40; i++) {
      const r = await call(u.public, "POST", "/api/auth/verify-code", {
        body: { email: "guess@example.org", code: "12345678" },
      });
      if (r.status === 429) refused++;
    }
    expect(refused).toBeGreaterThan(1);
    const rows = (await u.db.select().from(auditLog)).filter(
      (r) => r.action === "auth.rate_limited",
    );
    expect(rows.map((r) => r.details)).toEqual([{ limit: "code_per_ip" }]);
    await u.close();
  });

  it("the limiter stays bounded and cheap under a flood of distinct keys", async () => {
    const { RateLimiter } = await import("./ratelimit");
    const limiter = new RateLimiter(5, 60_000, () => 1_000, 1_000);
    const start = performance.now();
    for (let i = 0; i < 50_000; i++) limiter.hit(`k${i}`);
    expect(limiter.size).toBeLessThanOrEqual(1_000);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("the limiter marks the first refusal of each window, so it can be audited once", async () => {
    const { RateLimiter } = await import("./ratelimit");
    let now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    const outcomes = [1, 2, 3, 4, 5].map(() => limiter.attempt("k"));
    expect(outcomes).toEqual(["allowed", "allowed", "refused_first", "refused", "refused"]);
    now = 60_000;
    expect(limiter.attempt("k")).toBe("allowed");
    expect([limiter.hit("k"), limiter.hit("k")]).toEqual([true, false]);
  });
});

describe("review fixes: sign-in codes and link info", () => {
  async function requestCode(email: string) {
    await call(t.public, "POST", "/api/auth/request-link", { body: { email } });
    const mail = await call(t.public, "GET", `/api/_test/outbox/latest?to=${email}`);
    const code = /\b(\d{4}) (\d{4})\b/.exec(mail.json.text);
    const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1] as string;
    return { code: code ? `${code[1]}${code[2]}` : "", token };
  }

  it("signs in with the typed code, once", async () => {
    const { code } = await requestCode("code@example.org");
    expect(code).toMatch(/^\d{8}$/);
    const ok = await call(t.public, "POST", "/api/auth/verify-code", {
      body: { email: "Code@Example.org", code: `${code.slice(0, 4)} ${code.slice(4)}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/elo_session=/);
    const again = await call(t.public, "POST", "/api/auth/verify-code", {
      body: { email: "code@example.org", code },
    });
    expect(again.status).toBe(400);
  });

  it("stops accepting a code after five wrong guesses", async () => {
    const { code } = await requestCode("guess@example.org");
    const wrong = code === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i++) {
      const r = await call(t.public, "POST", "/api/auth/verify-code", {
        body: { email: "guess@example.org", code: wrong },
      });
      expect(r.status).toBe(400);
    }
    const right = await call(t.public, "POST", "/api/auth/verify-code", {
      body: { email: "guess@example.org", code },
    });
    expect(right.status).toBe(400);
  });

  it("link-info names the address without using up the link", async () => {
    const { token } = await requestCode("info@example.org");
    const info = await call(t.public, "POST", "/api/auth/link-info", { body: { token } });
    expect(info.json).toEqual({ email: "info@example.org" });
    expect((await call(t.public, "POST", "/api/auth/verify", { body: { token } })).status).toBe(
      200,
    );
    expect((await call(t.public, "POST", "/api/auth/link-info", { body: { token } })).status).toBe(
      400,
    );
  });
});

describe("review fixes, round 2: codes", () => {
  async function freshCode(u: TestApp, email: string) {
    await call(u.public, "POST", "/api/auth/request-link", { body: { email } });
    const mail = await call(u.public, "GET", `/api/_test/outbox/latest?to=${email}`);
    const m = /\b(\d{4}) (\d{4})\b/.exec(mail.json.text);
    return m ? `${m[1]}${m[2]}` : "";
  }

  it("counts guesses sent at the same time: never more than five per code", async () => {
    const u = await makeTestApp();
    const code = await freshCode(u, "race@example.org");
    const wrong = code === "00000000" ? "11111111" : "00000000";
    await Promise.all(
      Array.from({ length: 8 }, () =>
        call(u.public, "POST", "/api/auth/verify-code", {
          body: { email: "race@example.org", code: wrong },
        }),
      ),
    );
    const [row] = await u.db
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.email, "race@example.org"));
    expect(row?.codeAttempts).toBe(5);
    const right = await call(u.public, "POST", "/api/auth/verify-code", {
      body: { email: "race@example.org", code },
    });
    expect(right.status).toBe(400);
    await u.close();
  });

  it("junk guesses for an address cannot block its owner from signing in with a new code", async () => {
    const u = await makeTestApp();
    await freshCode(u, "target@example.org");
    for (let i = 0; i < 10; i++) {
      await call(u.public, "POST", "/api/auth/verify-code", {
        body: { email: "target@example.org", code: "12341234" },
      });
    }
    const code = await freshCode(u, "target@example.org");
    const res = await call(u.public, "POST", "/api/auth/verify-code", {
      body: { email: "target@example.org", code },
    });
    expect(res.status).toBe(200);
    await u.close();
  });

  it("stores codes keyed with the server secret, not as a plain hash", async () => {
    const u = await makeTestApp();
    const code = await freshCode(u, "keyed@example.org");
    const [row] = await u.db
      .select()
      .from(loginTokens)
      .where(eq(loginTokens.email, "keyed@example.org"));
    const plain = createHash("sha256").update(`keyed@example.org\n${code}`).digest("hex");
    expect(row?.codeHash).toBeTruthy();
    expect(row?.codeHash).not.toBe(plain);
    await u.close();
  });
});
