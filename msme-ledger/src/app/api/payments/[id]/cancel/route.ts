// src/app/api/payments/[id]/cancel/route.ts
// POST /api/payments/:id/cancel — reverses the ledger effect; the payment stays in history.
import { route, json, readJson } from "@/server/http";
import { CancelSchema } from "@/lib/validation/schemas";
import { cancelPayment } from "@/server/services/payments";

type P = { id: string };
export const POST = route<P>("payment:cancel", async (req, ctx, { id }) => json(await cancelPayment(ctx, id, (await readJson(req, CancelSchema)).reason)));
