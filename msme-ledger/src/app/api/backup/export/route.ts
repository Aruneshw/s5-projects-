// src/app/api/backup/export/route.ts
// GET /api/backup/export — owner-only JSON export of this organisation's records (logical backup).
// Full database backups use pg_dump — see docs/OPERATIONS.md.
import { route } from "@/server/http";
import { exportOrganisation } from "@/server/jobs/backup";
import { recordAudit } from "@/server/audit/audit";
import { prisma } from "@/server/db";

export const runtime = "nodejs";
export const GET = route("backup:export", async (_req, ctx) => {
  const data = await exportOrganisation(ctx.orgId);
  await recordAudit(prisma, { orgId: ctx.orgId, actorId: ctx.userId, action: "BACKUP_EXPORT", entityType: "organizations", entityId: ctx.orgId });
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  return new Response(body, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="msme-ledger-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
  });
});
