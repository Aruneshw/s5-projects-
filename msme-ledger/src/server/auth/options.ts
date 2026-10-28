// src/server/auth/options.ts
// Auth.js / NextAuth.js v4 configuration (stable "latest" release line).
// Docs: https://next-auth.js.org/configuration/options
//
// Strategy: username + password (Credentials provider) with a JWT session stored in an
// HTTP-only, SameSite=Lax cookie (Secure automatically when NEXTAUTH_URL is https).
//  * Inactivity timeout: the JWT maxAge = INACTIVITY_TIMEOUT_MINUTES and is re-issued on
//    activity (client pings /api/auth/session while the user is active).
//  * Absolute lifetime: ABSOLUTE_SESSION_HOURS since login, even if active.
//  * Server-side invalidation: users.sessionVersion is checked on EVERY request; "log out
//    everywhere", password changes, resets and deactivation bump it, killing old cookies.
import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "../db";
import { DUMMY_HASH, verifyPassword } from "./password";
import { assertNotRateLimited, LOGIN_LIMIT, recordHit } from "../rate-limit";
import { AppError } from "../errors";

export const INACTIVITY_MINUTES = Math.max(5, Number(process.env.INACTIVITY_TIMEOUT_MINUTES ?? 30) || 30);
export const ABSOLUTE_HOURS = Math.max(1, Number(process.env.ABSOLUTE_SESSION_HOURS ?? 12) || 12);

async function pickDefaultOrg(userId: string): Promise<string | null> {
  const memberships = await prisma.membership.findMany({
    where: { userId, isActive: true },
    include: { org: { select: { type: true } } },
    orderBy: { createdAt: "asc" },
  });
  const msme = memberships.find((m) => m.org.type === "MSME");
  return (msme ?? memberships[0])?.orgId ?? null;
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: INACTIVITY_MINUTES * 60, updateAge: 0 },
  jwt: { maxAge: INACTIVITY_MINUTES * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "Username and password",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username = String(credentials?.username ?? "").trim().toLowerCase();
        const password = String(credentials?.password ?? "");
        if (!username || !password || username.length > 64 || password.length > 128) return null;
        const key = `login:${username}`;
        try {
          await assertNotRateLimited(key, LOGIN_LIMIT.attempts, LOGIN_LIMIT.windowSeconds);
        } catch (e) {
          if (e instanceof AppError) throw new Error("Too many failed attempts. Wait 15 minutes and try again.");
          throw e;
        }
        const user = await prisma.user.findUnique({ where: { username } });
        const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
        if (!user || !ok || !user.isActive) {
          await recordHit(key, false);
          return null;
        }
        const orgId = await pickDefaultOrg(user.id);
        if (!orgId) {
          await recordHit(key, false);
          return null;
        }
        await recordHit(key, true);
        return { id: user.id, name: user.displayName };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      const now = Math.floor(Date.now() / 1000);
      if (user) {
        const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
        token.uid = user.id;
        token.sv = dbUser?.sessionVersion ?? 0;
        token.authTime = now;
        token.activeOrgId = (await pickDefaultOrg(user.id)) ?? undefined;
        return token;
      }
      if (!token.uid) return token;

      // Absolute session lifetime.
      if (typeof token.authTime === "number" && now - token.authTime > ABSOLUTE_HOURS * 3600) {
        return { ...token, uid: undefined, invalid: true };
      }
      // Server-side invalidation (logout everywhere, password change, deactivation).
      const dbUser = await prisma.user.findUnique({ where: { id: String(token.uid) }, select: { isActive: true, sessionVersion: true } });
      if (!dbUser || !dbUser.isActive || dbUser.sessionVersion !== token.sv) {
        return { ...token, uid: undefined, invalid: true };
      }
      // Organisation switch requested by the client — verified against memberships.
      if (trigger === "update" && session && typeof (session as { activeOrgId?: unknown }).activeOrgId === "string") {
        const wanted = (session as { activeOrgId: string }).activeOrgId;
        const m = await prisma.membership.findUnique({ where: { userId_orgId: { userId: String(token.uid), orgId: wanted } } });
        if (m?.isActive) token.activeOrgId = wanted;
      }
      return token;
    },
    async session({ session, token }) {
      if (!token.uid || token.invalid) {
        return { ...session, user: undefined, expires: new Date(0).toISOString() } as unknown as typeof session;
      }
      session.user = {
        ...(session.user ?? {}),
        id: String(token.uid),
        name: session.user?.name ?? null,
        activeOrgId: typeof token.activeOrgId === "string" ? token.activeOrgId : null,
      };
      return session;
    },
  },
};
