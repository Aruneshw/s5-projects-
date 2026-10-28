// src/app/api/bills/[id]/route.ts
// GET /api/bills/:id?margins=1   PUT (edit DRAFT only)   DELETE?version= (discard DRAFT only)
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { BillDraftUpdateSchema } from "@/lib/validation/schemas";
import { deleteDraft, getBill, updateDraft } from "@/server/services/bills";

type P = { id: string };
export const GET = route<P>("bill:read", async (req, ctx, { id }) => {
  const { margins } = readQuery(req, z.object({ margins: z.enum(["0", "1"]).optional() }));
  return json(await getBill(ctx, id, { includeMargins: margins === "1" }));
});
export const PUT = route<P>("bill:read", async (req, ctx, { id }) => json(await updateDraft(ctx, id, await readJson(req, BillDraftUpdateSchema))));
export const DELETE = route<P>("bill:read", async (req, ctx, { id }) => {
  const { version } = readQuery(req, z.object({ version: z.coerce.number().int().positive() }));
  return json(await deleteDraft(ctx, id, version));
});
