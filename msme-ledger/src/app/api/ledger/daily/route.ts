// src/app/api/ledger/daily/route.ts
// GET /api/ledger/daily?date= — the day's sales and receipts (cashier "Daily Ledger"; no balances/margins).
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { listBills } from "@/server/services/bills";
import { listPayments } from "@/server/services/payments";
import { listExpenses } from "@/server/services/expenses";
import { todayIST } from "@/lib/dates";
import { hasPermission } from "@/server/authorization/permissions";

export const GET = route("ledger:daily", async (req, ctx) => {
  const date = readQuery(req, z.object({ date: isoDate.optional() })).date ?? todayIST();
  const [bills, payments, expenses] = await Promise.all([
    listBills(ctx, { from: date, to: date, limit: 500 }),
    listPayments(ctx, { from: date, to: date }),
    listExpenses(ctx, { from: date, to: date, mineOnly: !hasPermission(ctx.role, "expense:cancel") }),
  ]);
  return json({ date, bills, payments, expenses });
});
