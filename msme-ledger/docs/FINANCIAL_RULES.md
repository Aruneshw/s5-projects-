# Financial rules, design audit and worked examples

This document is the single reference for every number the app produces. Code that implements
each rule is named in brackets. All money is `Decimal(14,2)`, all quantities `Decimal(12,3)`;
JavaScript floats are never used for money (`src/lib/money.ts`, decimal.js).

## 1. Sign conventions

| Thing | Convention |
|---|---|
| Ledger (`ledger_entries.amount`) | **+** increases the party balance. Customer balance = they owe us (receivable). Supplier balance = we owe them (payable). |
| Stock (`inventory_movements.quantity`) | **+** IN (purchase), **−** OUT (sale). Units: kg for KG items, count for BAG/BOX items. |
| Balance | Always `SUM(amount)` of ledger entries. There is no editable balance column anywhere. |

## 2. Rounding

* Money: ROUND_HALF_UP to 2 decimals at each documented step. Quantities: ROUND_HALF_UP to 3 decimals.
* `line amount = round2(round3(quantity) × rate)`. PostgreSQL CHECK `amount = round(quantity * rate, 2)`
  enforces the same rule in the database (PostgreSQL `round()` on numeric rounds half away from zero,
  identical to half-up for these non-negative values).

## 3. Bill lines (`src/features/bills/calc.ts`)

| Unit | Entry mode | Bag count | Quantity |
|---|---|---|---|
| KG | WEIGHED — each bag weight entered; blank entry finishes | number of weights | Σ weights (kg) |
| KG | COMBINED_LOT — one lot, no reweighing | entered | entered total kg |
| BAG / BOX | COUNT — weight entry skipped | = quantity | whole number |

Each individual weight is stored in `bag_weights` for traceability.

* **Coolie (sales only)** = coolie rate per bag (snapshotted from the item) × bag count, per line.
  Purchase lines always store coolie 0; a DB CHECK forbids coolie on purchase bills.

## 4. Bill summary

Purchase (display order):

```
Today's Bill  = Σ line amounts
Previous Bill Balance  (server ledger balance just before posting)
Total         = Today's Bill + Previous
Less          (reason required if > 0)
Bonus         (reason required if > 0)
Amount Settled
Total Balance = Total − Less + Bonus − Commission − Amount Settled
```

Sales:

```
Coolie
Today's Bill
Previous Bill Balance
Total         = Coolie + Today's Bill + Previous
Less, Bonus (reasons required)
Amount Received
Total Balance = Total − Less + Bonus + Commission − Amount Received
```

Commission is **0 unless explicitly switched on** for a bill (default suggestion 1%, configurable).
Assumption: on a purchase it is deducted from what we owe the supplier; on a sale it is added to the
customer's bill. With commission off, the formulas are exactly the specified ones.

Both identities are also database CHECK constraints (`bills_total_identity`, `bills_balance_identity`).

### Ledger entries written when a bill is posted (one transaction)

`BILL_CHARGE +todayBill`, `COOLIE +coolie`, `LESS −less`, `BONUS +bonus`, `COMMISSION ±commission`,
and — if something was paid at billing — a real `Payment` row plus `PAYMENT −settled`.
Previous balance + these entries = Total Balance, always.

## 5. Traceability and margins

* A sales line may reference **one** purchase line (`purchase_sale_links.salesLineId` is UNIQUE). It is a
  reference only; no purchase bill is created.
* Validated: same organisation, purchase bill posted, same item, and remaining quantity
  (`purchased − Σ quantities linked from POSTED sales`). Over-selling is refused (409) unless an owner
  ticks "allow" — then the link is stored with `oversold = true` and appears under Inventory → Reconciliation.
* `Unit Margin = Sales Rate − Linked Purchase Rate`, `Gross Line Margin = Unit Margin × Sold Quantity`.
  Margins (and purchase rates) are only returned when requested by a user with `bill:margin:view`;
  the UI hides them by default. Quantities and invoice totals are never hidden.

## 6. Cancellation

Posted bills are never edited or deleted (enforced by triggers). Cancelling:

