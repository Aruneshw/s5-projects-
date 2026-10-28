// src/app/api/stores/[id]/route.ts
// GET /api/stores/:id   PATCH /api/stores/:id (opening balance is NOT editable)
import { route, json, readJson } from "@/server/http";
import { StoreUpdateSchema } from "@/lib/validation/schemas";
import { getStore, updateStore } from "@/server/services/stores";
import { hasPermission } from "@/server/authorization/permissions";
import { notFound } from "@/server/errors";

type P = { id: string };

export const GET = route<P>("store:read", async (_req, ctx, { id }) => {
  const s = await getStore(ctx, id);
  if (s.type === "SUPPLIER" && !hasPermission(ctx.role, "bill:create:purchase")) throw notFound("Store");
  return json(s);
});

export const PATCH = route<P>("store:write", async (req, ctx, { id }) => json(await updateStore(ctx, id, await readJson(req, StoreUpdateSchema))));
