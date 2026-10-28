// src/features/ledger/fifo.ts
// First-in-first-out allocation of credits (payments) against charges (invoices).
// Used to work out WHEN each invoice was fully settled — the basis for on-time
// repayment rates, collection periods and overdue alerts. Pure and deterministic.
import { dec, money, type Dec } from "@/lib/money";

export interface Charge {
  id: string;
  date: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  amount: string;
  order: number; // tie-breaker (e.g. ledger seq)
}

export interface Credit {
  date: string;
  amount: string;
  order: number;
}

export interface Allocation {
  id: string;
  date: string;
  dueDate: string;
  amount: Dec;
  outstanding: Dec;
  settledDate: string | null;
}

export function allocateFifo(charges: Charge[], credits: Credit[]): Allocation[] {
  const cs = [...charges]
    .filter((c) => dec(c.amount).gt(0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const cr = [...credits]
    .filter((c) => dec(c.amount).gt(0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const out: Allocation[] = cs.map((c) => ({
    id: c.id,
    date: c.date,
    dueDate: c.dueDate,
    amount: money(c.amount),
    outstanding: money(c.amount),
    settledDate: null,
  }));

  let i = 0;
  for (const credit of cr) {
    let remaining = money(credit.amount);
    while (remaining.gt(0) && i < out.length) {
      const target = out[i]!;
      const applied = remaining.lt(target.outstanding) ? remaining : target.outstanding;
      target.outstanding = money(target.outstanding.minus(applied));
      remaining = money(remaining.minus(applied));
      if (target.outstanding.isZero()) {
        // An invoice paid in advance counts as settled on its own date.
        target.settledDate = credit.date > target.date ? credit.date : target.date;
        i++;
      }
    }
  }
  return out;
}
