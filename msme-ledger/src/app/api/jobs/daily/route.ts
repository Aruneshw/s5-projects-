// src/app/api/jobs/daily/route.ts
// GET|POST /api/jobs/daily — scheduled maintenance. Auth: "Authorization: Bearer <CRON_SECRET>".
// Runs: default detection (idempotent), OCR file retention purge, daily trust snapshots.
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { json, errorResponse } from "@/server/http";
import { runDailyJobs } from "@/server/jobs/daily";
import { unauthenticated } from "@/server/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 16) return false;
  const want = `Bearer ${secret}`;
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function handle(req: NextRequest) {
  try {
    if (!authorised(req)) throw unauthenticated("Invalid job credentials");
    return json(await runDailyJobs());
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;
