// src/server/auth/session.ts
// Resolves the authenticated user + ACTIVE organisation + role for the current request.
// The role is re-read from the database on every request, so revoking a membership or
// changing a role takes effect immediately (it is not trusted from the cookie).
import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "./options";
import { prisma } from "../db";
import { forbidden, unauthenticated } from "../errors";
import { hasPermission, type Permission, type RoleT } from "../authorization/permissions";
import { parseSettings, type OrgSettings } from "@/lib/validation/settings";

export interface SessionContext {
  userId: string;
  displayName: string;
  orgId: string;
  orgName: string;
  orgType: "MSME" | "FINANCIER";
  role: RoleT;
  settings: OrgSettings;
  lendingPartnerId: string | null;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const orgId = session?.user?.activeOrgId;
  if (!userId || !orgId) return null;
  const m = await prisma.membership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    include: { org: true, user: { select: { displayName: true, isActive: true } } },
  });
  if (!m || !m.isActive || !m.user.isActive) return null;
  return {
    userId,
    displayName: m.user.displayName,
    orgId,
    orgName: m.org.name,
    orgType: m.org.type,
    role: m.role,
    settings: parseSettings(m.org.settings),
    lendingPartnerId: m.org.lendingPartnerId,
  };
}

export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw unauthenticated();
  return ctx;
}

export function requirePermission(ctx: SessionContext, action: Permission): void {
  if (!hasPermission(ctx.role, action)) throw forbidden();
}

export async function requireAuth(action: Permission): Promise<SessionContext> {
  const ctx = await requireSession();
  requirePermission(ctx, action);
  return ctx;
}
