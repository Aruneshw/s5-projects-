// src/server/services/receivables.ts
// Invoice-level settlement status derived from the LEDGER (authoritative) using FIFO.
//
//   * Entries that were reversed, and REVERSAL entries themselves, are ignored
//     (so cancelled bills and cancelled payments drop out cleanly).
//   * Non-payment entries are grouped per bill → the bill's own net charge.
//   * Payment entries are credits. Standalone entries (opening, corrections) are charges or credits.
//   * Credits are applied to the oldest charges first.
import "server-only";
import { prisma } from "../db";
import { allocateFifo, type Allocation, type Charge, type Credit } from "@/features/ledger/fifo";
import { dec, m2 } from "@/lib/money";
import { addDays, fromDbDate, todayIST } from "@/lib/dates";

export type InvoiceStatus = "PAID" | "PARTIAL" | "UNPAID" | "OVERDUE";

export interface StoreAllocation {
  storeId: string;
  storeType: "SUPPLIER" | "CUSTOMER";
  allocations: Allocation[];
}

export async function allocateStores(orgId: string, opts: { storeIds?: string[]; type?: "SUPPLIER" | "CUSTOMER"; defaultCreditDays?: number } = {}) {
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      orgId,
      ...(opts.storeIds ? { storeId: { in: opts.storeIds } } : {}),
      ...(opts.type ? { store: { type: opts.type } } : {}),
      entryType: { not: "REVERSAL" },
      reversedBy: null,
    },
    select: {
      id: true,
      seq: true,
      storeId: true,
      entryDate: true,
      entryType: true,
      amount: true,
      billId: true,
      paymentId: true,
      store: { select: { type: true } },
      bill: { select: { billDate: true, dueDate: true, status: true } },
    },
    orderBy: { seq: "asc" },
  });

  const creditDays = opts.defaultCreditDays ?? 30;
  const byStore = new Map<string, { type: "SUPPLIER" | "CUSTOMER"; charges: Map<string, Charge>; credits: Credit[] }>();

  for (const e of entries) {
    let s = byStore.get(e.storeId);
    if (!s) {
      s = { type: e.store.type, charges: new Map(), credits: [] };
      byStore.set(e.storeId, s);
    }
    const amount = dec(e.amount);
    const date = fromDbDate(e.entryDate);
    const order = Number(e.seq);
    if (e.entryType === "PAYMENT" || e.paymentId) {
      // Payments reduce the balance (amount < 0) → credit
      if (amount.isNegative()) s.credits.push({ date, amount: amount.negated().toFixed(2), order });
      else s.charges.set(`e:${e.id}`, { id: `e:${e.id}`, date, dueDate: date, amount: amount.toFixed(2), order });
      continue;
    }
    if (e.billId && e.bill) {
      const key = `b:${e.billId}`;
      const billDate = fromDbDate(e.bill.billDate);
      const due = e.bill.dueDate ? fromDbDate(e.bill.dueDate) : addDays(billDate, creditDays);
      const existing = s.charges.get(key);
      if (existing) existing.amount = dec(existing.amount).plus(amount).toFixed(2);
      else s.charges.set(key, { id: key, date: billDate, dueDate: due, amount: amount.toFixed(2), order });
      continue;
    }
    if (amount.isPositive()) s.charges.set(`e:${e.id}`, { id: `e:${e.id}`, date, dueDate: date, amount: amount.toFixed(2), order });
    else s.credits.push({ date, amount: amount.negated().toFixed(2), order });
  }

  const result: StoreAllocation[] = [];
  for (const [storeId, s] of byStore) {
    // A bill whose net effect is negative (e.g. large Less) behaves as a credit.
    const charges: Charge[] = [];
    for (const c of s.charges.values()) {
      if (dec(c.amount).isNegative()) s.credits.push({ date: c.date, amount: dec(c.amount).negated().toFixed(2), order: c.order });
      else charges.push(c);
    }
    result.push({ storeId, storeType: s.type, allocations: allocateFifo(charges, s.credits) });
  }
  return result;
}

export function statusOf(a: Allocation, asOf: string = todayIST()): InvoiceStatus {
  if (a.outstanding.isZero()) return "PAID";
  if (a.dueDate < asOf) return "OVERDUE";
  if (a.outstanding.lt(a.amount)) return "PARTIAL";
  return "UNPAID";
}

/** billId → settlement info for the given stores. */
export async function billSettlementMap(orgId: string, opts: Parameters<typeof allocateStores>[1] = {}) {
  const allocs = await allocateStores(orgId, opts);
  const map = new Map<string, { amount: string; outstanding: string; settledDate: string | null; dueDate: string; status: InvoiceStatus }>();
  for (const s of allocs) {
    for (const a of s.allocations) {
      if (!a.id.startsWith("b:")) continue;
      map.set(a.id.slice(2), {
        amount: m2(a.amount),
        outstanding: m2(a.outstanding),
        settledDate: a.settledDate,
        dueDate: a.dueDate,
        status: statusOf(a),
      });
    }
  }
  return map;
}
