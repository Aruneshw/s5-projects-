// src/app/api/bills/[id]/adjustments/route.ts
// POST /api/bills/:id/adjustments — audited coolie correction / extra less / bonus on a posted bill.
import { route, json, readJson } from "@/server/http";
import { BillAdjustmentSchema } from "@/lib/validation/schemas";
import { addBillAdjustment } from "@/server/services/bills";

type P = { id: string };
export const POST = route<P>("bill:adjust", async (req, ctx, { id }) => json(await addBillAdjustment(ctx, id, await readJson(req, BillAdjustmentSchema)), 201));
