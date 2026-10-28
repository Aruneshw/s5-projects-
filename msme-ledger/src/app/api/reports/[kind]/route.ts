// src/app/api/reports/[kind]/route.ts
// GET /api/reports/:kind?from=&to=&fy= — JSON reports (owners only; cashiers are denied on the server).
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { balanceReport, billSummary, cashVsDigital, dailyReport, expenseReport, fyRange, itemWiseReport, marginReport, taxSummary } from "@/server/services/reports";
import { requirePermission } from "@/server/auth/session";
import { invalid, notFound } from "@/server/errors";
import { todayIST } from "@/lib/dates";

type P = { kind: string };
const Q = z.object({ from: isoDate.optional(), to: isoDate.optional(), fy: z.string().regex(/^\d{4}-\d{2}$/).optional(), date: isoDate.optional() });

export const GET = route<P>("report:read", async (req, ctx, { kind }) => {
  const q = readQuery(req, Q);
  const r = q.fy ? fyRange(q.fy) : { from: q.from ?? `${todayIST().slice(0, 7)}-01`, to: q.to ?? todayIST() };
  if (r.from > r.to) throw invalid("'from' must be on or before 'to'");
  switch (kind) {
    case "daily": return json(await dailyReport(ctx, q.date ?? todayIST()));
    case "sales": return json(await billSummary(ctx, r, "SALES"));
    case "purchases": return json(await billSummary(ctx, r, "PURCHASE"));
    case "customer-balances": return json(await balanceReport(ctx, "CUSTOMER"));
    case "supplier-balances": return json(await balanceReport(ctx, "SUPPLIER"));
    case "items": return json(await itemWiseReport(ctx, r));
    case "cash-digital": return json(await cashVsDigital(ctx, r));
    case "expenses": return json(await expenseReport(ctx, r));
    case "margins":
      requirePermission(ctx, "bill:margin:view");
      return json(await marginReport(ctx, r));
    case "tax":
      requirePermission(ctx, "tax:read");
      return json(await taxSummary(ctx, r));
    default: throw notFound("Report");
  }
});
