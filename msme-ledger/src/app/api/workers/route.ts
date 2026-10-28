// src/app/api/workers/route.ts
// GET /api/workers   POST /api/workers
import { route, json, readJson } from "@/server/http";
import { WorkerInputSchema } from "@/lib/validation/schemas";
import { createWorker, listWorkers } from "@/server/services/expenses";

export const GET = route("salary:manage", async (_req, ctx) => json(await listWorkers(ctx)));
export const POST = route("salary:manage", async (req, ctx) => json(await createWorker(ctx, await readJson(req, WorkerInputSchema)), 201));
