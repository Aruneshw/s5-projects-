// src/server/services/reports.ts
// Read-only reports. Everything is derived from posted (non-cancelled) records and the ledger.
// Actual accounting figures, calculated estimates and statutory tax treatment are kept
// clearly separate in the tax summary (see docs/FINANCIAL_RULES.md §Tax).
import "server-only";
import { prisma } from "../db";
import { balances, totals } from "./ledger";
import { billSettlementMap } from "./receivables";
import { calcMargin } from "@/features/bills/calc";
import { dec, m2, money, q3, sum, type Dec } from "@/lib/money";
import { fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";

type Ctx = Pick<SessionContext, "orgId" | "settings">;
type Range = { from: string; to: string };

const dateFilter = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });

function chargeOf(b: { type: string; todayBill: unknown; coolieTotal: unknown; lessAmount: unknown; bonusAmount: unknown; commissionAmount: unknown }): Dec {
  const comm = dec(b.commissionAmount as string);
  return money(
    dec(b.todayBill as string)
      .plus(dec(b.coolieTotal as string))
      .minus(dec(b.lessAmount as string))
      .plus(dec(b.bonusAmount as string))
      .plus(b.type === "SALES" ? comm : comm.negated()),
  );
}

async function postedBills(ctx: Ctx, r: Range, type?: "PURCHASE" | "SALES") {
  return prisma.bill.findMany({
    where: { orgId: ctx.orgId, status: "POSTED", billDate: dateFilter(r), ...(type ? { type } : {}) },
    include: { store: { select: { shopName: true, city: true } }, createdBy: { select: { id: true, displayName: true } } },
    orderBy: [{ billDate: "asc" }, { billNumber: "asc" }],
  });
}

async function activePayments(ctx: Ctx, r: Range) {
  return prisma.payment.findMany({
    where: { orgId: ctx.orgId, status: "ACTIVE", paymentDate: dateFilter(r) },
    include: { paymentMode: { select: { name: true, isDigital: true } }, store: { select: { shopName: true, city: true } }, createdBy: { select: { id: true, displayName: true } } },
    orderBy: { paymentDate: "asc" },
  });
}

export async function dailyReport(ctx: Ctx, date: string) {
  const r = { from: date, to: date };
  const [bills, payments, expenses, salaries, bal] = await Promise.all([
    postedBills(ctx, r),
    activePayments(ctx, r),
    prisma.expense.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", expenseDate: toDbDate(date) } }),
    prisma.workerSalary.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", paymentDate: toDbDate(date) }, include: { worker: { select: { name: true } } } }),
    totals(ctx),
  ]);
  const map = (type: "PURCHASE" | "SALES") =>
    bills
      .filter((b) => b.type === type)
      .map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        party: `${b.store.shopName} — ${b.store.city}`,
        todayBill: m2(b.todayBill),
        coolie: m2(b.coolieTotal),
        charge: m2(chargeOf(b)),
        settled: m2(b.amountSettled),
        balance: m2(b.totalBalance),
        by: b.createdBy.displayName,
      }));
  const purchases = map("PURCHASE");
  const sales = map("SALES");
  const received = payments.filter((p) => p.direction === "RECEIVED");
  const paid = payments.filter((p) => p.direction === "PAID");
  return {
    date,
    purchases,
    sales,
    payments: payments.map((p) => ({
      id: p.id,
      direction: p.direction,
      party: `${p.store.shopName} — ${p.store.city}`,
      amount: m2(p.amount),
      mode: p.paymentMode.name,
      isDigital: p.paymentMode.isDigital,
      by: p.createdBy.displayName,
    })),
    expenses: expenses.map((e) => ({ id: e.id, category: e.category, amount: m2(e.amount), notes: e.notes })),
    salaries: salaries.map((s) => ({ id: s.id, worker: s.worker.name, amount: m2(s.amount) })),
    totals: {
      purchases: m2(sum(purchases.map((p) => p.charge))),
      sales: m2(sum(sales.map((s) => s.charge))),
      coolie: m2(sum(sales.map((s) => s.coolie))),
      received: m2(sum(received.map((p) => p.amount.toString()))),
      paid: m2(sum(paid.map((p) => p.amount.toString()))),
      expenses: m2(sum(expenses.map((e) => e.amount.toString()))),
      salaries: m2(sum(salaries.map((s) => s.amount.toString()))),
      receivableOutstanding: bal.receivable,
      payableOutstanding: bal.payable,
    },
  };
}

