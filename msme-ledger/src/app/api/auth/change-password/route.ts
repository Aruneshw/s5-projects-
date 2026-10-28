// src/app/api/auth/change-password/route.ts
// POST /api/auth/change-password — signs the user out everywhere afterwards.
import { sessionRoute, json, readJson } from "@/server/http";
import { ChangePasswordSchema } from "@/lib/validation/schemas";
import { changePassword } from "@/server/services/team";

export const POST = sessionRoute(async (req, ctx) => {
  const body = await readJson(req, ChangePasswordSchema);
  return json(await changePassword(ctx, body.currentPassword, body.newPassword));
});
