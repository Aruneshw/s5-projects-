# Architecture

## 1. Verified stack (checked against the npm registry and official docs on 15 Oct 2026)

| Layer | Package | Pinned version | Why this version | Source |
|---|---|---|---|---|
| Runtime | Node.js | 24 LTS (works on ≥ 22.12) | Node 24 is the LTS line; Node 26 is still "Current" | https://nodejs.org/en/about/previous-releases |
| Framework | next | 16.4.1 | latest stable; `middleware` is now `proxy` | https://nextjs.org/docs/app/api-reference/file-conventions/proxy |
| UI | react / react-dom | 19.3.1 | latest stable React 19 | https://www.npmjs.com/package/react |
| Language | typescript | 6.0.3 | `latest` is 7.0 (native Go compiler); 6.0 chosen for proven compatibility with Next's type-checking. Strict mode on. | https://www.npmjs.com/package/typescript |
| ORM | prisma / @prisma/client / @prisma/adapter-pg | 7.10.0 | `latest` tag is an **8.0 release candidate**; the spec asks for stable, so 7.10.0 | https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7 |
| DB driver | pg | 8.23.1 | used by the Prisma driver adapter | https://node-postgres.com |
| Auth | next-auth (Auth.js v4 line) | 4.24.15 | `latest` stable; v5 has been beta for years | https://next-auth.js.org/configuration/options |
| Validation | zod | 4.6.7 | | https://zod.dev |
| Styling | tailwindcss / @tailwindcss/postcss | 4.3.3 | | https://tailwindcss.com/docs |
| Components | shadcn/ui pattern + radix-ui | radix-ui 1.8.1 | shadcn components are vendored source (that is how shadcn is distributed) | https://ui.shadcn.com/docs |
| Icons | lucide-react | 1.57.0 | | https://lucide.dev |
| Data fetching | @tanstack/react-query | 5.104.3 | | https://tanstack.com/query/v5 |
| Offline DB | dexie | 4.4.6 | IndexedDB wrapper | https://dexie.org |
| PDF | @react-pdf/renderer | 4.9.0 | supports React 19 | https://react-pdf.org |
| Spreadsheets | exceljs | 4.4.0 | | https://github.com/exceljs/exceljs |
| OCR | tesseract.js 7.0.0 + unpdf 1.8.1 | | images via Tesseract, PDF text layer via unpdf | https://github.com/naptha/tesseract.js |
| Money | decimal.js | 10.6.0 | exact decimal arithmetic | https://mikemcl.github.io/decimal.js |
| Tests | vitest 5.0.4, @playwright/test 1.64.1, fake-indexeddb 6.2.5 | | | https://vitest.dev · https://playwright.dev |
| Lint | eslint 10.12.0 + eslint-config-next 16.4.1, prettier 3.9.10 | | | |

Exact versions are pinned in `package.json` and locked in `package-lock.json`.

## 2. Shape of the system

```
Phone / PC browser (PWA)                              Server (Next.js on Node)               PostgreSQL
┌──────────────────────────────┐   HTTPS + cookie   ┌─────────────────────────────┐   pg   ┌──────────────────────────────┐
│ React screens (App Router)   │ ─────────────────▶ │ proxy.ts  (first gate)      │        │ tables + CHECK constraints   │
│ TanStack Query               │                    │ Route Handlers /api/*       │ ─────▶ │ partial UNIQUE indexes       │
│ Dexie (IndexedDB): drafts,   │ ◀── /api/sync ───▶ │  └ route(): auth, RBAC,     │        │ audit triggers (who/what)    │
│   sync queue, cached masters │                    │    CSRF, Zod, JSON errors   │        │ immutability triggers        │
│ Service worker: app shell    │                    │ services/ (business rules,  │        │ advisory locks per store     │
└──────────────────────────────┘                    │   one DB transaction each)  │        └──────────────────────────────┘
                                                    └─────────────────────────────┘
```

Decisions and why:

* **One app, no separate API server.** Route Handlers + service modules are enough; fewer moving parts to deploy.
* **Server is the only calculator of record.** Clients send inputs (weights, rates); all totals, balances, numbers and
  stock are computed in `src/server/services` and re-checked by database constraints.
