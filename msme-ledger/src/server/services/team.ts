// src/server/services/team.ts
// Team management, password changes and account recovery.
//
// Recovery (v1, no email provider configured):
//   * An owner generates a one-time reset link for a team member and shares it (e.g. WhatsApp).
//   * Self-service "forgot password" creates a token too; it is only revealed to the server log
//     in development. In production it is never shown — the user contacts an owner instead.
//     This avoids pretending an email/SMS was sent.
//   * Last resort for the only owner: `npm run user:reset-password` on the server.
// Tokens are random 256-bit values, stored only as SHA-256 hashes, single-use, 30-minute expiry.
import "server-only";
import { prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, invalid, notFound, AppError } from "../errors";
import { hashPassword, newResetToken, sha256, verifyPassword } from "../auth/password";
import { recordAudit } from "../audit/audit";
import { assertNotRateLimited, recordHit } from "../rate-limit";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { MemberCreateSchema, MemberUpdateSchema } from "@/lib/validation/schemas";

const RESET_MINUTES = 30;

export async function listMembers(ctx: Pick<SessionContext, "orgId">) {
  const rows = await prisma.membership.findMany({
    where: { orgId: ctx.orgId },
    include: { user: { select: { id: true, username: true, displayName: true, isActive: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({ membershipId: m.id, userId: m.user.id, username: m.user.username, displayName: m.user.displayName, role: m.role, isActive: m.isActive && m.user.isActive, since: m.createdAt }));
}

export async function addMember(ctx: Pick<SessionContext, "orgId" | "userId">, raw: z.input<typeof MemberCreateSchema>) {
  const input = MemberCreateSchema.parse(raw);
  const exists = await prisma.user.findUnique({ where: { username: input.username } });
  if (exists) throw conflict("That username is taken");
  const passwordHash = await hashPassword(input.password);
  return withActorTx(ctx, async (tx) => {
    const user = await tx.user.create({ data: { username: input.username, displayName: input.displayName, passwordHash } });
    const m = await tx.membership.create({ data: { userId: user.id, orgId: ctx.orgId, role: input.role } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: ctx.userId, action: "MEMBER_ADDED", entityType: "users", entityId: user.id, data: { role: input.role, username: input.username } });
    return { membershipId: m.id, userId: user.id, username: user.username, displayName: user.displayName, role: m.role };
  });
}

export async function updateMember(ctx: Pick<SessionContext, "orgId" | "userId">, membershipId: string, raw: z.input<typeof MemberUpdateSchema>) {
  const input = MemberUpdateSchema.parse(raw);
  const m = await prisma.membership.findFirst({ where: { id: membershipId, orgId: ctx.orgId } });
  if (!m) throw notFound("Member");
  const demotingOwner = m.role === "MSME_OWNER" && ((input.role && input.role !== "MSME_OWNER") || input.isActive === false);
  if (demotingOwner) {
    const owners = await prisma.membership.count({ where: { orgId: ctx.orgId, role: "MSME_OWNER", isActive: true } });
    if (owners <= 1) throw conflict("The business must keep at least one active owner");
  }
  return withActorTx(ctx, async (tx) => {
    const u = await tx.membership.update({ where: { id: membershipId }, data: { ...(input.role ? { role: input.role } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } });
    // Kill existing sessions so the change takes effect immediately everywhere.
    await tx.user.update({ where: { id: m.userId }, data: { sessionVersion: { increment: 1 } } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: ctx.userId, action: "MEMBER_UPDATED", entityType: "memberships", entityId: membershipId, data: input });
    return { membershipId: u.id, role: u.role, isActive: u.isActive };
  });
}

/** Owner-generated one-time reset link for a member of THIS organisation. */
export async function createResetLinkForMember(ctx: Pick<SessionContext, "orgId" | "userId">, membershipId: string, baseUrl: string) {
  const m = await prisma.membership.findFirst({ where: { id: membershipId, orgId: ctx.orgId } });
  if (!m) throw notFound("Member");
  const { token, tokenHash } = newResetToken();
  await withActorTx(ctx, async (tx) => {
    await tx.passwordResetToken.create({ data: { userId: m.userId, tokenHash, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000), createdById: ctx.userId } });
    await recordAudit(tx, { orgId: ctx.orgId, actorId: ctx.userId, action: "RESET_LINK_CREATED", entityType: "users", entityId: m.userId });
  });
  return { url: `${baseUrl.replace(/\/$/, "")}/reset-password?token=${token}`, expiresInMinutes: RESET_MINUTES };
}

/** Self-service request. Always answers the same way so usernames cannot be probed. */
export async function requestPasswordReset(username: string): Promise<{ message: string }> {
  const key = `reset:${username}`;
  await assertNotRateLimited(key, 3, 60 * 60);
  await recordHit(key, false);
  const user = await prisma.user.findUnique({ where: { username } });
  if (user?.isActive) {
    const { token, tokenHash } = newResetToken();
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
    if (process.env.NODE_ENV !== "production") {
      console.info(`[dev only] password reset link for ${username}: /reset-password?token=${token}`);
    }
  }
  return { message: "If the account exists, a reset has been prepared. Ask an owner of your business for your reset link." };
}

export async function confirmPasswordReset(token: string, password: string) {
  const tokenHash = sha256(token);
  const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw invalid("This reset link is invalid or has expired. Ask for a new one.");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const used = await tx.passwordResetToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw invalid("This reset link was already used.");
    await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
    await recordAudit(tx, { orgId: null, actorId: rec.userId, action: "PASSWORD_RESET", entityType: "users", entityId: rec.userId });
  });
  return { ok: true };
}

export async function changePassword(ctx: Pick<SessionContext, "userId" | "orgId">, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const key = `pwchange:${ctx.userId}`;
  await assertNotRateLimited(key, 5, 15 * 60);
  if (!(await verifyPassword(current, user.passwordHash))) {
    await recordHit(key, false);
    throw new AppError("VALIDATION", "Current password is incorrect");
  }
  const passwordHash = await hashPassword(next);
  await prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  await recordAudit(prisma, { orgId: ctx.orgId, actorId: ctx.userId, action: "PASSWORD_CHANGED", entityType: "users", entityId: ctx.userId });
  return { ok: true, reloginRequired: true };
}

export async function logoutEverywhere(ctx: Pick<SessionContext, "userId" | "orgId">) {
  await prisma.user.update({ where: { id: ctx.userId }, data: { sessionVersion: { increment: 1 } } });
  await recordAudit(prisma, { orgId: ctx.orgId, actorId: ctx.userId, action: "LOGOUT_EVERYWHERE", entityType: "users", entityId: ctx.userId });
  return { ok: true };
}

export async function myMemberships(userId: string) {
  const rows = await prisma.membership.findMany({ where: { userId, isActive: true }, include: { org: { select: { id: true, name: true, type: true } } } });
  return rows.map((m) => ({ orgId: m.org.id, orgName: m.org.name, orgType: m.org.type, role: m.role }));
}
