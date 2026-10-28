// src/app/api/lender/profiles/route.ts
// GET /api/lender/profiles — anonymised profiles of MSMEs that consented and expressed interest.
import { route, json } from "@/server/http";
import { lenderProfiles } from "@/server/services/credit";

export const GET = route("lender:profiles:read", async (_req, ctx) => json(await lenderProfiles(ctx)));
