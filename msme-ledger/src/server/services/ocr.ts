// src/server/services/ocr.ts
// Purchase-bill OCR. Engine is modular (OcrEngine). Output is UNTRUSTED until a user confirms.
// Retention: the original file is kept for OCR_RETENTION_DAYS (default 90) then purged by the
// daily job; the extraction record and its link to the confirmed bill are kept.
import "server-only";
import { prisma, Prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, invalid, notFound } from "../errors";
import { parsePurchaseBillText, type OcrCandidates } from "@/features/ocr/parse";
import { createBill, type BillCtx } from "./bills";
import type { BillInputSchema } from "@/lib/validation/schemas";
import type { z } from "zod";

export const OCR_MAX_BYTES = 5 * 1024 * 1024;
export const OCR_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const RETENTION_DAYS = Math.max(1, Number(process.env.OCR_RETENTION_DAYS ?? 90) || 90);

export interface OcrEngine {
  name: string;
  extractText(bytes: Uint8Array, mimeType: string): Promise<string>;
}

/** Tesseract.js for images; PDF text layer via unpdf (scanned PDFs need a photo instead). */
export const defaultEngine: OcrEngine = {
  name: "tesseract.js+unpdf",
  async extractText(bytes, mimeType) {
    if (mimeType === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: true });
      const t = Array.isArray(text) ? text.join("\n") : text;
      if (!t.trim()) throw new Error("This PDF has no text layer (it is a scan). Upload a photo of the bill instead.");
      return t;
    }
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(Buffer.from(bytes));
      return data.text;
    } finally {
      await worker.terminate();
    }
  },
};

/** Magic-byte sniffing: the declared MIME type is not trusted. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

export async function uploadAndExtract(ctx: BillCtx, file: { name: string; bytes: Uint8Array }, engine: OcrEngine = defaultEngine) {
  if (file.bytes.byteLength === 0) throw invalid("The file is empty");
  if (file.bytes.byteLength > OCR_MAX_BYTES) throw invalid("File is larger than 5 MB");
  const mime = sniffMime(file.bytes);
  if (!mime) throw invalid("Upload a JPEG, PNG, WebP image or a PDF");

  const rec = await withActorTx(ctx, (tx) =>
    tx.ocrUpload.create({
      data: {
        orgId: ctx.orgId,
        uploadedById: ctx.userId,
        fileName: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120),
        mimeType: mime,
        sizeBytes: file.bytes.byteLength,
        fileData: Buffer.from(file.bytes),
        retainUntil: new Date(Date.now() + RETENTION_DAYS * 86_400_000),
      },
      select: { id: true },
    }),
  );

  let candidates: OcrCandidates | null = null;
  let rawText: string | null = null;
  let error: string | null = null;
  try {
    rawText = (await withTimeout(engine.extractText(file.bytes, mime), 60_000)).slice(0, 50_000);
    const [stores, items] = await Promise.all([
      prisma.store.findMany({ where: { orgId: ctx.orgId, type: "SUPPLIER", isActive: true }, select: { id: true, shopName: true } }),
      prisma.item.findMany({ where: { orgId: ctx.orgId, isActive: true }, select: { id: true, name: true } }),
    ]);
    candidates = parsePurchaseBillText(rawText, stores.map((s) => ({ id: s.id, name: s.shopName })), items);
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : "Extraction failed";
  }
  await withActorTx(ctx, (tx) =>
    tx.ocrUpload.update({
      where: { id: rec.id },
      data: { status: error ? "FAILED" : "EXTRACTED", rawText, candidates: (candidates ?? undefined) as Prisma.InputJsonValue | undefined, error },
    }),
  );
  return { id: rec.id, status: error ? "FAILED" : "EXTRACTED", error, candidates, rawText };
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error("OCR timed out")), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function listUploads(ctx: Pick<BillCtx, "orgId">) {
  return prisma.ocrUpload.findMany({
    where: { orgId: ctx.orgId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, fileName: true, status: true, error: true, billId: true, createdAt: true, retainUntil: true, candidates: true },
  });
}

/** The ONLY way OCR output becomes a bill: a reviewed, user-confirmed purchase bill. */
export async function confirmUpload(ctx: BillCtx, uploadId: string, input: z.input<typeof BillInputSchema>) {
  const up = await prisma.ocrUpload.findFirst({ where: { id: uploadId, orgId: ctx.orgId } });
  if (!up) throw notFound("Upload");
  if (up.status === "CONFIRMED") throw conflict("This upload was already turned into a bill");
  if (input.type !== "PURCHASE") throw invalid("OCR supports purchase bills");
  const res = await createBill(ctx, input, { source: "OCR" });
  await withActorTx(ctx, (tx) => tx.ocrUpload.update({ where: { id: uploadId }, data: { status: "CONFIRMED", billId: res.bill.id } }));
  return res;
}

export async function discardUpload(ctx: BillCtx, uploadId: string) {
  const up = await prisma.ocrUpload.findFirst({ where: { id: uploadId, orgId: ctx.orgId } });
  if (!up) throw notFound("Upload");
  if (up.status === "CONFIRMED") throw conflict("Confirmed uploads are kept with their bill");
  await withActorTx(ctx, (tx) => tx.ocrUpload.update({ where: { id: uploadId }, data: { status: "DISCARDED", fileData: null } }));
  return { id: uploadId, status: "DISCARDED" };
}

/** Daily job: purge original files past their retention date (metadata kept). */
export async function purgeExpiredUploads(): Promise<number> {
  const r = await prisma.ocrUpload.updateMany({ where: { retainUntil: { lt: new Date() }, fileData: { not: null } }, data: { fileData: null } });
  return r.count;
}
