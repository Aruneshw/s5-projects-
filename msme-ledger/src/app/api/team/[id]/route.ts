// src/app/api/team/[id]/route.ts
// PATCH /api/team/:membershipId — change role / deactivate (kills that user's sessions).
import { route, json, readJson } from "@/server/http";
import { MemberUpdateSchema } from "@/lib/validation/schemas";
import { updateMember } from "@/server/services/team";

type P = { id: string };
export const PATCH = route<P>("team:manage", async (req, ctx, { id }) => json(await updateMember(ctx, id, await readJson(req, MemberUpdateSchema))));
