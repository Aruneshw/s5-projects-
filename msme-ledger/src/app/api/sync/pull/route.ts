// src/app/api/sync/pull/route.ts
// GET /api/sync/pull?cursor= — changes since the cursor (audit_logs.id); cursor=0 → full snapshot.
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { pull } from "@/server/services/sync";

export const GET = route("sync:use", async (req, ctx) => {
  const { cursor } = readQuery(req, z.object({ cursor: z.string().regex(/^\d{1,20}$/).optional() }));
  return json(await pull(ctx, cursor ?? null));
});
