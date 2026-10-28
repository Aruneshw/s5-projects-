// src/app/api/marketplace/route.ts
// GET /api/marketplace — masked listings for authorised investors.
import { route, json } from "@/server/http";
import { marketplace } from "@/server/services/discounting";

export const GET = route("marketplace:read", async (_req, ctx) => json(await marketplace(ctx)));
