// src/app/api/bills/preview/route.ts
// POST /api/bills/preview — server-calculated totals without saving (previous balance included).
import { route, json, readJson } from "@/server/http";
import { BillInputSchema } from "@/lib/validation/schemas";
import { previewBill } from "@/server/services/bills";

export const POST = route("bill:read", async (req, ctx) => json(await previewBill(ctx, await readJson(req, BillInputSchema))));
