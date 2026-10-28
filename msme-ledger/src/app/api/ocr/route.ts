// src/app/api/ocr/route.ts
// GET /api/ocr — recent uploads.   POST /api/ocr (multipart "file") — upload + extract candidates.
import { route, json } from "@/server/http";
import { listUploads, uploadAndExtract, OCR_MAX_BYTES } from "@/server/services/ocr";
import { badRequest } from "@/server/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route("ocr:use", async (_req, ctx) => json(await listUploads(ctx)));

export const POST = route("ocr:use", async (req, ctx) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > OCR_MAX_BYTES + 100_000) throw badRequest("File is larger than 5 MB");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Attach the bill as 'file'");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return json(await uploadAndExtract(ctx, { name: file.name, bytes }), 201);
});
