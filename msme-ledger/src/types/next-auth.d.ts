// src/types/next-auth.d.ts — typed session/JWT fields for NextAuth v4.
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & { id: string; activeOrgId: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    sv?: number;
    authTime?: number;
    activeOrgId?: string;
    invalid?: boolean;
  }
}
