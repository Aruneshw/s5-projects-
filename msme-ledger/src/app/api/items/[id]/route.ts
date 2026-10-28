// src/app/api/items/[id]/route.ts
// PATCH /api/items/:id
import { route, json, readJson } from "@/server/http";
import { ItemUpdateSchema } from "@/lib/validation/schemas";
import { updateItem } from "@/server/services/items";

type P = { id: string };
export const PATCH = route<P>("item:write", async (req, ctx, { id }) => json(await updateItem(ctx, id, await readJson(req, ItemUpdateSchema))));
