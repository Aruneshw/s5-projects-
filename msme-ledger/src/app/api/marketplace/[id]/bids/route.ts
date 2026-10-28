// src/app/api/marketplace/[id]/bids/route.ts
// POST /api/marketplace/:id/bids — an investor places a real bid.
import { route, json, readJson } from "@/server/http";
import { BidSchema } from "@/lib/validation/schemas";
import { placeBid } from "@/server/services/discounting";

type P = { id: string };
export const POST = route<P>("marketplace:bid", async (req, ctx, { id }) => json(await placeBid(ctx, id, await readJson(req, BidSchema)), 201));