export async function billSummary(ctx: Ctx, r: Range, type: "PURCHASE" | "SALES") {
  const bills = await postedBills(ctx, r, type);
  const byDay = new Map<string, { count: number; value: Dec; coolie: Dec }>();
  const byUser = new Map<string, { name: string; count: number; value: Dec }>();
  const byParty = new Map<string, { count: number; value: Dec }>();
  for (const b of bills) {
    const d = fromDbDate(b.billDate);
    const c = chargeOf(b);
    const day = byDay.get(d) ?? { count: 0, value: dec(0), coolie: dec(0) };
    day.count++;
    day.value = day.value.plus(c);
    day.coolie = day.coolie.plus(dec(b.coolieTotal));
    byDay.set(d, day);
    const u = byUser.get(b.createdBy.id) ?? { name: b.createdBy.displayName, count: 0, value: dec(0) };
    u.count++;
    u.value = u.value.plus(c);
    byUser.set(b.createdBy.id, u);
    const pk = `${b.store.shopName} — ${b.store.city}`;
    const p = byParty.get(pk) ?? { count: 0, value: dec(0) };
    p.count++;
    p.value = p.value.plus(c);
    byParty.set(pk, p);
  }
  return {
    type,
    range: r,
    count: bills.length,
    total: m2(sum([...byDay.values()].map((d) => d.value))),
    byDay: [...byDay.entries()].map(([date, v]) => ({ date, count: v.count, value: m2(v.value), coolie: m2(v.coolie) })),
    byUser: [...byUser.entries()].map(([userId, v]) => ({ userId, name: v.name, count: v.count, value: m2(v.value) })),
    byParty: [...byParty.entries()].map(([party, v]) => ({ party, count: v.count, value: m2(v.value) })).sort((a, b) => dec(b.value).cmp(dec(a.value))),
  };
}

export async function balanceReport(ctx: Ctx, type: "SUPPLIER" | "CUSTOMER") {
  const rows = await balances(ctx, type);
  const settle = await billSettlementMap(ctx.orgId, { type, defaultCreditDays: ctx.settings.defaultCreditDays });
  const bills = await prisma.bill.findMany({ where: { orgId: ctx.orgId, status: "POSTED", type: type === "CUSTOMER" ? "SALES" : "PURCHASE" }, select: { id: true, storeId: true } });
  const today = todayIST();
  const overdueBy = new Map<string, { amount: Dec; oldestDue: string | null }>();
  for (const b of bills) {
    const s = settle.get(b.id);
    if (!s || s.status === "PAID") continue;
    const ageDays = Math.round((toDbDate(today).getTime() - toDbDate(s.dueDate).getTime()) / 86_400_000);
    if (ageDays < 0) continue;
    const o = overdueBy.get(b.storeId) ?? { amount: dec(0), oldestDue: null };
    o.amount = o.amount.plus(dec(s.outstanding));
    if (!o.oldestDue || s.dueDate < o.oldestDue) o.oldestDue = s.dueDate;
    overdueBy.set(b.storeId, o);
  }
  return rows.map((r) => {
    const o = overdueBy.get(r.storeId);
    const overdueDays = o?.oldestDue ? Math.round((toDbDate(today).getTime() - toDbDate(o.oldestDue).getTime()) / 86_400_000) : 0;
    return {
      ...r,
      overdueAmount: m2(o?.amount ?? 0),
      oldestDueDate: o?.oldestDue ?? null,
      overdueDays,
      alert: overdueDays >= ctx.settings.overdueAlertDays,
    };
  });
}

