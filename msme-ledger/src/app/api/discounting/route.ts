// src/app/api/discounting/route.ts
// GET /api/discounting — own requests.   POST /api/discounting — explicit acceptance of the quote.
import { route, json, readJson } from "@/server/http";
import { DiscountAcceptSchema } from "@/lib/validation/schemas";
import { acceptDiscount, listOwnRequests } from "@/server/services/discounting";

export const GET = route("discount:read", async (_req, ctx) => json(await listOwnRequests(ctx)));
export const POST = route("discount:request", async (req, ctx) => json(await acceptDiscount(ctx, await readJson(req, DiscountAcceptSchema)), 201));