1. refuses if a live sales line is linked to the purchase being cancelled, or if the invoice is under financing;
2. posts a `REVERSAL` ledger entry for every bill entry (except payments);
3. posts an equal-and-opposite `CANCEL_REVERSAL` stock movement for every line;
4. marks the bill CANCELLED with reason, user and time.

Money paid at billing is **not** reversed automatically (it really changed hands); it remains a credit on the
account until the payment itself is cancelled. Design correction made during the audit (see §10).

## 7. Payments, receivables and overdue

* Payments are independent records, may be partial, and several may point at one bill.
* `(orgId, idempotencyKey)` is UNIQUE: a double tap or a sync retry returns the original payment.
* Invoice settlement status is derived from the ledger with **FIFO**: credits pay the oldest charges first
  (`src/features/ledger/fifo.ts`, `src/server/services/receivables.ts`). Status: PAID / PARTIAL / UNPAID / OVERDUE
  (due date passed). Sales due date defaults to bill date + `defaultCreditDays` (30).

## 8. Invoice discounting (`src/features/discounting/pricing.ts`)

Eligibility (`validateInvoiceForDiscounting`): posted sales invoice of this organisation; fully unpaid
(no payments against it and FIFO outstanding = invoice amount); not cancelled, listed or financed;
15–90 days to due date (configurable); ≥ ₹5,000 (configurable); no unresolved default; ledger/bill integrity check.

```
Annual rate : score ≥ 750 → 10 %, 650–749 → 12 %, < 650 → 15 %
Daily rate  = annual / 365            (full precision, never rounded)
Fee         = round2(amount × daily × tenure days)
Reserve     = round2(amount × 0.15)
Payout      = amount − reserve − fee  ( = amount × 0.85 − fee )
```

Payout is computed as `amount − reserve − fee` so the three parts always add to the invoice amount to the
paisa — enforced by CHECK `dr_parts_sum`. Tenure must be 1–180 days (CHECK), fundedAmount ≤ invoiceAmount (CHECK).
Double financing is prevented by an advisory lock, in-transaction re-validation and the partial UNIQUE
index `discount_requests_one_active_per_bill` on live statuses. Terms are frozen by trigger after submission.

**Default:** a FUNDED request more than 15 days past due creates one `default_events` row (UNIQUE per request)
and one −50 `trust_score_adjustments` row (UNIQUE per default event); the request becomes DEFAULTED and the
organisation HIGH_RISK. Re-running the job changes nothing. Assumption: defaults apply to financed invoices
(the spec ties them to discounted invoices); ordinary late customers show as overdue instead.

## 9. Trust score (`src/features/credit/trust-score.ts`, formula TS-1.0)

Each factor 0–100:

* **F1 On-time repayment (40 %)** — amount-weighted share of sales invoices due in the last 180 days that FIFO
  settled on/before their due date. None due → 50.
* **F2 Cash-flow consistency (35 %)** — last 6 months of (receipts − supplier payments − expenses − salaries):
  `100 × (0.5 × share of positive months + 0.5 × max(0, 1 − min(CV, 1)))`, CV = std-dev / mean (0 if mean ≤ 0).
  Fewer than 2 active months → 50.
* **F3 Bookkeeping (25 %)** — `0.7 × min(active ledger days in 90 / 60, 1) × 100 + 0.3 × recency`,
  recency 100 if last entry ≤ 7 days ago, 0 at ≥ 60 days, linear between. No entries → 0.

`base = round_half_up(300 + 6 × (0.40 F1 + 0.35 F2 + 0.25 F3))`, `score = clamp(base + Σ active adjustments, 300, 900)`.
Inputs, factors, explanations and formula version are stored in `trust_score_snapshots`.
Badge: green > 700, yellow 600–700, red < 600.

## 10. Design audit — problems found and corrected before/while implementing

