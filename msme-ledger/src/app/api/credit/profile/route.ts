// src/app/api/credit/profile/route.ts
// GET /api/credit/profile — computes and snapshots the credit profile.
import { route, json } from "@/server/http";
import { buildCreditProfile } from "@/server/services/credit";

export const GET = route("credit:read", async (_req, ctx) => json(await buildCreditProfile(ctx)));
