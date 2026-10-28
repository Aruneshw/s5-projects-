// src/app/api/sync/conflicts/route.ts
// GET /api/sync/conflicts — mutations the server could not apply (kept for review, never discarded).
import { route, json } from "@/server/http";
import { listConflicts } from "@/server/services/sync";

export const GET = route("sync:use", async (_req, ctx) => json(await listConflicts(ctx)));
