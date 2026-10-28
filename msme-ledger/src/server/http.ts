// src/server/http.ts
// Route Handler wrapper: authentication, permission check, same-origin (CSRF) check for
// mutations, Zod validation and consistent JSON errors. Every API route uses it.
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError, badRequest, forbidden, mapDbError, notFound } from "./errors";
import { requireAuth, requireSession, type SessionContext } from "./auth/session";
import type { Permission } from "./authorization/permissions";

export function json<T>(data: T, init?: number | ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const base: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return new NextResponse(body, {
    ...base,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(base.headers ?? {}) },
  });
}

export function errorResponse(err: unknown): NextResponse {
  let e: AppError;
  if (err instanceof AppError) e = err;
  else if (err instanceof ZodError) {
    e = new AppError("VALIDATION", "Some fields are invalid", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  } else {
    const mapped = mapDbError(err);
    if (mapped) e = mapped;
    else {
      // Log the real error server-side only; the client gets a generic message.
      console.error("[api] unhandled error", err);
      e = new AppError("INTERNAL", "Something went wrong. Please try again.");
    }
  }
  return json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reject cross-site mutation requests (CSRF defence in depth on top of SameSite=Lax cookies). */
export function assertSameOrigin(req: NextRequest): void {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) {
    // Browsers always send Origin on cross-origin POSTs; non-browser clients (tests, curl) may omit it.
    const fetchSite = req.headers.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") throw forbidden("Cross-site request blocked");
    return;
  }
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-site request blocked");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw forbidden("Cross-site request blocked");
  }
}

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 2_000_000) throw badRequest("Request body too large");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw badRequest("Request body must be valid JSON");
  }
  return schema.parse(raw);
}

export function readQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

type RouteCtx<P> = { params: Promise<P> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path params named id / *Id must be UUIDs; anything else is simply "not found". */
function assertIdParams(params: unknown): void {
  if (!params || typeof params !== "object") return;
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if ((k === "id" || k.endsWith("Id")) && (typeof v !== "string" || !UUID_RE.test(v))) throw notFound();
  }
}

/** Authenticated + authorised handler. */
export function route<P = Record<string, string>>(
  permission: Permission,
  handler: (req: NextRequest, ctx: SessionContext, params: P) => Promise<NextResponse | Response>,
) {
  return async (req: NextRequest, routeCtx: RouteCtx<P>): Promise<NextResponse | Response> => {
    try {
      assertSameOrigin(req);
      const ctx = await requireAuth(permission);
      const params = (await routeCtx?.params) ?? ({} as P);
      assertIdParams(params);
      return await handler(req, ctx, params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Public (unauthenticated) handler — still gets origin checks and error mapping. */
export function publicRoute<P = Record<string, string>>(handler: (req: NextRequest, params: P) => Promise<NextResponse | Response>) {
  return async (req: NextRequest, routeCtx: RouteCtx<P>): Promise<NextResponse | Response> => {
    try {
      assertSameOrigin(req);
      const params = (await routeCtx?.params) ?? ({} as P);
      return await handler(req, params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Any signed-in user (no specific permission) — e.g. /api/me, change password. */
export function sessionRoute<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: SessionContext, params: P) => Promise<NextResponse | Response>,
) {
  return async (req: NextRequest, routeCtx: RouteCtx<P>): Promise<NextResponse | Response> => {
    try {
      assertSameOrigin(req);
      const ctx = await requireSession();
      const params = (await routeCtx?.params) ?? ({} as P);
      return await handler(req, ctx, params);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
