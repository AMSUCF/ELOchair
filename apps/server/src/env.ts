import { z } from "zod";

const bool = z
  .enum(["0", "1", "true", "false"])
  .default("0")
  .transform((v) => v === "1" || v === "true");

export const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Postgres connection string. Unset: PGlite (in memory, or in DATA_DIR when set). */
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().optional(),
  /** The origin people use in their browsers; magic links and the CSRF check use it. */
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  PUBLIC_HOST: z.string().default("0.0.0.0"),
  PUBLIC_PORT: z.coerce.number().int().default(8080),
  /** The internal listener serves tier C (content) agents. Never expose it publicly. */
  INTERNAL_HOST: z.string().default("127.0.0.1"),
  INTERNAL_PORT: z.coerce.number().int().default(8081),
  /** Trust X-Forwarded-For from the reverse proxy (Caddy) for client IPs. */
  TRUST_PROXY: bool,
  MAIL_TRANSPORT: z.enum(["log", "memory", "smtp"]).default("log"),
  /** e.g. smtp://user:pass@smtp.example.org:587 */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("ELOchair <no-reply@eliterature.org>"),
  /** Directory of the built web app to serve; unset in development (Vite serves it). */
  WEB_DIST: z.string().optional(),
  /** Where the SQL migrations live; defaults to apps/server/drizzle next to the source. */
  MIGRATIONS_DIR: z.string().optional(),
  MIGRATE_ON_START: bool,
  /** Development and tests only: load the ELO configurations and the synthetic sandbox at boot. */
  SEED_ON_START: bool,
  /** Test-only helpers such as reading the outbox. Refused unless NODE_ENV is test. */
  ENABLE_TEST_ENDPOINTS: bool,
});
export type Env = z.infer<typeof Env>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const env = Env.parse(source);
  if (env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL) {
    throw new Error("MAIL_TRANSPORT=smtp needs SMTP_URL");
  }
  if (env.SEED_ON_START && env.NODE_ENV === "production") {
    throw new Error("SEED_ON_START is not allowed in production");
  }
  if (env.ENABLE_TEST_ENDPOINTS && env.NODE_ENV !== "test") {
    throw new Error("ENABLE_TEST_ENDPOINTS is only allowed when NODE_ENV=test");
  }
  return env;
}