* **Ledger is append-only.** Balances are sums of entries; corrections are reversals/adjustments, never edits.
* **Defence in depth.** UI hiding (`<Can>`, nav filter) → `proxy.ts` → `route(permission)` → service checks
  (org scoping, type-specific permissions) → PostgreSQL CHECKs, UNIQUE indexes and triggers.
* **Auth.js v4 with username/password and JWT sessions** (one auth system only). Server-side invalidation via
  `users.sessionVersion`, checked on every request; inactivity timeout via short JWT max-age refreshed by activity.
* **Offline-first for entry, online for truth.** Phones keep drafts and a queue in IndexedDB; the server applies each
  queued record idempotently and records conflicts instead of overwriting.
* **Multi-tenant ready.** Every business row carries `orgId`; every query is scoped by the session's active org;
  other orgs' records return 404.

## 3. Folder structure (abridged — full tree in `docs/TREE.txt`)

```
prisma/
  schema.prisma                 data model (Prisma 7, prisma-client generator → src/generated/prisma)
  migrations/
    20261015090000_init/        tables/enums generated by Prisma 7.10's schema engine
    20261015090100_integrity_rules/  hand-written SQL: CHECKs, partial indexes, audit + immutability triggers
  seed.ts                       fictional demo data, created through the real services
prisma.config.ts                Prisma 7 config (datasource URL, migrations path, seed)
src/
  proxy.ts                      early route protection (Next 16 "proxy", formerly middleware)
  app/
    (auth)/login, forgot-password, reset-password
    (app)/                      authenticated screens: dashboard, bills (list/new/[id]), stores, items, payments,
                                ledger (+daily), inventory, expenses, reports, discounting, credit, team, settings,
                                sync, ocr, audit, marketplace, investments, lender
    api/                        Route Handlers (≈70) — see docs/API.md
    offline/                    offline fallback page;  manifest.ts — PWA manifest
  components/
    ui/                         shadcn-style primitives (button, input, card, dialog, tabs, states)
    layout/                     app shell, permission-filtered navigation, sync pill, idle logout
    auth/                       Me context, <Can>, <ProtectRole>, <RequirePerm>
    common/                     money/date/status display helpers
  features/                     pure business logic shared by server and client + feature UI
    bills/        calc.ts (line & summary maths), form.ts (weight prompt), components/ (bill entry)
    discounting/  pricing.ts, components/instant-cash-dialog.tsx
    credit/       trust-score.ts
    ledger/       fifo.ts
    ocr/          parse.ts (untrusted candidate extraction)
  lib/              money.ts (decimal + Indian formatting), dates.ts (IST, financial year), api.ts, hooks.ts,
                    validation/ (Zod schemas shared by API and forms, org settings)
  offline/          db.ts (Dexie schema), sync-engine.ts (queue/backoff/push/pull), use-sync.ts
  server/
    db.ts, tx.ts    Prisma client; transaction helper that stamps the actor for audit triggers; store locks
    http.ts         route()/sessionRoute()/publicRoute(): auth, permission, CSRF origin check, Zod, error JSON
    errors.ts       typed errors → 401/403/404/409/422/400/429/500
    auth/           NextAuth options, session context (role re-read from DB), password hashing
    authorization/  permissions.ts — the RBAC map (hasPermission)
    audit/          app-level audit events (logins, exports, role changes)
    services/       stores, items, bills, payments, ledger, receivables, inventory, expenses, reports, exports,
                    sync, ocr, discounting, credit, lender-gateway, team, admin
    pdf/            bill & report PDFs
    jobs/           daily jobs (defaults, OCR retention, trust snapshots), organisation export
    rate-limit.ts   DB-backed rate limiting
  types/            NextAuth type augmentation
public/             sw.js (service worker), icons
scripts/            backup/restore (PowerShell + bash), daily jobs runner, admin password reset
tests/
  unit/             maths, pricing, trust score, FIFO, RBAC map, CSV safety, OCR parser, weight prompt, offline queue
  integration/      real PostgreSQL: billing, traceability, payments & sync, discounting, route security, exports & backup
  e2e/              Playwright on a phone viewport: login, kg workflow, cashier denial, offline → sync
docs/               this documentation
```

