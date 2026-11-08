import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Database = {
  db: Db;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * apps/server/drizzle, seen from the source file (src/db/client.ts) or from the production
 * bundle (dist/main.js). MIGRATIONS_DIR overrides both.
 */
const migrationsFolder =
  ["../../drizzle", "../drizzle"]
    .map((rel) => fileURLToPath(new URL(rel, import.meta.url)))
    .find((dir) => existsSync(`${dir}/meta/_journal.json`)) ??
  fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Production uses Postgres (DATABASE_URL). Without one, PGlite (Postgres compiled to WASM) runs
 * in-process: in memory for tests, or persisted to a directory for zero-setup local development.
 */
export function openDatabase(opts: {
  url?: string;
  dataDir?: string;
  migrationsDir?: string;
}): Database {
  const folder = opts.migrationsDir ?? migrationsFolder;
  if (opts.url) {
    const client = postgres(opts.url, { max: 10, onnotice: () => {} });
    const db = drizzlePostgres({ client, schema });
    return {
      db: db as unknown as Db,
      migrate: () => migratePostgres(db, { migrationsFolder: folder }),
      close: () => client.end(),
    };
  }
  const client = new PGlite(opts.dataDir);
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Db,
    migrate: () => migratePglite(db, { migrationsFolder: folder }),
    close: () => client.close(),
  };
}
