// src/app/api/team/route.ts
// GET /api/team   POST /api/team — add a member (owner or cashier).
import { route, json, readJson } from "@/server/http";
import { MemberCreateSchema } from "@/lib/validation/schemas";
import { addMember, listMembers } from "@/server/services/team";

export const GET = route("team:manage", async (_req, ctx) => json(await listMembers(ctx)));
export const POST = route("team:manage", async (req, ctx) => json(await addMember(ctx, await readJson(req, MemberCreateSchema)), 201));
