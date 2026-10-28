// src/app/api/discounting/[id]/settlements/route.ts
// POST /api/discounting/:id/settlements — record what the buyer paid and to whom.
import { route, json, readJson } from "@/server/http";
import { SettlementSchema } from "@/lib/validation/schemas";
import { recordSettlement } from "@/server/services/discounting";

type P = { id: string };
export const POST = route<P>("discount:request", async (req, ctx, { id }) => json(await recordSettlement(ctx, id, await readJson(req, SettlementSchema)), 201));
