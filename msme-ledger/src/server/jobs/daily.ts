// src/server/jobs/daily.ts
// Daily maintenance. Every step is idempotent, so running it twice (or retrying) is safe.
import "server-only";
import { prisma } from "../db";
import { runDefaultCheck } from "../services/discounting";
import { purgeExpiredUploads } from "../services/ocr";
import { computeAndStoreTrust } from "../services/credit";

export async function runDailyJobs() {
  const started = new Date();
  const defaults = await runDefaultCheck();
  const purgedFiles = await purgeExpiredUploads();
  const orgs = await prisma.organization.findMany({ where: { type: "MSME" }, select: { id: true } });
  const scores: Array<{ orgId: string; score: number }> = [];
  for (const o of orgs) {
    const r = await computeAndStoreTrust(o.id);
    scores.push({ orgId: o.id, score: r.score });
  }
  // Old rate-limit rows are useless after a week.
  await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  return { startedAt: started, finishedAt: new Date(), defaults, purgedFiles, trustSnapshots: scores.length };
}
