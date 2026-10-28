// src/server/services/ledger.ts
// The ledger is the ONLY source of truth for party balances. Balances are always computed
// as SUM(amount) over append-only ledger entries — never stored in an editable column.
import "server-only";
import { prisma, type Tx } from "../db";
import { dec, m2, money, type Dec } from "@/lib/money";
import { toDbDate, fromDbDate } from "@/lib/dates";
import { notFound } from "../errors";
import type { SessionContext } from "../auth/session";
import type { LedgerEntryType } from "@/generated/prisma/enums";

export async function storeBalance(client: Tx | typeof prisma, orgId: string, storeId: string): Promise<Dec> {
  const r = await client.ledgerEntry.aggregate({ where: { orgId, storeId }, _sum: { amount: true } });
  return money(dec(r._sum.amount ?? 0));
}

export async function postLedger(
  tx: Tx,
  e: {
    orgId: string;
    storeId: string;
    entryDate: string;
    entryType: LedgerEntryType;
    amount: Dec | string;
    description: string;
    createdById: string;
    billId?: string | null;
    paymentId?: string | null;
    adjustmentId?: string | null;
    reversesEntryId?: string | null;
  },
) {
  const amount = money(e.amount);
  if (amount.isZero()) return null; // zero-value lines are not recorded
  return tx.ledgerEntry.create({
    data: {
      orgId: e.orgId,
      storeId: e.storeId,
      entryDate: toDbDate(e.entryDate),
      entryType: e.entryType,
      amount: amount.toFixed(2),
      description: e.description.slice(0, 300),
      createdById: e.createdById,
      billId: e.billId ?? null,
      paymentId: e.paymentId ?? null,
      adjustmentId: e.adjustmentId ?? null,
      reversesEntryId: e.reversesEntryId ?? null,
    },
  });
}

/** Post a reversal for every not-yet-reversed entry matching `where`. Returns count. */
export async function reverseEntries(
  tx: Tx,
  orgId: string,
  where: { billId?: string; paymentId?: string; excludeTypes?: LedgerEntryType[] },
  entryDate: string,
  actorId: string,
  reason: string,
): Promise<number> {
  const entries = await tx.ledgerEntry.findMany({
    where: {
      orgId,
      ...(where.billId ? { billId: where.billId } : {}),
      ...(where.paymentId ? { paymentId: where.paymentId } : {}),
      entryType: { notIn: ["REVERSAL", ...(where.excludeTypes ?? [])] },
      reversedBy: null,
    },
    orderBy: { seq: "asc" },
  });
  for (const e of entries) {
    await postLedger(tx, {
      orgId,
      storeId: e.storeId,
      entryDate,
      entryType: "REVERSAL",
      amount: dec(e.amount).negated(),
      description: `Reversal of ${e.entryType}: ${reason}`,
      createdById: actorId,
      billId: e.billId,
      paymentId: e.paymentId,
      adjustmentId: e.adjustmentId,
      reversesEntryId: e.id,
    });
  }
  return entries.length;
}

export interface BalanceRow {
  storeId: string;
  shopName: string;
  city: string;
  type: "SUPPLIER" | "CUSTOMER";
  balance: string;
  lastActivity: string | null;
}

/** Outstanding balances per store, largest first. Customer = receivable; supplier = payable. */
export async function balances(ctx: Pick<SessionContext, "orgId">, type?: "SUPPLIER" | "CUSTOMER"): Promise<BalanceRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{ storeId: string; shopName: string; city: string; type: "SUPPLIER" | "CUSTOMER"; balance: string; lastActivity: Date | null }>
  >`
    SELECT s."id" AS "storeId", s."shopName", s."city", s."type",
           COALESCE(SUM(l."amount"), 0)::text AS "balance",
           MAX(l."entryDate") AS "lastActivity"
    FROM "stores" s
    LEFT JOIN "ledger_entries" l ON l."storeId" = s."id"
    WHERE s."orgId" = ${ctx.orgId}::uuid
    GROUP BY s."id"
    ORDER BY COALESCE(SUM(l."amount"), 0) DESC, s."shopName" ASC`;
  return rows
    .filter((r) => !type || r.type === type)
    .map((r) => ({ ...r, balance: m2(r.balance), lastActivity: r.lastActivity ? fromDbDate(r.lastActivity) : null }));
}

export async function totals(ctx: Pick<SessionContext, "orgId">) {
  const rows = await balances(ctx);
  let receivable = dec(0);
  let payable = dec(0);
  for (const r of rows) {
    const b = dec(r.balance);
    if (r.type === "CUSTOMER") receivable = receivable.plus(b);
    else payable = payable.plus(b);
  }
  return { receivable: m2(receivable), payable: m2(payable) };
}

export async function storeLedger(ctx: Pick<SessionContext, "orgId">, storeId: string, range?: { from?: string; to?: string }) {
  const store = await prisma.store.findFirst({ where: { id: storeId, orgId: ctx.orgId }, select: { id: true } });
  if (!store) throw notFound("Store");
  const from = range?.from;
  const opening = from
    ? await prisma.ledgerEntry.aggregate({
        where: { orgId: ctx.orgId, storeId, entryDate: { lt: toDbDate(from) } },
        _sum: { amount: true },
      })
    : null;
  let running = money(dec(opening?._sum.amount ?? 0));
  const broughtForward = running.toFixed(2);
  const entries = await prisma.ledgerEntry.findMany({
    where: {
      orgId: ctx.orgId,
      storeId,
      entryDate: { ...(from ? { gte: toDbDate(from) } : {}), ...(range?.to ? { lte: toDbDate(range.to) } : {}) },
    },
    orderBy: [{ entryDate: "asc" }, { seq: "asc" }],
    include: { bill: { select: { billNumber: true, type: true, status: true } } },
  });
  const rows = entries.map((e) => {
    running = money(running.plus(dec(e.amount)));
    return {
      id: e.id,
      entryDate: fromDbDate(e.entryDate),
      entryType: e.entryType,
      description: e.description,
      amount: m2(e.amount),
      runningBalance: running.toFixed(2),
      billId: e.billId,
      billNumber: e.bill?.billNumber ?? null,
      billType: e.bill?.type ?? null,
      paymentId: e.paymentId,
      isReversal: e.entryType === "REVERSAL",
    };
  });
  return { broughtForward, closing: running.toFixed(2), rows };
}
