// src/app/api/financial-years/route.ts
// GET /api/financial-years
import { route, json } from "@/server/http";
import { listFinancialYears } from "@/server/services/admin";

export const GET = route("report:read", async (_req, ctx) => json(await listFinancialYears(ctx)));
