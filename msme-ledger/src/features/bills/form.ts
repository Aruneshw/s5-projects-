// src/features/bills/form.ts — bill-entry form state and its conversion to the API payload.
// Pure functions (no React) so the weight-entry workflow can be unit tested.
import { BillCalcError, calcLine, calcSummary, type BillTypeT, type EntryModeT, type UnitTypeT } from "./calc";
import { dec } from "@/lib/money";

export interface LineState {
  key: string;
  itemId: string | null;
  entryMode: EntryModeT;
  lineMark: string;
  weights: string[];
  weightInput: string;
  quantity: string;
  bagCount: string;
  rate: string;
  sourcePurchaseLineId: string | null;
  allowOversell: boolean;
}

export interface BillFormState {
  id: string;
  serverVersion: number | null; // set when editing a server-side draft
  type: BillTypeT;
  storeId: string | null;
  billDate: string;
  dueDate: string;
  lines: LineState[];
  lessAmount: string;
  lessReason: string;
  bonusAmount: string;
  bonusReason: string;
  commissionOn: boolean;
  commissionPercent: string;
  amountSettled: string;
  settlementModeId: string | null;
  notes: string;
}

export function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
}

export function emptyLine(): LineState {
  return { key: newKey(), itemId: null, entryMode: "WEIGHED", lineMark: "", weights: [], weightInput: "", quantity: "", bagCount: "", rate: "", sourcePurchaseLineId: null, allowOversell: false };
}

export function emptyForm(type: BillTypeT, today: string, id: string = newKey()): BillFormState {
  return {
    id,
    serverVersion: null,
    type,
    storeId: null,
    billDate: today,
    dueDate: "",
    lines: [emptyLine()],
    lessAmount: "",
    lessReason: "",
    bonusAmount: "",
    bonusReason: "",
    commissionOn: false,
    commissionPercent: "1",
    amountSettled: "",
    settlementModeId: null,
    notes: "",
  };
}

const WEIGHT_RE = /^\d{1,4}(\.\d{1,3})?$/;

/**
 * The "next bag weight" prompt:
 *   - a valid weight is appended and the prompt clears for the next bag,
 *   - a BLANK submission finishes weighing (returns finished = true when at least one bag exists).
 */
export function submitWeight(line: LineState): { line: LineState; finished: boolean; error: string | null } {
  const raw = line.weightInput.trim();
  if (raw === "") {
    if (line.weights.length === 0) return { line, finished: false, error: "Enter the first bag weight" };
    return { line, finished: true, error: null };
  }
  if (!WEIGHT_RE.test(raw) || Number(raw) <= 0) return { line, finished: false, error: "Enter a weight like 70 or 72.5" };
  if (Number(raw) > 1000) return { line, finished: false, error: "That bag is heavier than 1000 kg — check the weight" };
  return { line: { ...line, weights: [...line.weights, raw], weightInput: "" }, finished: false, error: null };
}

export function lineIsBlank(l: LineState): boolean {
  return !l.itemId && !l.weights.length && !l.quantity && !l.rate;
}

export interface LinePreview {
  ok: boolean;
  error: string | null;
  bagCount: number;
  quantity: string;
  amount: string;
  coolieAmount: string;
}

export function previewLine(type: BillTypeT, l: LineState, item: { unitType: UnitTypeT; cooliePerBag: string } | undefined): LinePreview {
  const blank = { ok: false, error: null, bagCount: 0, quantity: "0", amount: "0.00", coolieAmount: "0.00" };
  if (!item) return blank;
  try {
    const r = calcLine(type, {
      unitType: item.unitType,
      entryMode: l.entryMode,
      weights: l.weights,
      quantity: l.quantity || undefined,
      bagCount: l.bagCount ? Number(l.bagCount) : undefined,
      rate: l.rate || "0",
      cooliePerBag: item.cooliePerBag,
    });
    return { ok: !!l.rate, error: l.rate ? null : "Enter the rate", bagCount: r.bagCount, quantity: r.quantity.toFixed(3), amount: r.amount.toFixed(2), coolieAmount: r.coolieAmount.toFixed(2) };
  } catch (e) {
    return { ...blank, error: e instanceof BillCalcError ? e.message : "Check this line" };
  }
}

export function previewSummary(form: BillFormState, previews: LinePreview[], previousBalance: string) {
  try {
    return calcSummary({
      billType: form.type,
      lines: previews.filter((p) => p.ok).map((p) => ({ amount: p.amount, coolieAmount: p.coolieAmount })),
      previousBalance,
      lessAmount: form.lessAmount || "0",
      lessReason: form.lessReason,
      bonusAmount: form.bonusAmount || "0",
      bonusReason: form.bonusReason,
      commissionPercent: form.commissionOn ? form.commissionPercent || "0" : "0",
      amountSettled: form.amountSettled || "0",
    });
  } catch {
    return null;
  }
}

/** Build the API payload. Totals are NOT sent: the server computes them. */
export function formToPayload(form: BillFormState, opts: { post: boolean; clientPreviousBalance?: string }) {
  const lines = form.lines
    .filter((l) => !lineIsBlank(l))
    .map((l) => ({
      itemId: l.itemId!,
      entryMode: l.entryMode,
      lineMark: l.lineMark.trim() || null,
      ...(l.entryMode === "WEIGHED" ? { weights: l.weights } : {}),
      ...(l.entryMode === "COUNT" ? { quantity: l.quantity } : {}),
      ...(l.entryMode === "COMBINED_LOT" ? { quantity: l.quantity, bagCount: Number(l.bagCount || 0) } : {}),
      rate: l.rate,
      sourcePurchaseLineId: form.type === "SALES" ? l.sourcePurchaseLineId : null,
      ...(l.allowOversell ? { allowOversell: true } : {}),
    }));
  return {
    id: form.id,
    type: form.type,
    storeId: form.storeId!,
    billDate: form.billDate,
    dueDate: form.dueDate || null,
    lines,
    lessAmount: form.lessAmount || "0",
    lessReason: form.lessReason.trim() || null,
    bonusAmount: form.bonusAmount || "0",
    bonusReason: form.bonusReason.trim() || null,
    commissionPercent: form.commissionOn ? form.commissionPercent || "0" : "0",
    amountSettled: form.amountSettled || "0",
    settlementModeId: dec(form.amountSettled || 0).gt(0) ? form.settlementModeId : null,
    notes: form.notes.trim() || null,
    post: opts.post,
    ...(opts.clientPreviousBalance !== undefined ? { clientPreviousBalance: opts.clientPreviousBalance } : {}),
  };
}

export function validateForm(form: BillFormState, previews: LinePreview[]): string[] {
  const errs: string[] = [];
  if (!form.storeId) errs.push(form.type === "SALES" ? "Choose the customer" : "Choose the supplier");
  const used = form.lines.map((l, i) => ({ l, p: previews[i]! })).filter(({ l }) => !lineIsBlank(l));
  if (used.length === 0) errs.push("Add at least one item");
  used.forEach(({ l, p }, i) => {
    if (!l.itemId) errs.push(`Line ${i + 1}: choose an item`);
    else if (!p.ok) errs.push(`Line ${i + 1}: ${p.error ?? "incomplete"}`);
    if (l.entryMode === "WEIGHED" && l.weightInput.trim()) errs.push(`Line ${i + 1}: press Enter to add the last weight (${l.weightInput})`);
  });
  if (Number(form.lessAmount || 0) > 0 && !form.lessReason.trim()) errs.push("Give a reason for Less");
  if (Number(form.bonusAmount || 0) > 0 && !form.bonusReason.trim()) errs.push("Give a reason for Bonus");
  return errs;
}