| # | Risk found | Correction |
|---|---|---|
| 1 | Two phones post bills for the same shop at once → both read the same "previous balance". | Per-store PostgreSQL advisory lock inside the posting transaction; tested with concurrent posts. |
| 2 | Offline bill prepared with a stale previous balance. | Device sends only inputs; server re-reads the balance at posting and returns a "previous balance changed" warning. |
| 3 | Payout `= A × 0.85 − fee` with separate rounding can be 1 paisa off from the invoice. | Payout = A − reserve − fee; DB CHECK that parts sum to A. |
| 4 | Cancelling a bill could silently "un-receive" cash that was actually received. | Bill cancellation reverses charges only; payments are cancelled separately. |
| 5 | A payment first tried online, then queued offline, could get two different idempotency keys. | The offline record reuses the online key; server falls back to the mutation id only when none was sent. |
| 6 | Bill numbers with gaps / duplicates under concurrency. | Row-locked counter in the same transaction (rolls back with it); UNIQUE (org, type, number). |
| 7 | Opening balance could be quietly edited. | Write-once trigger; corrections are audited adjustments; never returned by the API. |
| 8 | Year-end carry-forward duplicating opening entries. | Ledger is continuous; closing a year only stores a snapshot; partial UNIQUE index allows one OPENING entry per store. |
| 9 | A settings PATCH using a schema with defaults would reset unspecified settings. | PATCH body is loose; the merged result is validated once. |
| 10 | Investors seeing which shop owes money. | Marketplace shows masked seller name and buyer city only; lender view uses `MSME-xxxxxxxx` ids and requires consent. |
| 11 | Presumptive tax indicators may not apply to commission income. | Tax summary warns when commission was recorded (section 58 excludes commission/agency income). |
| 12 | Triggers can't know who made a change. | Server sets transaction-local `app.actor_id`/`app.org_id`; financial tables refuse writes without it. |

## 11. Three worked examples (all reproduced by automated tests)

**Example 1 — purchase bill (tests: `calc.test.ts`, `billing.test.ts`)**

Onion 5 bags × ₹1,500 = ₹7,500; Tomato 100 + 100 kg = 200 kg × ₹20 = ₹4,000.
Today's Bill ₹11,500 · Previous ₹0 · Total ₹11,500 · Bonus ₹200 (festival) · Settled ₹5,000 (cash)
→ **Total Balance = 11,500 − 0 + 200 − 5,000 = ₹6,700 payable.** Coolie: ₹0 (purchase).
Ledger: +11,500, +200, −5,000 → balance 6,700.

**Example 2 — sales bill with coolie, previous balance and margin (`billing.test.ts`, `traceability.test.ts`)**

Tomato bags 70 kg + 80 kg → 2 bags, 150 kg × ₹28 = ₹4,200. Coolie 2 × ₹10 = ₹20.
Previous balance ₹8,500 → Total = 20 + 4,200 + 8,500 = ₹12,720. Less ₹100 (damaged crate), received ₹2,000 (UPI)
→ **Total Balance = 12,720 − 100 − 2,000 = ₹10,620.**
Linked to a purchase at ₹22/kg: unit margin ₹6, gross margin 150 × 6 = **₹900** (hidden unless shown).

**Example 3 — invoice discounting and a default (`pricing-trust.test.ts`, `discounting.test.ts`)**

Unpaid invoice ₹50,000, due in 30 days, trust score 720 → 12 % a year.
Fee = 50,000 × 0.12 / 365 × 30 = 493.1506… → **₹493.15**; Reserve = **₹7,500.00**;
Payout = 50,000 − 7,500 − 493.15 = **₹42,006.85** (= 42,500 − 493.15). Parts sum to ₹50,000.00.
If, after funding, the buyer has not paid 16 days after the due date: one default event, score −50
(e.g. base 640 → 590, clamped to ≥ 300), account HIGH_RISK; running the job again changes nothing.

## 12. Tax summary — what is and is not claimed

Three separate sections: **Actual** (ledger figures), **Estimates** (trading result = sales − purchases −
expenses − salaries, which ignores stock value and is *not* accounting profit; linked gross margin) and
**Statutory indicators** (configurable assumptions). Defaults follow section 58 of the Income-tax Act, 2025
(formerly 44AD): 6 % of turnover received through banking/online modes, 8 % of the rest; ₹2 crore turnover
limit, ₹3 crore if cash receipts ≤ 5 %; excluded for commission/brokerage/agency income.
Source: [Income Tax Department — section 58](https://www.incometaxindia.gov.in/w/section-58-138).
Fresh/chilled vegetables (HSN 0701–0709) are listed at NIL GST — confirm your items and registration with a CA.
No tax rate is applied as a liability; the app is not a substitute for a Chartered Accountant.
