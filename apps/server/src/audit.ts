import type { Viewer } from "@elochair/policy";
import type { Db } from "./db/client";
import { auditLog } from "./db/schema";

export type AuditEntry = {
  action: string;
  conferenceId?: string | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

/** Append one row to the audit log on behalf of a viewer (or the system). */
export async function audit(db: Db, viewer: Viewer | "system", entry: AuditEntry): Promise<void> {
  const actor =
    viewer === "system" || viewer.kind === "public"
      ? { actorKind: "system" as const, actorPersonId: null, tokenId: null }
      : viewer.kind === "agent"
        ? {
            actorKind: viewer.tier === "C" ? ("agent_c" as const) : ("agent_m" as const),
            actorPersonId: viewer.owner.personId,
            tokenId: viewer.tokenId,
          }
        : { actorKind: "human" as const, actorPersonId: viewer.personId, tokenId: null };
  await db.insert(auditLog).values({
    ...actor,
    conferenceId: entry.conferenceId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
  });
}
