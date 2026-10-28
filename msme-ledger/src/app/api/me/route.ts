// src/app/api/me/route.ts
// GET /api/me — current user, active organisation, role, permissions and memberships.
import { sessionRoute, json } from "@/server/http";
import { permissionsFor } from "@/server/authorization/permissions";
import { myMemberships } from "@/server/services/team";

export const GET = sessionRoute(async (_req, ctx) =>
  json({
    userId: ctx.userId,
    displayName: ctx.displayName,
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    orgType: ctx.orgType,
    role: ctx.role,
    permissions: permissionsFor(ctx.role),
    inactivityTimeoutMinutes: ctx.settings.inactivityTimeoutMinutes,
    memberships: await myMemberships(ctx.userId),
  }),
);
