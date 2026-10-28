# API contract

All endpoints live under `/api`, exchange JSON (except file downloads), and are implemented in
`src/app/api/**/route.ts`. Request schemas are the Zod schemas in `src/lib/validation/schemas.ts`
(named below); responses are the service return types in `src/server/services/*`.

## Conventions

* **Auth:** NextAuth session cookie (HTTP-only). `proxy.ts` rejects unauthenticated API calls with 401 early;
  every handler re-checks via `route(permission)`, which also re-reads the user's role from the database.
* **CSRF:** mutating requests must come from the same origin (`Origin` / `Sec-Fetch-Site` check) on top of
  SameSite=Lax cookies. NextAuth's own endpoints use its CSRF token.
* **Errors** are always `{ "error": { "code", "message", "details"? } }`:

| Status | code | When |
|---|---|---|
| 400 | BAD_REQUEST | malformed JSON / file |
| 401 | UNAUTHENTICATED | not signed in / session invalidated |
| 403 | FORBIDDEN | role lacks the permission, or cross-site request |
| 404 | NOT_FOUND | missing **or belongs to another organisation**, or malformed id |
| 409 | CONFLICT | stale version, duplicate, frozen/posted record, over-sell, double financing, invalid state transition |
| 422 | VALIDATION | Zod field errors (`details.issues[]`) or business-rule input errors |
| 429 | RATE_LIMITED | too many failed logins / resets |
| 500 | INTERNAL | unexpected; logged on the server, generic message to the client (no stack traces) |

* **Money** is sent and returned as strings with 2 decimals (`"1234.50"`); quantities as strings with 3 decimals.
* **Transactions:** "Tx" below means the handler's writes run in one PostgreSQL transaction via `withActorTx`
  (all-or-nothing, actor stamped for audit). "Lock" = per-store advisory lock.

## Authentication & account

| Method | Path | Permission | Request | Response | Notes |
|---|---|---|---|---|---|
| GET/POST | /api/auth/[...nextauth] | public | NextAuth (csrf, callback/credentials, session, signout) | NextAuth | 5 failed logins / 15 min / username → locked |
| POST | /api/auth/recover | public | `ResetRequestSchema {username}` | `{message}` (same for unknown users) | 3 / hour; token logged only in development |
| POST | /api/auth/reset | public | `ResetConfirmSchema {token,password}` | `{ok}` | single-use, 30 min, bumps sessionVersion; Tx |
| POST | /api/auth/change-password | signed in | `{currentPassword,newPassword}` | `{ok,reloginRequired}` | logs out everywhere |
| POST | /api/auth/logout-everywhere | signed in | – | `{ok}` | |
| GET | /api/me | signed in | – | user, org, role, permissions, memberships | |
| GET | /api/health | public | – | `{status, db, migrationsApplied}` / 503 | for deploy health checks |

## Masters

| Method | Path | Permission | Request | Response / errors |
|---|---|---|---|---|
| GET | /api/stores?type&q&includeInactive | store:read | query | stores with `label` "Shop — City" (**never** opening balance). Cashiers get customers only. |
| POST | /api/stores | store:write | `StoreCreateSchema` (incl. openingBalance) | 201 store; 409 duplicate. Tx: store + OPENING ledger entry |
| GET/PATCH | /api/stores/:id | store:read / store:write | `StoreUpdateSchema` (+`version`; no opening balance) | 404, 409 stale version |
| GET | /api/stores/:id/balance | bill:read | – | `{balance}` from ledger |
| GET/PUT | /api/stores/:id/bank | store:bank:read / store:bank:write | `StoreBankSchema` | masked account number |
| POST | /api/stores/:id/adjustments | store:adjust | `BalanceAdjustmentSchema` | 201; Tx + Lock |
| GET | /api/stores/:id/ledger?from&to | ledger:read | – | brought forward, rows with running balance |
| GET/POST | /api/items | item:read / item:write | `ItemCreateSchema` | 409 duplicate name |
| PATCH | /api/items/:id | item:write | `ItemUpdateSchema` (unit type not editable) | |
| GET/POST | /api/payment-modes | payment:create / settings:manage | `{name,isDigital}` | |

