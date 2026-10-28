// src/app/api/salaries/route.ts
// GET /api/salaries?from=&to=&workerId=   POST /api/salaries (idempotent; separate from coolie & expenses)
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { SalaryInputSchema } from "@/lib/validation/schemas";
import { createSalary, listSalaries } from "@/server/services/expenses";

const Q = z.object({ from: isoDate.optional(), to: isoDate.optional(), workerId: z.uuid().optional() });
export const GET = route("salary:manage", async (req, ctx) => json(await listSalaries(ctx, readQuery(req, Q))));
export const POST = route("salary:manage", async (req, ctx) => {
  const r = await createSalary(ctx, await readJson(req, SalaryInputSchema));
  return json(r, r.duplicate ? 200 : 201);
});
