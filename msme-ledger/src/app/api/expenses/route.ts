// src/app/api/expenses/route.ts
// GET /api/expenses?from=&to=   POST /api/expenses (idempotent)
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { ExpenseInputSchema } from "@/lib/validation/schemas";
import { createExpense, listExpenses } from "@/server/services/expenses";
import { hasPermission } from "@/server/authorization/permissions";

const Q = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const GET = route("expense:read", async (req, ctx) =>
  json(await listExpenses(ctx, { ...readQuery(req, Q), mineOnly: !hasPermission(ctx.role, "expense:cancel") })),
);
export const POST = route("expense:create", async (req, ctx) => {
  const r = await createExpense(ctx, await readJson(req, ExpenseInputSchema));
  return json(r, r.duplicate ? 200 : 201);
});
