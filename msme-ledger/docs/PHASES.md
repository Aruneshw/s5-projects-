# Phase-by-phase build record

You asked for all ten phases in one go, so this file replaces the "stop after each phase" checkpoints. For each phase:
what was built, the main files, how to check it, what was actually run here, and remaining risks.
Commands are PowerShell; Linux/macOS are the same unless noted.

**What was really executed in the build environment** (Linux, Node 22.22, PostgreSQL 16.10):
`tsc --noEmit` ✔ · `eslint .` ✔ (0 problems) · `vitest run` ✔ **119/119 tests, 10 files** (unit + real-PostgreSQL integration) ·
`next build` ✔ · production server smoke test over HTTP ✔ · Playwright on a Pixel 7 viewport ✔ **4/4** (with a locally
installed Chromium 141) · `npm audit --omit=dev` ✔ 0 vulnerabilities.

One honest deviation: Prisma's engine download host (binaries.prisma.sh) was blocked in that environment, so migrations
there were generated with Prisma 7.10's own WebAssembly schema engine and applied with `psql`. On your machine
`npm ci` downloads the normal engine and `npx prisma migrate deploy` applies the very same SQL files.
`prisma migrate deploy` itself was therefore **not** run by me — please run it as the first check.

---

## Phase 1 — environment, scaffold, PWA shell, tooling
Files: `package.json` (exact pins), `package-lock.json`, `tsconfig.json` (strict + `noUncheckedIndexedAccess`),
`next.config.ts` (security headers), `postcss.config.mjs`, `eslint.config.mjs`, `.prettierrc.json`, `.env.example`,
`.gitignore`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/manifest.ts`, `public/sw.js`, `public/icons/*`,
`src/app/offline/page.tsx`, `vitest.config.mts`, `playwright.config.ts`.
Check: `npm ci; npm run typecheck; npm run lint; npm run build` → no errors; `/manifest.webmanifest` returns JSON.
Risk: service worker only registers in production builds (by design, so dev hot-reload is not cached).

## Phase 2 — schema, migrations, constraints, triggers, seed, audit
Files: `prisma/schema.prisma` (37 tables), `prisma.config.ts`, `prisma/migrations/20261015090000_init`,
`prisma/migrations/20261015090100_integrity_rules` (CHECKs, partial UNIQUE indexes, audit + immutability triggers),
`prisma/seed.ts`, `src/server/db.ts`, `src/server/tx.ts`, `src/server/audit/audit.ts`.
Check: `npx prisma migrate deploy` → "2 migrations applied"; `npm run db:seed` → "Seeded fictional demo data."
Expected seed figures (verified): purchase #2 ₹29,000 + ₹200 bonus − ₹5,000 = **₹24,200**; carrot stock 102 − 100 = **2 kg**.
Tests: `billing.test.ts` (immutability, actor required, CHECKs, audit rows).

## Phase 3 — authentication, organisations, RBAC, team
Files: `src/server/auth/{options,session,password}.ts`, `src/server/authorization/permissions.ts`, `src/server/http.ts`,
`src/server/rate-limit.ts`, `src/proxy.ts`, `src/app/api/auth/**`, `src/app/api/me`, `src/app/api/team/**`,
`src/server/services/team.ts`, `src/components/auth/{me,can}.tsx`, `src/components/layout/{nav.ts,app-shell.tsx}`,
`src/app/(auth)/**`, `src/app/(app)/team`, `scripts/reset-password.ts`, `scripts/create-owner.ts`.
Check: sign in as `zaids5`, `cashier`; cashier's menu has no Reports; `/api/reports/sales` as cashier → 403.
Tests: `security-routes.test.ts` (18 tests), RBAC unit tests, E2E "cashier cannot reach…".

## Phase 4 — store & item masters, purchase & sales billing, variable-weight entry
Files: `src/features/bills/{calc,form}.ts`, `src/features/bills/components/*`, `src/server/services/{stores,items,bills}.ts`,
`src/app/(app)/{stores,items,bills}/**`, `src/app/api/{stores,items,bills}/**`, `src/lib/validation/*`, `src/lib/money.ts`.
Check: New sales bill → Tomato → type `70` Enter `80` Enter, Enter on blank → "2 bags · 150 kg", rate 28 → ₹4,200, coolie ₹20.
Tests: `calc.test.ts`, `bill-form.test.ts`, `billing.test.ts`, E2E "kg workflow".

## Phase 5 — payments, ledger, stock, traceability, cancellation, reconciliation
Files: `src/server/services/{payments,ledger,receivables,inventory}.ts`, `src/features/ledger/fifo.ts`,
`src/app/(app)/{payments,ledger,inventory}/**`, related API routes.
Check: record a ₹500 payment twice with one tap-key → one payment; cancel a bill → reversal rows in the store ledger.
Tests: `traceability.test.ts` (12), `payments-sync.test.ts` idempotency tests.

## Phase 6 — expenses, salaries, reports, tax summary, exports
Files: `src/server/services/{expenses,reports,exports}.ts`, `src/server/pdf/documents.tsx`, `src/app/(app)/{expenses,reports}/**`,
`src/app/api/{expenses,workers,salaries,reports,exports,financial-years}/**`.
Check: Reports → each kind → CSV/XLSX/PDF downloads open.
Tests: `exports-backup.test.ts` (PDF for every report kind, CSV, XLSX, daily/tax figures).

## Phase 7 — offline-first storage, sync, conflicts, PWA
Files: `src/offline/{db,sync-engine,use-sync}.ts`, `src/server/services/sync.ts`, `src/app/api/sync/**`,
`src/app/(app)/sync/page.tsx`, `public/sw.js`.
Check (two phones / two browsers): turn on airplane mode, enter a bill → "Save on phone"; reconnect → Sync shows *synced*.
Tests: `offline-sync.test.ts` (queue, backoff, conflicts kept, crash recovery), `payments-sync.test.ts` (retry replay,
two-device draft conflict), E2E offline → reconnect.
Risk: the first visit to each screen must happen online for it to open offline later.

## Phase 8 — PDF, WhatsApp, OCR, backups
Files: `src/server/pdf/documents.tsx`, bill detail WhatsApp button (`wa.me` link, no delivery claims),
`src/features/ocr/parse.ts`, `src/server/services/ocr.ts`, `src/app/(app)/ocr/page.tsx`, `src/server/jobs/backup.ts`,
`scripts/backup.*`, `scripts/restore.*`.
Check: Print a bill; Scan purchase bill with a clear photo → review form opens pre-filled → you post it.
Tests: OCR parser unit tests; `exports-backup.test.ts` real `pg_dump → pg_restore` round trip.
Risk: Tesseract.js downloads its English language data on first use (needs internet on the server); handwritten
bills read poorly — the review screen is mandatory by design. PDFs show "Rs." (built-in font lacks "₹").

## Phase 9 — trust score, discounting workflow, credit profile, matchmaker
Files: `src/features/credit/trust-score.ts`, `src/features/discounting/pricing.ts`, `src/server/services/{credit,discounting,lender-gateway}.ts`,
`src/server/jobs/daily.ts`, `src/app/(app)/{discounting,credit,marketplace,investments,lender}/**`, `vercel.json`.
Check: Sales bills → Get Instant Cash on an unpaid ≥ ₹5,000 invoice due in 15–90 days; sign in as `investor` to bid.
Tests: `pricing-trust.test.ts`, `discounting.test.ts` (eligibility, concurrent acceptance, frozen terms, default once, masking).
Risk: no live lender/financier integration exists (by design); demo partners are labelled "demo".

## Phase 10 — tests, security review, performance, deployment
Files: `tests/**`, `docs/SECURITY.md`, `docs/OPERATIONS.md`, `docs/SETUP.md`, `/api/health`.
Performance notes: list endpoints are capped (100–500 rows) and indexed by (org, date) / (org, store, seq);
FIFO settlement is computed per store on demand — fine for a family business (thousands of bills); add a
materialised summary if you reach hundreds of thousands. Production JS is code-split per screen by Next.js.

## Known limitations (overall)
* Email/SMS are not sent (no provider configured); password recovery is owner-generated links or the admin script.
* Previous balance is unknown while offline; the server fills it in when the bill syncs and shows a warning if it changed.
* Reports are cash-basis estimates; closing-stock valuation is not modelled.
* Multi-organisation switching exists in the session model but has no UI switcher yet (one business per user today).
* Languages: English UI; Tamil/Malayalam labels are not yet translated.
