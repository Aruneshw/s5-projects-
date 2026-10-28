// src/server/rate-limit.ts
// Database-backed sliding-window rate limiter. Works across multiple server instances
// (an in-memory counter would reset on every serverless cold start).
import "server-only";
import { prisma } from "./db";
import { AppError } from "./errors";

export async function countRecentFailures(key: string, windowSeconds: number): Promise<number> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  return prisma.rateLimitHit.count({ where: { key, success: false, createdAt: { gte: since } } });
}

export async function recordHit(key: string, success: boolean): Promise<void> {
  await prisma.rateLimitHit.create({ data: { key, success } });
  // Opportunistic cleanup of old rows (cheap, indexed).
  if (Math.random() < 0.02) {
    await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  }
}

/** Throws 429 when `key` has `limit` or more failed attempts within the window. */
export async function assertNotRateLimited(key: string, limit: number, windowSeconds: number): Promise<void> {
  const n = await countRecentFailures(key, windowSeconds);
  if (n >= limit) {
    throw new AppError("RATE_LIMITED", `Too many attempts. Try again in ${Math.ceil(windowSeconds / 60)} minutes.`);
  }
}

export const LOGIN_LIMIT = { attempts: 5, windowSeconds: 15 * 60 };
