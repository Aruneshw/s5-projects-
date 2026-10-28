// src/app/api/payments/route.ts
// GET /api/payments?storeId=&from=&to=&direction=   POST /api/payments (idempotent by idempotencyKey)
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { PaymentInputSchema } from "@/lib/validation/schemas";
import { createPayment, listPayments } from "@/server/services/payments";
import { requirePermission } from "@/server/auth/session";

const Q = z.object({ storeId: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), direction: z.enum(["RECEIVED", "PAID"]).optional() });

export const GET = route("payment:create", async (req, ctx) => {
  // Full history needs payment:read; cashiers only see what they need for today's receipts.
  const q = readQuery(req, Q);
  if (!q.from || q.from !== q.to) requirePermission(ctx, "payment:read");
  return json(await listPayments(ctx, q));
});

export const POST = route("payment:create", async (req, ctx) => {
  const r = await createPayment(ctx, await readJson(req, PaymentInputSchema));
  return json(r, r.duplicate ? 200 : 201);
});
