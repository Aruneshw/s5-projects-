// src/app/api/salaries/[id]/cancel/route.ts
// POST /api/salaries/:id/cancel
import { route, json } from "@/server/http";
import { cancelSalary } from "@/server/services/expenses";

type P = { id: string };
export const POST = route<P>("salary:manage", async (_req, ctx, { id }) => json(await cancelSalary(ctx, id)));