## Bills

| Method | Path | Permission | Request | Response / errors | Tx |
|---|---|---|---|---|---|
| GET | /api/bills?type&status&storeId&from&to&q&limit | bill:read (purchases need bill:create:purchase) | query | rows: party, invoice amount, due date, payment status, financing | – |
| POST | /api/bills | bill:create:sales or :purchase | `BillInputSchema` (optional client `id`, `post`) | 201 `{bill,warnings}`; 200 `{duplicate:true}` for a repeated client id; 422 calc errors; 409 over-sell | Tx + Lock: lines, weights, links, number, ledger, payment, stock |
| POST | /api/bills/preview | as above | `BillInputSchema` | server totals, nothing saved | – |
| GET | /api/bills/linkable?itemId | bill:read | – | purchase batches with remaining qty (rate only for owners) | – |
| GET | /api/bills/:id?margins=1 | bill:read | – | full bill; margins only with bill:margin:view | – |
| PUT | /api/bills/:id | bill:create:* | `BillDraftUpdateSchema` (+version) | 409 if posted or stale | Tx |
| DELETE | /api/bills/:id?version | bill:create:* | – | drafts only; posted → 409 | Tx |
| POST | /api/bills/:id/post | bill:create:* | `{version, allowOversell?, settlementModeId?}` | | Tx + Lock |
| POST | /api/bills/:id/cancel | bill:cancel | `BillCancelSchema {reason,version}` | reversal entries; 409 if linked sales / financing | Tx + Lock |
| POST | /api/bills/:id/adjustments | bill:adjust | `BillAdjustmentSchema` | audited correction | Tx + Lock |
| GET | /api/bills/:id/pdf?download=1 | bill:print | – | application/pdf | – |

## Payments, ledger, stock, expenses

| Method | Path | Permission | Request | Notes |
|---|---|---|---|---|
| GET | /api/payments?storeId&from&to&direction | payment:create (+payment:read for history beyond one day) | | cashiers see receipts only |
| POST | /api/payments | payment:create (supplier payments need bill:create:purchase) | `PaymentInputSchema` incl. `idempotencyKey` | 201 or 200 duplicate; Tx + Lock |
| POST | /api/payments/:id/cancel | payment:cancel | `{reason}` | reversal; Tx + Lock |
| GET | /api/ledger/balances?type | ledger:read | | totals + per-store balance, overdue amount/days, alert |
| GET | /api/ledger/daily?date | ledger:daily | | day's bills, receipts, expenses (no balances/margins) |
| GET | /api/inventory?asOf or ?from&to | inventory:read | | stock with stale / negative / oversold flags, or opening/in/out/closing |
| GET | /api/inventory/items/:itemId | inventory:read | | movement history |
| POST | /api/inventory/adjustments | inventory:adjust | `StockAdjustmentSchema` | reason required |
| GET | /api/inventory/reconciliation | inventory:read | | oversold links + manual corrections |
| GET/POST | /api/expenses | expense:read / expense:create | `ExpenseInputSchema` | idempotent |
| POST | /api/expenses/:id/cancel | expense:cancel | | |
| GET/POST | /api/workers, /api/salaries | salary:manage | `WorkerInputSchema`, `SalaryInputSchema` | salaries separate from coolie/expenses |
| POST | /api/salaries/:id/cancel | salary:manage | | |

## Reports & exports

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /api/reports/:kind?from&to&fy&date | report:read (margins: bill:margin:view; tax: tax:read) | kinds: daily, sales, purchases, customer-balances, supplier-balances, items, cash-digital, expenses, margins, tax |
| GET | /api/exports/:kind?format=csv\|xlsx\|pdf\|json&from&to&fy | report:export | same kinds + stock; CSV has BOM and formula-injection guard; export is audited |
| GET | /api/financial-years | report:read | |
| POST | /api/financial-years/:label/close | settings:manage | closing snapshot, no new ledger entries |
| GET | /api/backup/export | backup:export | JSON of the organisation's records (no secrets); audited |

