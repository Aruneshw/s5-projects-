// src/app/api/payment-modes/route.ts
// GET /api/payment-modes   POST /api/payment-modes (owners)
import { z } from "zod";
import { route, json, readJson } from "@/server/http";
import { createPaymentMode, listPaymentModes } from "@/server/services/payments";

export const GET = route("payment:create", async (_req, ctx) => json(await listPaymentModes(ctx)));
const B = z.object({ name: z.string().trim().min(2).max(40), isDigital: z.boolean() });
export const POST = route("settings:manage", async (req, ctx) => json(await createPaymentMode(ctx, await readJson(req, B)), 201));
