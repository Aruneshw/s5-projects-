// src/app/api/auth/logout-everywhere/route.ts
// POST /api/auth/logout-everywhere — invalidates every session of the current user.
import { sessionRoute, json } from "@/server/http";
import { logoutEverywhere } from "@/server/services/team";

export const POST = sessionRoute(async (_req, ctx) => json(await logoutEverywhere(ctx)));
