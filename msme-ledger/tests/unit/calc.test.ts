// tests/unit/calc.test.ts — pure financial arithmetic.
import { describe, expect, it } from "vitest";
import { calcLine, calcMargin, calcSummary, summarizeWeights, BillCalcError, billCharge } from "@/features/bills/calc";
import { formatINR, money } from "@/lib/money";

describe("variable-weight (kg) entry", () => {
  it("70 kg + 80 kg = 150 kg across two bags", () => {
    const s = summarizeWeights(["70", "80"]);
    expect(s.bagCount).toBe(2);
    expect(s.totalKg.toFixed(3)).toBe("150.000");
  });

  it("line total = total kg × rate per kg, individual weights kept", () => {
    const l = calcLine("PURCHASE", { unitType: "KG", entryMode: "WEIGHED", weights: ["70", "80"], rate: "22.50", cooliePerBag: "10" });
    expect(l.amount.toFixed(2)).toBe("3375.00");
    expect(l.weights.map((w) => w.toFixed(3))).toEqual(["70.000", "80.000"]);
    expect(l.bagCount).toBe(2);
  });

  it("rejects zero / negative / absurd bag weights", () => {
    expect(() => summarizeWeights(["70", "0"])).toThrow(BillCalcError);
    expect(() => summarizeWeights(["-5"])).toThrow(BillCalcError);
    expect(() => summarizeWeights(["1001"])).toThrow(/above 1000/);
  });

  it("combined lot records total kg and bag count without individual weights", () => {
    const l = calcLine("SALES", { unitType: "KG", entryMode: "COMBINED_LOT", quantity: "100", bagCount: 2, rate: "36", cooliePerBag: "10" });
    expect(l.quantity.toFixed(3)).toBe("100.000");
    expect(l.bagCount).toBe(2);
    expect(l.weights).toHaveLength(0);
    expect(l.coolieAmount.toFixed(2)).toBe("20.00");
  });
});

describe("bag / box entry bypasses weight entry", () => {
  it("quantity entered directly; bag count = quantity", () => {
    const l = calcLine("PURCHASE", { unitType: "BAG", entryMode: "COUNT", quantity: "20", rate: "900", cooliePerBag: "12" });
    expect(l.bagCount).toBe(20);
    expect(l.amount.toFixed(2)).toBe("18000.00");
    expect(l.weights).toHaveLength(0);
  });
  it("weighed mode is not allowed for bag items, count mode not for kg items", () => {
    expect(() => calcLine("SALES", { unitType: "BAG", entryMode: "WEIGHED", weights: ["50"], rate: "1", cooliePerBag: "0" })).toThrow(/not valid/);
    expect(() => calcLine("SALES", { unitType: "KG", entryMode: "COUNT", quantity: "5", rate: "1", cooliePerBag: "0" })).toThrow(/not valid/);
  });
  it("fractional bag counts are rejected", () => {
    expect(() => calcLine("SALES", { unitType: "BOX", entryMode: "COUNT", quantity: "2.5", rate: "1", cooliePerBag: "0" })).toThrow(/whole number/);
  });
});

