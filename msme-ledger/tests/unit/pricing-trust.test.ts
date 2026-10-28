// tests/unit/pricing-trust.test.ts — discount pricing, trust score, FIFO, permissions, CSV safety, OCR parsing.
import { describe, expect, it } from "vitest";
import { calculateDiscountPricing, PricingError, annualRateForScore } from "@/features/discounting/pricing";
import { computeTrustScore, cashflowFactor, repaymentFactor, bookkeepingFactor, trustBadgeColor, type TrustInputs } from "@/features/credit/trust-score";
import { allocateFifo } from "@/features/ledger/fifo";
import { hasPermission } from "@/server/authorization/permissions";
import { safeCell, toCsv } from "@/server/services/exports";
import { parsePurchaseBillText } from "@/features/ocr/parse";
import { financialYearOf, lastMonths } from "@/lib/dates";

describe("calculateDiscountPricing", () => {
  it("score 720 → 12%: ₹50,000 for 30 days", () => {
    const p = calculateDiscountPricing("50000", 30, 720);
    expect(p.annualRatePercent.toFixed(2)).toBe("12.00");
    expect(p.discountFee.toFixed(2)).toBe("493.15"); // 50000 × 0.12/365 × 30 = 493.1506…
    expect(p.reserveHoldback.toFixed(2)).toBe("7500.00");
    expect(p.upfrontPayout.toFixed(2)).toBe("42006.85");
    expect(p.upfrontPayout.plus(p.reserveHoldback).plus(p.discountFee).toFixed(2)).toBe("50000.00");
  });
  it("rate bands: ≥750 → 10%, 650–749 → 12%, <650 → 15%", () => {
    expect(annualRateForScore(750).toNumber()).toBe(10);
    expect(annualRateForScore(749).toNumber()).toBe(12);
    expect(annualRateForScore(650).toNumber()).toBe(12);
    expect(annualRateForScore(649).toNumber()).toBe(15);
  });
  it("odd paise amounts still sum exactly", () => {
    const p = calculateDiscountPricing("12345.67", 45, 610);
    expect(p.upfrontPayout.plus(p.reserveHoldback).plus(p.discountFee).toFixed(2)).toBe("12345.67");
  });
  it("rejects invalid tenure, amount and score", () => {
    expect(() => calculateDiscountPricing("10000", 0, 700)).toThrow(PricingError);
    expect(() => calculateDiscountPricing("10000", 181, 700)).toThrow(PricingError);
    expect(() => calculateDiscountPricing("10000", 10.5, 700)).toThrow(PricingError);
    expect(() => calculateDiscountPricing("-1", 30, 700)).toThrow(PricingError);
    expect(() => calculateDiscountPricing("10.001", 30, 700)).toThrow(PricingError);
    expect(() => calculateDiscountPricing("10000", 30, 950)).toThrow(PricingError);
  });
});

const baseInputs: TrustInputs = {
  asOf: "2026-10-15",
  dueInvoices: [
    { amount: 10000, dueDate: "2026-09-01", settledDate: "2026-08-30" },
    { amount: 5000, dueDate: "2026-09-15", settledDate: "2026-09-20" },
  ],
  monthlyNet: [10000, 12000, 11000, 9000, 10000, 11000],
  activeMonths: 6,
  activeLedgerDays90: 45,
  daysSinceLastEntry: 2,
  adjustmentPoints: 0,
};

describe("trust score", () => {
  it("is deterministic and inside 300–900", () => {
    const a = computeTrustScore(baseInputs);
    const b = computeTrustScore(structuredClone(baseInputs));
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(300);
    expect(a.score).toBeLessThanOrEqual(900);
    expect(a.formulaVersion).toBe("TS-1.0");
  });
  it("factors are normalised 0–100 with documented neutral defaults", () => {
    expect(repaymentFactor([])).toBe(50);
    expect(repaymentFactor(baseInputs.dueInvoices)).toBeCloseTo(66.67, 2);
    expect(cashflowFactor([0, 0, 0, 0, 0, 5000], 1)).toBe(50);
    expect(bookkeepingFactor(0, null)).toBe(0);
    expect(bookkeepingFactor(60, 0)).toBe(100);
  });
  it("worked example: weighted → base score", () => {
    const r = computeTrustScore(baseInputs);
    // F1 = 66.67; F2 = 100×(0.5×1 + 0.5×(1 − CV)) with CV≈0.0886 → 95.57; F3 = 0.7×75 + 0.3×100 = 82.5
    expect(r.factors.repayment).toBeCloseTo(66.67, 2);
    expect(r.factors.bookkeeping).toBe(82.5);
    expect(r.baseScore).toBe(Math.round(300 + 6 * r.factors.weighted));
  });
  it("extremes clamp to 300 and 900", () => {
    const worst = computeTrustScore({ ...baseInputs, dueInvoices: [{ amount: 1, dueDate: "2026-09-01", settledDate: null }], monthlyNet: [-1, -1, -1, -1, -1, -1], daysSinceLastEntry: null, adjustmentPoints: -500 });
    expect(worst.score).toBe(300);
    const best = computeTrustScore({ ...baseInputs, dueInvoices: [{ amount: 1, dueDate: "2026-09-01", settledDate: "2026-09-01" }], monthlyNet: [5, 5, 5, 5, 5, 5], activeLedgerDays90: 90, daysSinceLastEntry: 0, adjustmentPoints: 500 });
    expect(best.score).toBe(900);
  });
  it("a −50 adjustment lowers the score by exactly 50 when not clamped", () => {
    const a = computeTrustScore(baseInputs);
    const b = computeTrustScore({ ...baseInputs, adjustmentPoints: -50 });
    expect(a.score - b.score).toBe(50);
  });
  it("badge colours: green > 700, yellow 600–700, red < 600", () => {
    expect(trustBadgeColor(701)).toBe("green");
    expect(trustBadgeColor(700)).toBe("yellow");
    expect(trustBadgeColor(600)).toBe("yellow");
    expect(trustBadgeColor(599)).toBe("red");
  });
});

