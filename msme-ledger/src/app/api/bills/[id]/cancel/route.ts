// src/app/api/bills/[id]/cancel/route.ts
// POST /api/bills/:id/cancel — reversal-based cancellation (history is kept).
import { route, json, readJson } from "@/server/http";
import { BillCancelSchema } from "@/lib/validation/schemas";
import { cancelBill } from "@/server/services/bills";

type P = { id: string };
export const POST = route<P>("bill:cancel", async (req, ctx, { id }) => {
  const b = await readJson(req, BillCancelSchema);
  return json(await cancelBill(ctx, id, b.reason, b.version));
});
