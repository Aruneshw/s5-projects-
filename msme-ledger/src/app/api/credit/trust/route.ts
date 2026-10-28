// src/app/api/credit/trust/route.ts
// GET /api/credit/trust — current trust score (cached ≤ 60 min).  POST — force recompute.
import { route, json } from "@/server/http";
import { computeAndStoreTrust, currentTrust } from "@/server/services/credit";

export const GET = route("dashboard:financials", async (_req, ctx) => json(await currentTrust(ctx.orgId, ctx.userId)));
export const POST = route("credit:read", async (_req, ctx) => json(await computeAndStoreTrust(ctx.orgId, ctx.userId)));
