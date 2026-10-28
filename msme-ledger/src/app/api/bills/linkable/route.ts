// src/app/api/bills/linkable/route.ts
// GET /api/bills/linkable?itemId= — purchase batches with remaining quantity to link a sale to.
import { z } from "zod";
import { route, json, readQuery } from "@/server/http";
import { linkablePurchaseLines } from "@/server/services/bills";

const Q = z.object({ itemId: z.uuid() });
export const GET = route("bill:read", async (req, ctx) => json(await linkablePurchaseLines(ctx, readQuery(req, Q).itemId)));