export async function itemWiseReport(ctx: Ctx, r: Range) {
  const rows = await prisma.$queryRaw<
    Array<{ itemId: string; name: string; unitType: string; type: "PURCHASE" | "SALES"; qty: string; bags: bigint; value: string; coolie: string }>
  >`
    SELECT i."id" AS "itemId", i."name", i."unitType"::text AS "unitType", b."type"::text AS "type",
           SUM(l."quantity")::text AS qty, SUM(l."bagCount")::bigint AS bags,
           SUM(l."amount")::text AS value, SUM(l."coolieAmount")::text AS coolie
    FROM "bill_lines" l JOIN "bills" b ON b."id" = l."billId" JOIN "items" i ON i."id" = l."itemId"
    WHERE b."orgId" = ${ctx.orgId}::uuid AND b."status" = 'POSTED'
      AND b."billDate" BETWEEN ${toDbDate(r.from)}::date AND ${toDbDate(r.to)}::date
    GROUP BY i."id", b."type" ORDER BY i."name"`;
  const map = new Map<string, { itemId: string; name: string; unitType: string; purchasedQty: string; purchasedBags: number; purchasedValue: string; soldQty: string; soldBags: number; soldValue: string; coolie: string }>();
  for (const x of rows) {
    const e = map.get(x.itemId) ?? { itemId: x.itemId, name: x.name, unitType: x.unitType, purchasedQty: "0.000", purchasedBags: 0, purchasedValue: "0.00", soldQty: "0.000", soldBags: 0, soldValue: "0.00", coolie: "0.00" };
    if (x.type === "PURCHASE") {
      e.purchasedQty = q3(x.qty);
      e.purchasedBags = Number(x.bags);
      e.purchasedValue = m2(x.value);
    } else {
      e.soldQty = q3(x.qty);
      e.soldBags = Number(x.bags);
      e.soldValue = m2(x.value);
      e.coolie = m2(x.coolie);
    }
    map.set(x.itemId, e);
  }
  return [...map.values()];
}

export async function cashVsDigital(ctx: Ctx, r: Range) {
  const [payments, expenses, salaries] = await Promise.all([
    activePayments(ctx, r),
    prisma.expense.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", expenseDate: dateFilter(r) }, include: { paymentMode: true } }),
    prisma.workerSalary.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", paymentDate: dateFilter(r) }, include: { paymentMode: true } }),
  ]);
  const bucket = () => ({ cash: dec(0), digital: dec(0) });
  const received = bucket();
  const paid = bucket();
  const byMode = new Map<string, { received: Dec; paid: Dec; isDigital: boolean }>();
  for (const p of payments) {
    const t = p.direction === "RECEIVED" ? received : paid;
    if (p.paymentMode.isDigital) t.digital = t.digital.plus(dec(p.amount));
    else t.cash = t.cash.plus(dec(p.amount));
    const m = byMode.get(p.paymentMode.name) ?? { received: dec(0), paid: dec(0), isDigital: p.paymentMode.isDigital };
    if (p.direction === "RECEIVED") m.received = m.received.plus(dec(p.amount));
    else m.paid = m.paid.plus(dec(p.amount));
    byMode.set(p.paymentMode.name, m);
  }
  const outflow = bucket();
  for (const e of [...expenses, ...salaries]) {
    if (e.paymentMode?.isDigital) outflow.digital = outflow.digital.plus(dec(e.amount));
    else outflow.cash = outflow.cash.plus(dec(e.amount));
  }
  const totalReceived = received.cash.plus(received.digital);
  return {
    range: r,
    received: { cash: m2(received.cash), digital: m2(received.digital) },
    paid: { cash: m2(paid.cash), digital: m2(paid.digital) },
    expensesAndSalaries: { cash: m2(outflow.cash), digital: m2(outflow.digital) },
    digitalReceiptPercent: totalReceived.isZero() ? "0.00" : received.digital.div(totalReceived).times(100).toFixed(2),
    byMode: [...byMode.entries()].map(([mode, v]) => ({ mode, isDigital: v.isDigital, received: m2(v.received), paid: m2(v.paid) })),
  };
}

