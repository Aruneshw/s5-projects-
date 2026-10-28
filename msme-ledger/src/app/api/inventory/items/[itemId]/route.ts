// src/app/api/inventory/items/[itemId]/route.ts
// GET /api/inventory/items/:itemId?from=&to= — movement history for one item.
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { isoDate } from "@/lib/validation/common";
import { itemMovements } from "@/server/services/inventory";

type P = { itemId: string };
const Q = z.object({ from: isoDate.optional(), to: isoDate.optional() });
export const GET = route<P>("inventory:read", async (req, ctx, { itemId }) => json(await itemMovements(ctx, itemId, readQuery(req, Q))));
