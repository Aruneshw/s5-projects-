// src/features/credit/trust-score.ts
// Deterministic trust score, formula version "TS-1.0". Pure: same inputs → same score.
//
// Each factor is normalised to 0–100, then:
//   weighted = 0.40 × F1 + 0.35 × F2 + 0.25 × F3                (0–100)
//   base     = round_half_up(300 + 6 × weighted)                 (300–900)
//   score    = clamp(base + Σ active adjustments, 300, 900)
//
// F1 On-time buyer repayment (40%): amount-weighted share of sales invoices that fell due in
//    the look-back window (180 days) and were fully settled (FIFO) on or before the due date.
//    No invoices due → neutral 50.
// F2 Monthly net cash-flow consistency (35%): last 6 months of net cash flow
//    (receipts − supplier payments − expenses − salaries).
//    F2 = 100 × (0.5 × share_of_positive_months + 0.5 × stability), stability = max(0, 1 − min(CV, 1))
//    where CV = population std-dev / mean (stability = 0 if mean <= 0). Fewer than 2 active months → 50.
// F3 Bookkeeping activity & recency (25%): F3 = 0.7 × activity + 0.3 × recency
//    activity = min(active ledger days in last 90 / 60, 1) × 100
//    recency  = 100 if last entry ≤ 7 days ago, 0 if ≥ 60 days, linear in between. No entries → 0.

export const FORMULA_VERSION = "TS-1.0";
export const SCORE_MIN = 300;
export const SCORE_MAX = 900;
export const WEIGHTS = { repayment: 0.4, cashflow: 0.35, bookkeeping: 0.25 } as const;

export interface TrustInputs {
  asOf: string;
  dueInvoices: Array<{ amount: number; dueDate: string; settledDate: string | null }>;
  monthlyNet: number[]; // exactly the last 6 months, oldest first, 0 for months without activity
  activeMonths: number; // months (of those 6) with any cash activity
  activeLedgerDays90: number;
  daysSinceLastEntry: number | null;
  adjustmentPoints: number; // sum of active (non-revoked) adjustments, usually negative
}

export interface TrustResult {
  score: number;
  baseScore: number;
  adjustmentTotal: number;
  formulaVersion: string;
  factors: { repayment: number; cashflow: number; bookkeeping: number; weighted: number };
  explanations: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function repaymentFactor(inv: TrustInputs["dueInvoices"]): number {
  const total = inv.reduce((a, i) => a + i.amount, 0);
  if (inv.length === 0 || total <= 0) return 50;
  const onTime = inv.filter((i) => i.settledDate !== null && i.settledDate <= i.dueDate).reduce((a, i) => a + i.amount, 0);
  return r2((100 * onTime) / total);
}

export function cashflowFactor(monthlyNet: number[], activeMonths: number): number {
  if (activeMonths < 2 || monthlyNet.length === 0) return 50;
  const n = monthlyNet.length;
  const positiveShare = monthlyNet.filter((v) => v > 0).length / n;
  const mean = monthlyNet.reduce((a, v) => a + v, 0) / n;
  const variance = monthlyNet.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const stability = mean > 0 ? Math.max(0, 1 - Math.min(sd / mean, 1)) : 0;
  return r2(100 * (0.5 * positiveShare + 0.5 * stability));
}

export function bookkeepingFactor(activeDays90: number, daysSinceLast: number | null): number {
  if (daysSinceLast === null) return 0;
  const activity = Math.min(activeDays90 / 60, 1) * 100;
  let recency: number;
  if (daysSinceLast <= 7) recency = 100;
  else if (daysSinceLast >= 60) recency = 0;
  else recency = (100 * (60 - daysSinceLast)) / 53;
  return r2(0.7 * activity + 0.3 * recency);
}

export function computeTrustScore(inputs: TrustInputs): TrustResult {
  const repayment = repaymentFactor(inputs.dueInvoices);
  const cashflow = cashflowFactor(inputs.monthlyNet, inputs.activeMonths);
  const bookkeeping = bookkeepingFactor(inputs.activeLedgerDays90, inputs.daysSinceLastEntry);
  const weighted = r2(WEIGHTS.repayment * repayment + WEIGHTS.cashflow * cashflow + WEIGHTS.bookkeeping * bookkeeping);
  // round half up (Math.round rounds .5 up for positive numbers)
  const baseScore = clamp(Math.round(SCORE_MIN + 6 * weighted), SCORE_MIN, SCORE_MAX);
  const adjustmentTotal = Math.trunc(inputs.adjustmentPoints);
  const score = clamp(baseScore + adjustmentTotal, SCORE_MIN, SCORE_MAX);

  const explanations = [
    `On-time buyer repayment: ${repayment}/100 (${inputs.dueInvoices.length} invoice(s) due in the last 180 days)`,
    `Cash-flow consistency: ${cashflow}/100 (${inputs.activeMonths} active month(s) of the last 6)`,
    `Bookkeeping activity: ${bookkeeping}/100 (${inputs.activeLedgerDays90} active day(s) in 90; last entry ${
      inputs.daysSinceLastEntry === null ? "never" : `${inputs.daysSinceLastEntry} day(s) ago`
    })`,
    `Weighted ${weighted}/100 → base score ${baseScore}`,
  ];
  if (adjustmentTotal !== 0) explanations.push(`Adjustments (e.g. default penalties): ${adjustmentTotal} points`);
  if (score !== baseScore + adjustmentTotal) explanations.push(`Clamped to the ${SCORE_MIN}–${SCORE_MAX} range`);

  return { score, baseScore, adjustmentTotal, formulaVersion: FORMULA_VERSION, factors: { repayment, cashflow, bookkeeping, weighted }, explanations };
}

export function trustBadgeColor(score: number): "green" | "yellow" | "red" {
  if (score > 700) return "green";
  if (score >= 600) return "yellow";
  return "red";
}
