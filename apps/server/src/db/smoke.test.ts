import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./client";
import { auditLog, people } from "./schema";

describe("database", () => {
  it("migrates, and the audit log refuses updates and deletes", async () => {
    const { db, migrate, close } = openDatabase({});
    await migrate();
    const [p] = await db.insert(people).values({ email: "a@example.org" }).returning();
    expect(p?.email).toBe("a@example.org");
    await db.insert(auditLog).values({ actorKind: "system", action: "test" });
    await expect(db.execute(sql`update audit_log set action = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_log`)).rejects.toThrow();
    const rows = await db.select().from(auditLog);
    expect(rows.map((r) => r.action)).toEqual(["test"]);
    await close();
  });
});
