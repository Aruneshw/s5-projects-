// src/app/api/dashboard/route.ts
// GET /api/dashboard — role-aware summary (cashiers get no financial totals).
import { route, json } from "@/server/http";
import { dashboard } from "@/server/services/admin";

export const GET = route("dashboard:view", async (_req, ctx) => json(await dashboard(ctx)));
