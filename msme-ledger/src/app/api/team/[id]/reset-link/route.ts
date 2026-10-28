// src/app/api/team/[id]/reset-link/route.ts
// POST /api/team/:membershipId/reset-link — one-time password reset link (30 min) to share with the member.
import { route, json } from "@/server/http";
import { createResetLinkForMember } from "@/server/services/team";

type P = { id: string };
export const POST = route<P>("team:manage", async (req, ctx, { id }) => json(await createResetLinkForMember(ctx, id, process.env.NEXTAUTH_URL ?? req.nextUrl.origin), 201));
