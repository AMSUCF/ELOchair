import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { createApp } from "./app";
import type { AppEnv } from "./context";
import { openDatabase } from "./db/client";
import { people } from "./db/schema";
import { makeDeps } from "./deps";
import { loadEnv } from "./env";

/** Test harness: an in-memory database and both listeners, driven without sockets. */
export const ORIGIN = "https://chair.example.org";

export async function makeTestApp() {
  const database = openDatabase({});
  await database.migrate();
  const env = loadEnv({
    NODE_ENV: "test",
    APP_ORIGIN: ORIGIN,
    MAIL_TRANSPORT: "memory",
    ENABLE_TEST_ENDPOINTS: "1",
  });
  let clock = new Date("2027-02-01T12:00:00Z");
  const deps = makeDeps(database.db, env, { now: () => clock });
  const t = {
    deps,
    db: database.db,
    public: createApp(deps, "public"),
    internal: createApp(deps, "internal"),
    setNow: (d: Date) => {
      clock = d;
    },
    close: () => database.close(),
  };
  return t;
}
export type TestApp = Awaited<ReturnType<typeof makeTestApp>>;

type ReqOpts = {
  body?: unknown;
  cookie?: string;
  token?: string;
  origin?: string | null;
  contentType?: string;
};

export async function call(app: Hono<AppEnv>, method: string, path: string, opts: ReqOpts = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = opts.contentType ?? "application/json";
  const res = await app.request(path, {
    method,
    headers,
    body:
      opts.body === undefined
        ? undefined
        : typeof opts.body === "string"
          ? opts.body
          : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  // biome-ignore lint/suspicious/noExplicitAny: tests assert on loosely typed JSON responses
  return { status: res.status, json: json as any, headers: res.headers };
}

/** Go through the real magic-link flow and return the session cookie. */
export async function signIn(t: TestApp, email: string, lang = "en"): Promise<string> {
  const req = await call(t.public, "POST", "/api/auth/request-link", { body: { email, lang } });
  if (req.status !== 202) throw new Error(`request-link failed: ${req.status}`);
  const mail = await call(
    t.public,
    "GET",
    `/api/_test/outbox/latest?to=${encodeURIComponent(email)}`,
  );
  const token = /#token=([A-Za-z0-9_-]+)/.exec(mail.json.text)?.[1];
  if (!token) throw new Error("no token in email");
  const verify = await call(t.public, "POST", "/api/auth/verify", { body: { token } });
  const cookie = verify.headers.get("set-cookie")?.split(";")[0];
  if (verify.status !== 200 || !cookie) throw new Error(`verify failed: ${verify.status}`);
  return cookie;
}

export async function personId(t: TestApp, email: string): Promise<string> {
  const [p] = await t.db.select().from(people).where(eq(people.email, email));
  if (!p) throw new Error(`no person ${email}`);
  return p.id;
}
