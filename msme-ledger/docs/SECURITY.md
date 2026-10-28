# Security review and final checklist

Status legend: ✅ implemented **and verified by an automated test or a run** · ☑ implemented, verified by reading/manual run ·
⚠ known limitation (see notes).

| Area | Status | How it is enforced | Verified by |
|---|---|---|---|
| Password hashing | ✅ | bcrypt cost 12 (`src/server/auth/password.ts`); dummy hash keeps timing similar for unknown users | login E2E |
| Login brute force | ☑ | DB-backed: 5 failed attempts / 15 min per username; reset requests 3/hour | code review |
| Session cookie | ✅ | NextAuth JWT in HTTP-only, SameSite=Lax cookie; `Secure` + `__Secure-` prefix automatically when `NEXTAUTH_URL` is https | curl smoke test (`#HttpOnly_` cookie) |
| Inactivity timeout | ☑ | JWT max-age = `INACTIVITY_TIMEOUT_MINUTES`; refreshed only on activity; client signs out after the org's idle minutes | manual |
| Absolute session limit | ☑ | `ABSOLUTE_SESSION_HOURS` checked in the JWT callback | code review |
| Session invalidation | ☑ | `users.sessionVersion` checked on every request; bumped by logout-everywhere, password change/reset, role change, deactivation | code review (no automated test yet) |
| Password recovery | ✅ | 256-bit single-use tokens stored as SHA-256, 30-min expiry; owner-generated links; admin CLI; no fake "email sent" | manual + code review |
| Early route protection | ✅ | `src/proxy.ts`: pages → /login, APIs → 401 | curl smoke test, E2E |
| RBAC on every handler | ✅ | `route(permission)` re-reads role from DB; services re-check type-specific rights | `security-routes.test.ts` (cashier → 403 on reports, tax, exports, discounting, credit, team) |
| Org isolation | ✅ | every query scoped by session `orgId`; foreign ids → 404 | `security-routes.test.ts`, `discounting.test.ts` |
| CSRF | ✅ | SameSite=Lax + Origin/Sec-Fetch-Site check on all mutating API calls; NextAuth CSRF token for sign-in | `security-routes.test.ts` (cross-site POST → 403) |
| Security headers | ✅ | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS in production (`next.config.ts`) | curl smoke test |
| Input validation | ✅ | Zod on every body/query; services re-parse; UUID path params → 404 | `security-routes.test.ts` (422/400/404) |
| Output safety | ✅ | React escaping; no `dangerouslySetInnerHTML`; CSV/XLSX formula-injection guard; generic 500s without stack traces | unit + route tests |
| File uploads | ☑ | 5 MB cap, magic-byte type sniffing, filename sanitised, stored in DB not on disk, 90-day purge | code review |
| Financial immutability | ✅ | triggers: ledger/stock/adjustments append-only; posted bills frozen; payments only ACTIVE→CANCELLED; audit log immutable | `billing.test.ts` |
| Audit trail | ✅ | row triggers with actor from transaction-local setting; writes without actor refused; app events for exports/role changes | `billing.test.ts` |
| Idempotency | ✅ | UNIQUE (org, key) on payments/expenses/salaries; client bill ids; sync mutation ids | `payments-sync.test.ts` (incl. concurrent duplicates) |
| Double financing | ✅ | advisory lock + re-validation + partial UNIQUE index + frozen terms | `discounting.test.ts` (3 concurrent accepts → 1) |
| Concurrency on balances | ✅ | per-store advisory lock; optimistic `version` on drafts/stores | `billing.test.ts` |
| Offline conflicts | ✅ | conflicts recorded with both versions; never auto-discarded | `payments-sync.test.ts`, `offline-sync.test.ts`, E2E |
| Investor / lender masking | ✅ | masked seller, buyer city only; lender sees `MSME-xxxxxxxx` after consent | `discounting.test.ts` |
| Secrets | ☑ | only in env vars; `.env` git-ignored; `.env.example` placeholders; jobs endpoint uses constant-time secret compare | review |
| Bank details | ☑ | separate table, owner-only permission, masked on read, excluded from audit JSON and exports | review |
| Dependencies | ⚠ | `npm audit --omit=dev`: **0 vulnerabilities** (after pinned `overrides` for deepmerge-ts, mysql2, uuid). Dev-only: `braces` advisory via eslint-config-next (lint tooling, not shipped). | `npm audit` |
| Backups / restore | ✅ | `pg_dump` / `pg_restore` scripts with verification; JSON export | `exports-backup.test.ts` (real round trip) |
| Rate limiting on general API | ⚠ | Only login/reset/password-change are limited. Add platform rate limiting (e.g. Vercel firewall) for public deployments. | – |
| CSP `unsafe-inline` scripts | ⚠ | needed by Next.js inline bootstrap without nonces; can be tightened with nonce-based CSP later. | – |
| Service-worker page cache | ⚠ | visited app pages are cached for offline use; cleared on sign-out. They contain no financial data (data loads via API), but on a shared phone always sign out. | – |
| Accessibility | ☑ | labelled inputs, radio groups, focus outlines, 44 px+ targets, Radix dialogs (focus trap, Esc), `role=alert/status` | E2E uses accessible names |

Assumptions that affect security: the database is reachable only by the server (never exposed publicly); TLS is
terminated by the host; each person uses their own account (Me and Dad have separate logins).