## Offline sync

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| POST | /api/sync/push | sync:use | `{deviceId, mutations[≤100]: {id(uuid), type: BILL_CREATE\|BILL_DRAFT_UPDATE\|PAYMENT_CREATE\|EXPENSE_CREATE, payload}}` | `{results:[{id,status:APPLIED\|CONFLICT\|REJECTED\|RETRY,…}]}`; each mutation is validated like a live request and stored by id |
| GET | /api/sync/pull?cursor | sync:use | – | `{full, cursor, hasMore, stores, items, paymentModes, bills}` |
| GET | /api/sync/conflicts | sync:use | – | own conflicts (owners: all) |
| POST | /api/sync/conflicts/:id | sync:use | `{resolution: DISCARDED_LOCAL\|RESUBMITTED\|KEPT_SERVER}` | marks reviewed; never deletes server data |

## OCR

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /api/ocr | ocr:use | recent uploads |
| POST | /api/ocr | ocr:use | multipart `file` (JPEG/PNG/WebP/PDF ≤ 5 MB, type sniffed from bytes) → candidates (untrusted) |
| POST | /api/ocr/:id/confirm | ocr:use | `BillInputSchema` (PURCHASE) — the only way OCR becomes a bill |
| DELETE | /api/ocr/:id | ocr:use | discard + purge file |

## Discounting, credit, financiers

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /api/discounting/evaluate/:billId | discount:request | `validateInvoiceForDiscounting` + quote; saves nothing |
| POST | /api/discounting | discount:request | `DiscountAcceptSchema {billId, expectedUpfrontPayout, acceptTerms:true, settlementRouting}`; 409 if the quote changed or already listed. Tx + lock + partial UNIQUE |
| GET | /api/discounting | discount:read | own requests with bids, settlements, defaults |
| POST | /api/discounting/:id/withdraw | discount:request | LISTED/BID_ACCEPTED only |
| POST | /api/discounting/:id/bids/:bidId/accept | discount:request | |
| POST | /api/discounting/:id/settlements | discount:request | `SettlementSchema`; TO_FINANCIER also clears the customer's receivable |
| GET | /api/marketplace | marketplace:read | masked listings |
| POST | /api/marketplace/:id/bids | marketplace:bid | `BidSchema`; one bid per financier |
| GET | /api/investments | investment:read | |
| POST | /api/investments/:id/fund | investment:fund | `FundSchema`; only after the business accepted this financier's bid |
| GET/POST | /api/credit/trust | dashboard:financials / credit:read | cached ≤ 60 min / recompute + snapshot |
| GET | /api/credit/profile | credit:read | computes + snapshots profile |
| GET | /api/credit/offers | credit:apply | indicative matches (stored as INDICATIVE offers) |
| POST | /api/credit/offers/:id/interest | credit:apply | requires consent |
| PUT | /api/credit/sharing | credit:apply | `{share:boolean}` |
| GET | /api/lender/profiles | lender:profiles:read | anonymised (`MSME-xxxxxxxx`) |
| POST | /api/lender/offers/:id/decline | lender:offers:manage | `{note}` |

## Team, audit, settings, jobs

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | /api/team | team:manage | `MemberCreateSchema` |
| PATCH | /api/team/:membershipId | team:manage | role/active; keeps ≥ 1 active owner; kills that user's sessions |
| POST | /api/team/:membershipId/reset-link | team:manage | one-time link, shown once |
| GET | /api/audit?entityType&entityId&before | audit:read | append-only log |
| GET/PATCH | /api/settings | settings:manage | org settings incl. tax assumptions, profit allocation |
| GET/POST | /api/jobs/daily | `Authorization: Bearer $CRON_SECRET` | idempotent default check, OCR retention purge, trust snapshots |
| GET | /api/dashboard | dashboard:view | cashiers get no financial totals |
