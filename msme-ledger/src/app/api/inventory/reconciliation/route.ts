// src/app/api/inventory/reconciliation/route.ts
// GET /api/inventory/reconciliation — adjustments and oversold links awaiting review.
import { route, json } from "@/server/http";
import { reconciliationHistory } from "@/server/services/inventory";

export const GET = route("inventory:read", async (_req, ctx) => json(await reconciliationHistory(ctx)));
