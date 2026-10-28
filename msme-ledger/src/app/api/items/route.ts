// src/app/api/items/route.ts
// GET /api/items   POST /api/items
import { z } from "zod";
import { route, json, readJson, readQuery } from "@/server/http";
import { ItemCreateSchema } from "@/lib/validation/schemas";
import { createItem, listItems } from "@/server/services/items";

const Q = z.object({ q: z.string().max(80).optional(), includeInactive: z.enum(["0", "1"]).optional() });
export const GET = route("item:read", async (req, ctx) => {
  const q = readQuery(req, Q);
  return json(await listItems(ctx, { q: q.q, includeInactive: q.includeInactive === "1" }));
});
export const POST = route("item:write", async (req, ctx) => json(await createItem(ctx, await readJson(req, ItemCreateSchema)), 201));
