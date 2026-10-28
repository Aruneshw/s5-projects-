// src/app/api/bills/[id]/post/route.ts
// POST /api/bills/:id/post — post a DRAFT (numbers it, writes ledger & stock).
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { postDraft } from "@/server/services/bills";

type P = { id: string };
const B = z.object({ version: z.number().int().positive(), allowOversell: z.boolean().optional(), settlementModeId: z.uuid().nullable().optional() });
export const POST = route<P>("bill:read", async (req, ctx, { id }) => {
  const b = await readJson(req, B);
  return json(await postDraft(ctx, id, b.version, b));
});