describe("FIFO settlement", () => {
  it("pays oldest invoices first and records the settlement date", () => {
    const out = allocateFifo(
      [
        { id: "a", date: "2026-01-01", dueDate: "2026-01-31", amount: "1000", order: 1 },
        { id: "b", date: "2026-01-10", dueDate: "2026-02-10", amount: "500", order: 2 },
      ],
      [{ date: "2026-01-20", amount: "1200", order: 3 }],
    );
    expect(out[0]!.outstanding.toFixed(2)).toBe("0.00");
    expect(out[0]!.settledDate).toBe("2026-01-20");
    expect(out[1]!.outstanding.toFixed(2)).toBe("300.00");
    expect(out[1]!.settledDate).toBeNull();
  });
});

describe("RBAC map", () => {
  it("cashier cannot access reports, discounting, credit or margins", () => {
    for (const p of ["report:read", "report:export", "discount:request", "discount:read", "credit:read", "credit:apply", "bill:margin:view", "team:manage", "bill:create:purchase"] as const) {
      expect(hasPermission("STAFF_CASHIER", p)).toBe(false);
    }
    expect(hasPermission("STAFF_CASHIER", "bill:create:sales")).toBe(true);
    expect(hasPermission("STAFF_CASHIER", "expense:create")).toBe(true);
    expect(hasPermission("STAFF_CASHIER", "bill:print")).toBe(true);
  });
  it("investors and lenders have no business-ledger access", () => {
    expect(hasPermission("INVESTOR", "bill:read")).toBe(false);
    expect(hasPermission("LENDER_BANK", "ledger:read")).toBe(false);
    expect(hasPermission("MSME_OWNER", "marketplace:bid")).toBe(false);
  });
});

describe("CSV export safety", () => {
  it("neutralises spreadsheet formula injection but keeps negative numbers", () => {
    expect(safeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("-120.00")).toBe("-120.00");
    const csv = toCsv({ title: "t", columns: [{ key: "a", label: "A" }], rows: [{ a: 'He said "hi", ok' }] });
    expect(csv).toContain('"He said ""hi"", ok"');
  });
});

describe("OCR parsing (untrusted candidates)", () => {
  const text = `Ganesh Farms\nBill No 42   Date: 12/10/2026\nTomato 150 kg 22 3300\nCarrot 102 30 3060\nTotal Rs. 6,360`;
  it("extracts supplier, date, lines and total; validates arithmetic", () => {
    const c = parsePurchaseBillText(text, [{ id: "s1", name: "Ganesh Farms" }], [{ id: "i1", name: "Tomato" }, { id: "i2", name: "Carrot" }]);
    expect(c.storeId).toBe("s1");
    expect(c.date).toBe("2026-10-12");
    expect(c.lines).toHaveLength(2);
    expect(c.lines[0]).toMatchObject({ itemId: "i1", quantity: "150", rate: "22", amount: "3300.00", issues: [] });
    expect(c.total).toBe("6360.00");
    expect(c.issues).toEqual([]);
  });
  it("flags arithmetic mismatches instead of trusting them", () => {
    const c = parsePurchaseBillText("Ganesh Farms\n01/10/2026\nTomato 10 20 250\nTotal 250", [], [{ id: "i1", name: "Tomato" }]);
    expect(c.lines[0]!.issues.join(" ")).toMatch(/Qty × rate = 200.00/);
    expect(c.issues.join(" ")).toMatch(/Supplier not recognised/);
  });
});

describe("dates", () => {
  it("Indian financial year", () => {
    expect(financialYearOf("2026-10-15")).toEqual({ label: "2026-27", start: "2026-04-01", end: "2027-03-31" });
    expect(financialYearOf("2027-03-31").label).toBe("2026-27");
  });
  it("last N months", () => {
    expect(lastMonths("2026-02-10", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});
