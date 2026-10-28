// src/app/api/sync/push/route.ts
// POST /api/sync/push — idempotent processing of queued offline mutations.
import { route, json, readJson } from "@/server/http";
import { push, PushSchema } from "@/server/services/sync";

export const POST = route("sync:use", async (req, ctx) => json({ results: await push(ctx, await readJson(req, PushSchema)) }));
