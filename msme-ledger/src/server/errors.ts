// src/server/errors.ts
// Typed application errors. Route handlers map them to consistent JSON:
//   { "error": { "code": "CONFLICT", "message": "...", "details": {...} } }
// Internal errors are logged on the server and returned as a generic 500 — never a stack trace.

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  BAD_REQUEST: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const unauthenticated = (m = "Please sign in") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "You do not have permission to do this") => new AppError("FORBIDDEN", m);
// 404 is also used for resources in OTHER organisations, so their existence is never revealed.
export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
export const conflict = (m: string, details?: Record<string, unknown>) => new AppError("CONFLICT", m, details);
export const invalid = (m: string, details?: Record<string, unknown>) => new AppError("VALIDATION", m, details);
export const badRequest = (m: string) => new AppError("BAD_REQUEST", m);

/** Map PostgreSQL / Prisma errors that represent business-rule violations. */
export function mapDbError(err: unknown): AppError | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; message?: string; meta?: Record<string, unknown>; cause?: unknown };
  const msg = String(e.message ?? "");
  // Prisma unique constraint violation
  if (e.code === "P2002") return conflict("This record already exists (duplicate)", { target: e.meta?.target as unknown });
  if (e.code === "P2025") return notFound();
  if (e.code === "P2034") return conflict("The record was changed by someone else. Please retry.");
  // Raw PostgreSQL error codes surfaced via driver adapter
  if (msg.includes("23505") || /unique constraint/i.test(msg)) return conflict("Duplicate or already-active record");
  if (msg.includes("23514") || /violates check constraint/i.test(msg)) return invalid("A financial integrity rule was violated");
  if (/P0001|is not allowed|frozen|cannot be|never deleted|read-only|requires app\.actor_id|Invalid .*transition/i.test(msg)) {
    const clean = msg.match(/(?:ERROR:\s*)?([^\n]*(?:frozen|not allowed|cannot be|never deleted|read-only|transition|requires app\.actor_id)[^\n]*)/i)?.[1];
    return conflict(clean?.trim() ?? "This change is not allowed on a posted record");
  }
  if (msg.includes("40001") || /could not serialize/i.test(msg)) return conflict("Concurrent update detected. Please retry.");
  return null;
}
