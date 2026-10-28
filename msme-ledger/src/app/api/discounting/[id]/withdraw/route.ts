// src/app/api/discounting/[id]/withdraw/route.ts
// POST /api/discounting/:id/withdraw
import { route, json } from "@/server/http";
import { withdrawRequest } from "@/server/services/discounting";

type P = { id: string };
export const POST = route<P>("discount:request", async (_req, ctx, { id }) => json(await withdrawRequest(ctx, id)));
