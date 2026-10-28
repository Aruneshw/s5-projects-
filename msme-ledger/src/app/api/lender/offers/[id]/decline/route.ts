// src/app/api/lender/offers/[id]/decline/route.ts
// POST /api/lender/offers/:id/decline
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { lenderDecline } from "@/server/services/credit";

type P = { id: string };
export const POST = route<P>("lender:offers:manage", async (req, ctx, { id }) =>
  json(await lenderDecline(ctx, id, (await readJson(req, z.object({ note: z.string().trim().min(3).max(300) }))).note)),
);
