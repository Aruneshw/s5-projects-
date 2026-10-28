// src/app/api/credit/offers/route.ts
// GET /api/credit/offers — match loan products (indicative pre-qualification only).
import { route, json } from "@/server/http";
import { matchLoanOffers } from "@/server/services/credit";

export const GET = route("credit:apply", async (_req, ctx) => json(await matchLoanOffers(ctx)));