`src/server/repositories/` from the original plan was not created: services use Prisma directly (Prisma *is* the
repository layer), which keeps each financial operation and its transaction in one readable function.

## 4. Data model (key relationships)

```
Organization 1─* Membership *─1 User ─1 Profile
Organization 1─* Store (SUPPLIER|CUSTOMER) 1─0..1 StoreBankDetail (owner-only)
Organization 1─* Item (KG|BAG|BOX, coolie/bag)        Organization 1─* Worker 1─* WorkerSalary
Store 1─* Bill (PURCHASE|SALES, DRAFT→POSTED→CANCELLED) 1─* BillLine 1─* BagWeight
BillLine(sales) 1─0..1 PurchaseSaleLink *─1 BillLine(purchase)
Bill 1─* Payment ; Store 1─* Payment ; Bill/Store 1─* BillAdjustment
Store 1─* LedgerEntry  (→ bill | payment | adjustment ; reversal → reversed entry, UNIQUE)
Item 1─* InventoryMovement (→ bill line ; reversal → reversed movement, UNIQUE)
Organization 1─* Expense, FinancialYear, TrustScoreSnapshot, TrustScoreAdjustment, CreditProfileSnapshot
Bill 1─* DiscountRequest (≤1 live: partial UNIQUE) 1─* DiscountBid, FinancingSettlement ; 1─0..1 DefaultEvent 1─0..1 TrustScoreAdjustment
LendingPartner 1─* LoanProduct 1─* LoanOffer *─1 CreditProfileSnapshot ; Organization(FINANCIER) → LendingPartner
AuditLog (BIGSERIAL id = sync cursor), SyncMutation (client UUID), IdempotencyRecord, OcrUpload, RateLimitHit, PasswordResetToken
```

UUID keys everywhere except `audit_logs` (BIGSERIAL, so it can serve as a gap-free, monotonic sync cursor) and the
composite `bill_sequences` key.

## 5. Roles and permissions

`src/server/authorization/permissions.ts` is the single map. Summary:

| Role | Can | Cannot |
|---|---|---|
| MSME_OWNER (Me, Dad) | everything for the business: bills, ledger, stock, reports, exports, tax, discounting, credit, team, audit, settings, backup | investor/lender portals |
| STAFF_CASHIER | sales bills, print, customer receipts, expenses, daily ledger, sync | purchases, supplier payments, reports, margins, discounting, credit, team, settings |
| INVESTOR (financier org) | masked marketplace, bids, own investments, confirm funding | any business ledger |
| LENDER_BANK (financier org linked to a lending partner) | anonymised profiles of consenting applicants, decline offers | any business ledger |

## 6. How the actor reaches the database

`withActorTx()` (src/server/tx.ts) opens a transaction and runs
`set_config('app.actor_id', <user>, true), set_config('app.org_id', <org>, true)` — transaction-local, so it cannot
leak through the connection pool. Triggers read it into `audit_logs.actorId`; financial tables refuse writes without it.
Browsers never connect to PostgreSQL, so the value cannot be forged by a client.

## 7. Offline sync protocol

* **Push** `POST /api/sync/push {deviceId, mutations:[{id, type, payload}]}` — `id` is a client UUID and the
  idempotency key. Server results per mutation: `APPLIED` (stored), `CONFLICT` / `REJECTED` (stored with the server's
  current record — the device keeps its copy until a person decides), `RETRY` (transient; not stored; device backs off
  2 s × 2ⁿ up to 5 min).
* **Pull** `GET /api/sync/pull?cursor=` — cursor is the highest `audit_logs.id` seen; `0` returns a full snapshot
  (stores, items, payment modes, last 30 days of bills).
* Bills created offline carry a client UUID, so a retry after a lost response returns the same bill.
* Draft edits carry `version`; a stale version becomes a recorded conflict, never an overwrite.
