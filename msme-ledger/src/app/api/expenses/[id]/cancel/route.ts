// src/app/api/expenses/[id]/cancel/route.ts
// POST /api/expenses/:id/cancel
import { route, json } from "@/server/http";
import { cancelExpense } from "@/server/services/expenses";

type P = { id: string };
export const POST = route<P>("expense:cancel", async (_req, ctx, { id }) => json(await cancelExpense(ctx, id)));
