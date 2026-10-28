// src/app/api/sync/conflicts/[id]/route.ts
// POST /api/sync/conflicts/:id — record how a conflict was resolved.
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { resolveConflict } from "@/server/services/sync";

type P = { id: string };
const B = z.object({ resolution: z.enum(["DISCARDED_LOCAL", "RESUBMITTED", "KEPT_SERVER"]) });
export const POST = route<P>("sync:use", async (req, ctx, { id }) => json(await resolveConflict(ctx, id, (await readJson(req, B)).resolution)));
