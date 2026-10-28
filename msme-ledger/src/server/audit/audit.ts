// src/server/audit/audit.ts
// Application-level audit entries for privileged actions that are not plain row changes
// (logins, role changes, password resets, exports). Row changes on financial tables are
// captured automatically by PostgreSQL triggers (see prisma/migrations/*_integrity_rules).
import "server-only";
import { prisma, Prisma, type Tx } from "../db";

export async function recordAudit(
  client: Tx | typeof prisma,
  entry: {
    orgId: string | null;
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await client.auditLog.create({
    data: {
      orgId: entry.orgId,
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      newData: (entry.data ?? undefined) as Prisma.InputJsonValue | undefined,
      source: "APP",
    },
  });
}