describe("coolie", () => {
  it("sales coolie = coolie rate per bag × bag count", () => {
    const l = calcLine("SALES", { unitType: "KG", entryMode: "WEIGHED", weights: ["70", "80", "75"], rate: "28", cooliePerBag: "10" });
    expect(l.coolieAmount.toFixed(2)).toBe("30.00");
  });
  it("purchase bills never carry coolie", () => {
    const l = calcLine("PURCHASE", { unitType: "BAG", entryMode: "COUNT", quantity: "10", rate: "100", cooliePerBag: "12" });
    expect(l.coolieRate.toFixed(2)).toBe("0.00");
    expect(l.coolieAmount.toFixed(2)).toBe("0.00");
    const s = calcSummary({ billType: "PURCHASE", lines: [{ amount: "1000", coolieAmount: "120" }], previousBalance: "0", lessAmount: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0" });
    expect(s.coolieTotal.toFixed(2)).toBe("0.00");
  });
});

describe("bill summaries", () => {
  it("purchase example: ₹11,500 + ₹200 bonus − ₹5,000 settled = ₹6,700 payable", () => {
    const s = calcSummary({
      billType: "PURCHASE",
      lines: [{ amount: "7500", coolieAmount: "0" }, { amount: "4000", coolieAmount: "0" }],
      previousBalance: "0",
      lessAmount: "0",
      bonusAmount: "200",
      bonusReason: "Festival bonus",
      commissionPercent: "0",
      amountSettled: "5000",
    });
    expect(s.todayBill.toFixed(2)).toBe("11500.00");
    expect(s.total.toFixed(2)).toBe("11500.00");
    expect(s.totalBalance.toFixed(2)).toBe("6700.00");
  });

  it("sales: Total = Coolie + Today's Bill + Previous; Balance = Total − Less + Bonus − Received", () => {
    const s = calcSummary({
      billType: "SALES",
      lines: [{ amount: "4200", coolieAmount: "20" }, { amount: "3600", coolieAmount: "20" }],
      previousBalance: "8500",
      lessAmount: "100",
      lessReason: "Damaged crate",
      bonusAmount: "0",
      commissionPercent: "0",
      amountSettled: "2000",
    });
    expect(s.coolieTotal.toFixed(2)).toBe("40.00");
    expect(s.total.toFixed(2)).toBe("16340.00");
    expect(s.totalBalance.toFixed(2)).toBe("14240.00");
  });

  it("less / bonus above zero need a reason", () => {
    const base = { billType: "SALES" as const, lines: [{ amount: "100", coolieAmount: "0" }], previousBalance: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0" };
    expect(() => calcSummary({ ...base, lessAmount: "10" })).toThrow(/reason/);
    expect(() => calcSummary({ ...base, lessAmount: "0", bonusAmount: "5" })).toThrow(/reason/);
  });

  it("commission is opt-in (1% example) and reduces a payable / adds to a receivable", () => {
    const p = calcSummary({ billType: "PURCHASE", lines: [{ amount: "10000", coolieAmount: "0" }], previousBalance: "0", lessAmount: "0", bonusAmount: "0", commissionPercent: "1", amountSettled: "0" });
    expect(p.commissionAmount.toFixed(2)).toBe("100.00");
    expect(p.totalBalance.toFixed(2)).toBe("9900.00");
    const s = calcSummary({ billType: "SALES", lines: [{ amount: "10000", coolieAmount: "0" }], previousBalance: "0", lessAmount: "0", bonusAmount: "0", commissionPercent: "1", amountSettled: "0" });
    expect(s.totalBalance.toFixed(2)).toBe("10100.00");
    const none = calcSummary({ billType: "SALES", lines: [{ amount: "10000", coolieAmount: "0" }], previousBalance: "0", lessAmount: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0" });
    expect(none.commissionAmount.toFixed(2)).toBe("0.00");
  });

  it("billCharge excludes previous balance and settlement", () => {
    const c = billCharge({ todayBill: money("1000"), coolieTotal: money("20"), lessAmount: money("10"), bonusAmount: money("0"), commissionAmount: money("0") }, "SALES");
    expect(c.toFixed(2)).toBe("1010.00");
  });
});

describe("decimal safety and rounding", () => {
  it("no float drift: 0.1 kg × ₹0.2 style values", () => {
    const l = calcLine("SALES", { unitType: "KG", entryMode: "WEIGHED", weights: ["0.1", "0.2"], rate: "0.30", cooliePerBag: "0" });
    expect(l.quantity.toFixed(3)).toBe("0.300");
    expect(l.amount.toFixed(2)).toBe("0.09");
  });
  it("money rounds half up at 2dp; quantities at 3dp", () => {
    const l = calcLine("SALES", { unitType: "KG", entryMode: "WEIGHED", weights: ["33.3335"], rate: "1.05", cooliePerBag: "0" });
    expect(l.quantity.toFixed(3)).toBe("33.334"); // 33.3335 → 33.334
    expect(l.amount.toFixed(2)).toBe("35.00"); // 33.334 × 1.05 = 35.0007 → 35.00
    expect(money("2.005").toFixed(2)).toBe("2.01");
  });
  it("Indian number formatting", () => {
    expect(formatINR("1234567.5")).toBe("₹12,34,567.50");
    expect(formatINR("999")).toBe("₹999.00");
    expect(formatINR("-100000")).toBe("-₹1,00,000.00");
  });
});

describe("margins", () => {
  it("unit margin = sales rate − purchase rate; gross = unit × sold quantity", () => {
    const m = calcMargin("28", "22", "150");
    expect(m.unitMargin.toFixed(2)).toBe("6.00");
    expect(m.grossMargin.toFixed(2)).toBe("900.00");
  });
  it("negative margins are reported, not hidden", () => {
    expect(calcMargin("20", "22.50", "10").grossMargin.toFixed(2)).toBe("-25.00");
  });
});
