// src/server/auth/password.ts
import "server-only";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const COST = 12; // ~250ms per hash on a modern CPU: slow for attackers, fine for logins.

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** A precomputed hash used to keep login timing similar when the username does not exist. */
export const DUMMY_HASH = "$2b$12$pSpA4WUNeLjKjFW0wTuWeueXgln/eJSIFXwIrVZuu/1oFmqKfEBHi";

export function newResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
