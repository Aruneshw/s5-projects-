// src/app/api/stores/route.ts
// GET /api/stores?type=&q=&includeInactive=1   POST /api/stores
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { StoreCreateSchema } from "@/lib/validation/schemas";
import { createStore, listStores } from "@/server/services/stores";
import { hasPermission } from "@/server/authorization/permissions";

const Q = z.object({ type: z.enum(["SUPPLIER", "CUSTOMER"]).optional(), q: z.string().max(80).optional(), includeInactive: z.enum(["0", "1"]).optional() });

export const GET = route("store:read", async (req, ctx) => {
  const q = readQuery(req, Q);
  // Cashiers only work with customers.
  const type = hasPermission(ctx.role, "bill:create:purchase") ? q.type : "CUSTOMER";
  return json(await listStores(ctx, { type, q: q.q, includeInactive: q.includeInactive === "1" }));
});

export const POST = route("store:write", async (req, ctx) => json(await createStore(ctx, await readJson(req, StoreCreateSchema)), 201));
