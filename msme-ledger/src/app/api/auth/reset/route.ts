// src/app/api/auth/reset/route.ts
// POST /api/auth/reset — set a new password with a one-time token.
import { publicRoute, json, readJson } from "@/server/http";
import { ResetConfirmSchema } from "@/lib/validation/schemas";
import { confirmPasswordReset } from "@/server/services/team";
import { assertNotRateLimited, recordHit } from "@/server/rate-limit";

export const POST = publicRoute(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  await assertNotRateLimited(`reset-confirm:${ip}`, 10, 15 * 60);
  const { token, password } = await readJson(req, ResetConfirmSchema);
  try {
    return json(await confirmPasswordReset(token, password));
  } catch (e) {
    await recordHit(`reset-confirm:${ip}`, false);
    throw e;
  }
});
