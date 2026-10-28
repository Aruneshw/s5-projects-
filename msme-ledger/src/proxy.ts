// src/proxy.ts — early route protection (Next.js 16 "proxy", formerly middleware).
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
// This is only the FIRST gate: every Route Handler and service re-checks the session,
// the role and the organisation (see src/server/http.ts). Never rely on this file alone.
import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PAGES = ["/login", "/forgot-password", "/reset-password", "/offline"];
const PUBLIC_API = ["/api/auth", "/api/health", "/api/jobs"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (isApi && PUBLIC_API.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const valid = token && token.uid && !token.invalid;
  if (valid) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Please sign in" } }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|sw.js|robots.txt).*)"],
};
