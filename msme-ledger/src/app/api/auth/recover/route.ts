// src/app/api/auth/recover/route.ts
// POST /api/auth/recover — self-service reset request (same answer whether or not the user exists).
import { publicRoute, json, readJson } from "@/server/http";
import { ResetRequestSchema } from "@/lib/validation/schemas";
import { requestPasswordReset } from "@/server/services/team";

export const POST = publicRoute(async (req) => {
  const { username } = await readJson(req, ResetRequestSchema);
  return json(await requestPasswordReset(username));
});
