// src/app/api/bills/route.ts
// GET /api/bills?type=&status=&storeId=&from=&to=&q=   POST /api/bills (create draft or post)
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { BillInputSchema } from "@/lib/validation/schemas";
import { createBill, listBills } from "@/server/services/bills";

const Q = z.object({
  type: z.enum(["PURCHASE", "SALES"]).optional(),
  status: z.enum(["DRAFT", "POSTED", "CANCELLED"]).optional(),
  storeId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const GET = route("bill:read", async (req, ctx) => json(await listBills(ctx, readQuery(req, Q))));

export const POST = route("bill:read", async (req, ctx) => {
  const input = await readJson(req, BillInputSchema);
  const r = await createBill(ctx, input); // checks bill:create:sales / bill:create:purchase inside
  return json(r, r.duplicate ? 200 : 201);
});
