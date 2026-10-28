// src/app/api/stores/[id]/adjustments/route.ts
// POST /api/stores/:id/adjustments — audited balance / opening-balance correction.
import { route, json, readJson } from "@/server/http";
import { BalanceAdjustmentSchema } from "@/lib/validation/schemas";
import { adjustStoreBalance } from "@/server/services/stores";

type P = { id: string };
export const POST = route<P>("store:adjust", async (req, ctx, { id }) => json(await adjustStoreBalance(ctx, id, await readJson(req, BalanceAdjustmentSchema)), 201));
