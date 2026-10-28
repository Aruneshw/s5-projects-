// src/features/bills/calc.ts
// Pure bill arithmetic shared by the server (authoritative) and the client (preview only).
// See docs/FINANCIAL_RULES.md for the formulas and rounding rules.
import { D, dec, money, qty, sum, type Dec, type DecimalInput } from "@/lib/money";

export type BillTypeT = "PURCHASE" | "SALES";
export type UnitTypeT = "KG" | "BAG" | "BOX";
export type EntryModeT = "WEIGHED" | "COUNT" | "COMBINED_LOT";

export const MAX_BAG_WEIGHT_KG = 1000;

export interface LineCalcInput {
  unitType: UnitTypeT;
  entryMode: EntryModeT;
  /** WEIGHED: individual bag weights in kg */
  weights?: DecimalInput[];
  /** COUNT: number of bags/boxes. COMBINED_LOT: total kg. */
  quantity?: DecimalInput;
  /** COMBINED_LOT only: number of bags in the lot */
  bagCount?: number;
  rate: DecimalInput;
  /** Item master coolie per bag (used on SALES bills only) */
  cooliePerBag: DecimalInput;
}

export interface LineCalcResult {
  bagCount: number;
  quantity: Dec;
  amount: Dec;
  coolieRate: Dec;
  coolieAmount: Dec;
  weights: Dec[];
}

export class BillCalcError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "BillCalcError";
  }
}

export function allowedModes(unit: UnitTypeT): EntryModeT[] {
  return unit === "KG" ? ["WEIGHED", "COMBINED_LOT"] : ["COUNT"];
}

/** Bag count and kg total from individual weights: 70 + 80 → 2 bags, 150 kg. */
export function summarizeWeights(weights: DecimalInput[]): { bagCount: number; totalKg: Dec; weights: Dec[] } {
  const ws = weights.map((w) => qty(w));
  ws.forEach((w, i) => {
    if (!w.isFinite() || w.lte(0)) throw new BillCalcError(`Bag ${i + 1}: weight must be greater than 0`, "weights");
    if (w.gt(MAX_BAG_WEIGHT_KG)) throw new BillCalcError(`Bag ${i + 1}: weight above ${MAX_BAG_WEIGHT_KG} kg`, "weights");
  });
  return { bagCount: ws.length, totalKg: qty(sum(ws)), weights: ws };
}

export function calcLine(billType: BillTypeT, input: LineCalcInput): LineCalcResult {
  if (!allowedModes(input.unitType).includes(input.entryMode)) {
    throw new BillCalcError(`Entry mode ${input.entryMode} is not valid for unit ${input.unitType}`, "entryMode");
  }
  const rate = money(input.rate);
  if (rate.isNegative()) throw new BillCalcError("Rate cannot be negative", "rate");

  let bagCount: number;
  let quantity: Dec;
  let weights: Dec[] = [];

  if (input.entryMode === "WEIGHED") {
    if (!input.weights || input.weights.length === 0) {
      throw new BillCalcError("Enter at least one bag weight", "weights");
    }
    const s = summarizeWeights(input.weights);
    bagCount = s.bagCount;
    quantity = s.totalKg;
    weights = s.weights;
  } else if (input.entryMode === "COUNT") {
    // Bag/box items: quantity entered directly; weight entry is skipped.
    quantity = qty(input.quantity ?? 0);
    if (quantity.lte(0) || !quantity.isInteger()) {
      throw new BillCalcError("Quantity must be a whole number greater than 0", "quantity");
    }
    bagCount = quantity.toNumber();
  } else {
    // COMBINED_LOT: total kg + bag count recorded without reweighing.
    quantity = qty(input.quantity ?? 0);
    if (quantity.lte(0)) throw new BillCalcError("Lot weight must be greater than 0", "quantity");
    bagCount = input.bagCount ?? 0;
    if (!Number.isInteger(bagCount) || bagCount < 1) {
      throw new BillCalcError("Bag count for a combined lot must be at least 1", "bagCount");
    }
  }

  const amount = money(quantity.times(rate));
  // Coolie applies to SALES bills only — never purchase bills.
  const coolieRate = billType === "SALES" ? money(input.cooliePerBag) : new D(0);
  const coolieAmount = money(coolieRate.times(bagCount));
  return { bagCount, quantity, amount, coolieRate, coolieAmount, weights };
}

