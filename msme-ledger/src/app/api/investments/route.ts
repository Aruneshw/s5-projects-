// src/app/api/investments/route.ts
// GET /api/investments — the investor's accepted / funded deals.
import { route, json } from "@/server/http";
import { investments } from "@/server/services/discounting";

export const GET = route("investment:read", async (_req, ctx) => json(await investments(ctx)));