export async function expenseReport(ctx: Ctx, r: Range) {
  const [expenses, salaries] = await Promise.all([
    prisma.expense.groupBy({ by: ["category"], where: { orgId: ctx.orgId, status: "ACTIVE", expenseDate: dateFilter(r) }, _sum: { amount: true }, _count: true }),
    prisma.workerSalary.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", paymentDate: dateFilter(r) }, include: { worker: { select: { name: true } } } }),
  ]);
  const byWorker = new Map<string, Dec>();
  for (const s of salaries) byWorker.set(s.worker.name, (byWorker.get(s.worker.name) ?? dec(0)).plus(dec(s.amount)));
  return {
    range: r,
    byCategory: expenses.map((e) => ({ category: e.category, count: e._count, amount: m2(e._sum.amount ?? 0) })),
    expenseTotal: m2(sum(expenses.map((e) => e._sum.amount?.toString() ?? "0"))),
    salaries: [...byWorker.entries()].map(([worker, amount]) => ({ worker, amount: m2(amount) })),
    salaryTotal: m2(sum(salaries.map((s) => s.amount.toString()))),
  };
}

/** Real item-level margins from sales lines linked to purchase sources. */
export async function marginReport(ctx: Ctx, r: Range) {
  const lines = await prisma.billLine.findMany({
    where: { orgId: ctx.orgId, bill: { type: "SALES", status: "POSTED", billDate: dateFilter(r) } },
    include: {
      item: { select: { id: true, name: true, unitType: true } },
      bill: { select: { billNumber: true, billDate: true, store: { select: { shopName: true, city: true } } } },
      sourceLink: { include: { purchaseLine: { include: { bill: { select: { billNumber: true, billDate: true, store: { select: { shopName: true, city: true } } } } } } } },
    },
    orderBy: { bill: { billDate: "asc" } },
  });
  const byItem = new Map<string, { name: string; soldQty: Dec; linkedQty: Dec; sales: Dec; cost: Dec; margin: Dec; unlinkedLines: number }>();
  const detail = [];
  for (const l of lines) {
    const it = byItem.get(l.item.id) ?? { name: l.item.name, soldQty: dec(0), linkedQty: dec(0), sales: dec(0), cost: dec(0), margin: dec(0), unlinkedLines: 0 };
    it.soldQty = it.soldQty.plus(dec(l.quantity));
    if (l.sourceLink) {
      const pr = l.sourceLink.purchaseLine.rate.toString();
      const { unitMargin, grossMargin } = calcMargin(l.rate.toString(), pr, l.quantity.toString());
      it.linkedQty = it.linkedQty.plus(dec(l.quantity));
      it.sales = it.sales.plus(dec(l.amount));
      it.cost = it.cost.plus(money(dec(pr).times(dec(l.quantity))));
      it.margin = it.margin.plus(grossMargin);
      detail.push({
        salesBillNumber: l.bill.billNumber,
        saleDate: fromDbDate(l.bill.billDate),
        customer: `${l.bill.store.shopName} — ${l.bill.store.city}`,
        item: l.item.name,
        lineMark: l.lineMark,
        quantity: q3(l.quantity),
        salesRate: m2(l.rate),
        purchaseRate: m2(pr),
        supplier: `${l.sourceLink.purchaseLine.bill.store.shopName} — ${l.sourceLink.purchaseLine.bill.store.city}`,
        purchaseBillNumber: l.sourceLink.purchaseLine.bill.billNumber,
        unitMargin: m2(unitMargin),
        grossMargin: m2(grossMargin),
      });
    } else it.unlinkedLines++;
    byItem.set(l.item.id, it);
  }
  return {
    range: r,
    items: [...byItem.entries()].map(([itemId, v]) => ({
      itemId,
      name: v.name,
      soldQty: q3(v.soldQty),
      linkedQty: q3(v.linkedQty),
      linkedSales: m2(v.sales),
      linkedCost: m2(v.cost),
      grossMargin: m2(v.margin),
      marginPercent: v.sales.isZero() ? "0.00" : v.margin.div(v.sales).times(100).toFixed(2),
      unlinkedLines: v.unlinkedLines,
    })),
    lines: detail,
    totalGrossMargin: m2(sum([...byItem.values()].map((v) => v.margin))),
  };
}

/**
 * Tax summary. THREE clearly separated sections:
 *   actual      — figures recorded in the ledger (facts)
 *   estimates   — calculations from those facts (e.g. trading result), NOT accounting profit
 *   statutory   — indicators based on CONFIGURABLE assumptions; not tax advice.
 */
