// src/app/api/auth/[...nextauth]/route.ts — NextAuth.js v4 handler (sign-in, sign-out, session, CSRF token).
import NextAuth from "next-auth";
import { authOptions } from "@/server/auth/options";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
