// src/app/api/ocr/[id]/confirm/route.ts
// POST /api/ocr/:id/confirm — the reviewed purchase bill (the only way OCR becomes a bill).
import { route, json, readJson } from "@/server/http";
import { BillInputSchema } from "@/lib/validation/schemas";
import { confirmUpload } from "@/server/services/ocr";

type P = { id: string };
export const POST = route<P>("ocr:use", async (req, ctx, { id }) => json(await confirmUpload(ctx, id, await readJson(req, BillInputSchema)), 201));