export async function taxSummary(ctx: Ctx, r: Range) {
  const [bills, cvd, exp, members] = await Promise.all([
    postedBills(ctx, r),
    cashVsDigital(ctx, r),
    expenseReport(ctx, r),
    prisma.membership.findMany({ where: { orgId: ctx.orgId, role: "MSME_OWNER" }, include: { user: { select: { id: true, displayName: true } } } }),
  ]);
  const sales = bills.filter((b) => b.type === "SALES");
  const purchases = bills.filter((b) => b.type === "PURCHASE");
  const turnover = money(sum(sales.map(chargeOf)));
  const purchaseCost = money(sum(purchases.map(chargeOf)));
  const commissionIncome = money(sum(bills.map((b) => b.commissionAmount.toString())));
  const expenses = dec(exp.expenseTotal);
  const salaries = dec(exp.salaryTotal);
  const tradingResult = money(turnover.minus(purchaseCost).minus(expenses).minus(salaries));
  const margins = await marginReport(ctx, r);

  const t = ctx.settings.taxAssumptions;
  const receivedCash = dec(cvd.received.cash);
  const receivedDigital = dec(cvd.received.digital);
  const totalReceived = receivedCash.plus(receivedDigital);
  const cashShare = totalReceived.isZero() ? dec(0) : receivedCash.div(totalReceived).times(100);
  const enhancedEligible = cashShare.lte(t.enhancedLimitCashSharePercent);
  const limit = enhancedEligible ? t.presumptiveEnhancedLimit : t.presumptiveTurnoverLimit;
  const presumptive = money(receivedDigital.times(t.presumptiveDigitalPercent).div(100).plus(receivedCash.times(t.presumptiveCashPercent).div(100)));

  // Per-partner view: (a) attribution by who recorded each sale, (b) configured allocation of the estimate.
  const attribution = members.map((m) => {
    const mine = sales.filter((b) => b.createdById === m.user.id);
    return { userId: m.user.id, name: m.user.displayName, salesRecorded: m2(sum(mine.map(chargeOf))), billsRecorded: mine.length };
  });
  const alloc = ctx.settings.profitAllocation;
  const allocationTotal = Object.values(alloc).reduce((a, v) => a + v, 0);
  const allocation = members.map((m) => {
    const pct = alloc[m.user.id] ?? 0;
    return { userId: m.user.id, name: m.user.displayName, percent: pct, tradingResultShare: m2(tradingResult.times(pct).div(100)) };
  });

  return {
    range: r,
    disclaimer:
      "This summary is generated from your own records to help you talk to your Chartered Accountant. It is not tax advice and does not determine your tax liability.",
    actual: {
      turnover: m2(turnover),
      purchases: m2(purchaseCost),
      expenses: m2(expenses),
      workerSalaries: m2(salaries),
      commissionRecorded: m2(commissionIncome),
      receiptsCash: m2(receivedCash),
      receiptsDigital: m2(receivedDigital),
      digitalReceiptPercent: cvd.digitalReceiptPercent,
    },
    estimates: {
      tradingResult: m2(tradingResult),
      tradingResultNote: "Sales − purchases − expenses − salaries for the period. Ignores opening/closing stock value, so it is NOT accounting profit.",
      linkedGrossMargin: margins.totalGrossMargin,
      linkedGrossMarginNote: "Sum of (sales rate − linked purchase rate) × quantity for sales lines linked to a purchase batch.",
    },
    statutory: {
      assumptions: t,
      presumptiveIndicative: m2(presumptive),
      presumptiveNote: `Indicative only: ${t.presumptiveDigitalPercent}% of digital receipts + ${t.presumptiveCashPercent}% of other receipts, using the rates configured in Settings. Eligibility (e.g. commission/agency income may be excluded) must be confirmed with a CA.`,
      turnoverLimitApplied: m2(limit),
      cashReceiptSharePercent: cashShare.toFixed(2),
      turnoverWithinLimit: turnover.lte(limit),
      commissionWarning: commissionIncome.gt(0)
        ? "Commission was recorded in this period. Presumptive schemes may exclude commission/agency income — confirm with your CA."
        : null,
      gstNote: t.gstNote,
    },
    partners: { attribution, allocation, allocationConfigured: allocationTotal === 100 },
  };
}

/** Resolve "FY 2026-27" style filters. */
export function fyRange(label: string): Range {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new Error("Financial year must look like 2026-27");
  const start = Number(m[1]);
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}
