// src/app/api/inventory/adjustments/route.ts
// POST /api/inventory/adjustments — manual stock correction with a reason (never edits history).
import { route, json, readJson } from "@/server/http";
import { StockAdjustmentSchema } from "@/lib/validation/schemas";
import { adjustStock } from "@/server/services/inventory";

export const POST = route("inventory:adjust", async (req, ctx) => json(await adjustStock(ctx, await readJson(req, StockAdjustmentSchema)), 201));
