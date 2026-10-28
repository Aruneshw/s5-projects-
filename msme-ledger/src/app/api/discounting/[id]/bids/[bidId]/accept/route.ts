// src/app/api/discounting/[id]/bids/[bidId]/accept/route.ts
// POST /api/discounting/:id/bids/:bidId/accept — owner accepts a real financier's bid.
import { route, json } from "@/server/http";
import { acceptBid } from "@/server/services/discounting";

type P = { id: string; bidId: string };
export const POST = route<P>("discount:request", async (_req, ctx, { id, bidId }) => json(await acceptBid(ctx, id, bidId)));