export interface SummaryInput {
  billType: BillTypeT;
  lines: Array<{ amount: DecimalInput; coolieAmount: DecimalInput }>;
  previousBalance: DecimalInput;
  lessAmount: DecimalInput;
  lessReason?: string | null;
  bonusAmount: DecimalInput;
  bonusReason?: string | null;
  commissionPercent: DecimalInput;
  amountSettled: DecimalInput;
}

export interface BillSummary {
  coolieTotal: Dec;
  todayBill: Dec;
  previousBalance: Dec;
  total: Dec;
  lessAmount: Dec;
  bonusAmount: Dec;
  commissionAmount: Dec;
  amountSettled: Dec;
  totalBalance: Dec;
}

/**
 * Purchase: Total = Today's Bill + Previous; Balance = Total − Less + Bonus − Commission − Settled
 * Sales:    Total = Coolie + Today's Bill + Previous; Balance = Total − Less + Bonus + Commission − Received
 * Commission is optional (0% by default) — see docs/FINANCIAL_RULES.md §Commission.
 */
export function calcSummary(input: SummaryInput): BillSummary {
  const todayBill = money(sum(input.lines.map((l) => l.amount)));
  const coolieTotal = input.billType === "SALES" ? money(sum(input.lines.map((l) => l.coolieAmount))) : new D(0);
  const previousBalance = money(input.previousBalance);
  const lessAmount = money(input.lessAmount);
  const bonusAmount = money(input.bonusAmount);
  const amountSettled = money(input.amountSettled);
  const pct = dec(input.commissionPercent);

  if (lessAmount.isNegative()) throw new BillCalcError("Less cannot be negative", "lessAmount");
  if (bonusAmount.isNegative()) throw new BillCalcError("Bonus cannot be negative", "bonusAmount");
  if (amountSettled.isNegative()) throw new BillCalcError("Amount settled cannot be negative", "amountSettled");
  if (pct.isNegative() || pct.gt(100)) throw new BillCalcError("Commission % must be between 0 and 100", "commissionPercent");
  if (lessAmount.gt(0) && !input.lessReason?.trim()) throw new BillCalcError("A reason is required for Less", "lessReason");
  if (bonusAmount.gt(0) && !input.bonusReason?.trim()) throw new BillCalcError("A reason is required for Bonus", "bonusReason");

  const commissionAmount = money(todayBill.times(pct).div(100));
  const total = money(coolieTotal.plus(todayBill).plus(previousBalance));
  const commissionEffect = input.billType === "SALES" ? commissionAmount : commissionAmount.negated();
  const totalBalance = money(total.minus(lessAmount).plus(bonusAmount).plus(commissionEffect).minus(amountSettled));

  return { coolieTotal, todayBill, previousBalance, total, lessAmount, bonusAmount, commissionAmount, amountSettled, totalBalance };
}

/** The bill's own effect on the party balance (excludes previous balance and the at-bill settlement). */
export function billCharge(s: Pick<BillSummary, "todayBill" | "coolieTotal" | "lessAmount" | "bonusAmount" | "commissionAmount">, billType: BillTypeT): Dec {
  const comm = billType === "SALES" ? s.commissionAmount : s.commissionAmount.negated();
  return money(dec(s.todayBill).plus(s.coolieTotal).minus(s.lessAmount).plus(s.bonusAmount).plus(comm));
}

/** Unit Margin = Sales Rate − Linked Purchase Rate; Gross = Unit Margin × Sold Quantity. */
export function calcMargin(salesRate: DecimalInput, purchaseRate: DecimalInput, soldQuantity: DecimalInput) {
  const unitMargin = money(dec(salesRate).minus(dec(purchaseRate)));
  const grossMargin = money(unitMargin.times(dec(soldQuantity)));
  return { unitMargin, grossMargin };
}
