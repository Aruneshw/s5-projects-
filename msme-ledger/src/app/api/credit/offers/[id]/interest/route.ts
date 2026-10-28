// src/app/api/credit/offers/[id]/interest/route.ts
// POST /api/credit/offers/:id/interest — share the anonymised profile with that lender (needs consent).
import { route, json } from "@/server/http";
import { expressInterest } from "@/server/services/credit";

type P = { id: string };
export const POST = route<P>("credit:apply", async (_req, ctx, { id }) => json(await expressInterest(ctx, id)));
