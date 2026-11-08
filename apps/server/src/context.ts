import type { Viewer } from "@elochair/policy";
import type { Db } from "./db/client";
import type { Env } from "./env";
import type { MailTransport } from "./mail";
import type { RateLimiter } from "./ratelimit";

export type Exposure = "public" | "internal";

export type Deps = {
  db: Db;
  env: Env;
  mail: MailTransport;
  now: () => Date;
  limits: {
    linkPerEmail: RateLimiter;
    linkPerIp: RateLimiter;
    codePerIp: RateLimiter;
  };
};

export type AppEnv = {
  Variables: { viewer: Viewer; deps: Deps; exposure: Exposure; clientIp: string };
};
