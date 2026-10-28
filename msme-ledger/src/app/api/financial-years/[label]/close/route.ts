// src/app/api/financial-years/[label]/close/route.ts
// POST /api/financial-years/:label/close — year-end snapshot (no duplicate opening entries).
import { route, json } from "@/server/http";
import { closeFinancialYear } from "@/server/services/admin";

type P = { label: string };
export const POST = route<P>("settings:manage", async (_req, ctx, { label }) => json(await closeFinancialYear(ctx, label)));
