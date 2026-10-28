// src/app/api/health/route.ts
// GET /api/health — liveness + database connectivity for deploy health checks. Reveals no secrets.
import { prisma } from "@/server/db";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const m = await prisma.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    return json({ status: "ok", db: "ok", migrationsApplied: Number(m[0]?.n ?? 0), latencyMs: Date.now() - started });
  } catch {
    return json({ status: "degraded", db: "unreachable" }, 503);
  }
}
