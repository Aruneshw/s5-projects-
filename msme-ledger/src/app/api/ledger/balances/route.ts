// src/app/api/ledger/balances/route.ts
// GET /api/ledger/balances?type= — outstanding balances, largest first, with overdue alerts.
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { balanceReport } from "@/server/services/reports";
import { totals } from "@/server/services/ledger";

const Q = z.object({ type: z.enum(["SUPPLIER", "CUSTOMER"]).optional() });
export const GET = route("ledger:read", async (req, ctx) => {
  const { type } = readQuery(req, Q);
  const [customers, suppliers, t] = await Promise.all([
    !type || type === "CUSTOMER" ? balanceReport(ctx, "CUSTOMER") : Promise.resolve([]),
    !type || type === "SUPPLIER" ? balanceReport(ctx, "SUPPLIER") : Promise.resolve([]),
    totals(ctx),
  ]);
  return json({ totals: t, customers, suppliers });
});
