// src/server/services/bills.ts
// Purchase & sales billing. All amounts are (re)calculated here on the server; numbers sent
// by the client are never trusted. Posting a bill, in ONE transaction:
//   lock store → validate purchase links → snapshot previous balance → number the bill →
//   ledger entries → at-bill settlement payment → stock movements → mark POSTED.
import "server-only";
import { prisma, type Tx } from "../db";
import { withActorTx, lockStore, lockKey } from "../tx";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { postLedger, reverseEntries, storeBalance } from "./ledger";
import { storeLabel } from "./stores";
import { billSettlementMap } from "./receivables";
import {
  BillCalcError,
  billCharge,
  calcLine,
  calcMargin,
  calcSummary,
  type BillTypeT,
  type LineCalcResult,
} from "@/features/bills/calc";
import { dec, m2, q3, type Dec } from "@/lib/money";
import { addDays, fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import { hasPermission } from "../authorization/permissions";
import type { SessionContext } from "../auth/session";
import { BillDraftUpdateSchema, BillInputSchema, type BillInput, type BillLineInput } from "@/lib/validation/schemas";
import type { z } from "zod";
import type { BillSource } from "@/generated/prisma/enums";

export type BillCtx = Pick<SessionContext, "orgId" | "userId" | "role" | "settings">;

export function assertCanCreate(ctx: BillCtx, type: BillTypeT): void {
  const perm = type === "SALES" ? "bill:create:sales" : "bill:create:purchase";
  if (!hasPermission(ctx.role, perm)) throw forbidden(`You cannot create ${type.toLowerCase()} bills`);
}

interface PreparedLine {
  input: BillLineInput;
  calc: LineCalcResult;
  itemName: string;
}

async function prepare(ctx: BillCtx, input: Pick<BillInput, "type" | "storeId" | "lines">) {
  const store = await prisma.store.findFirst({ where: { id: input.storeId, orgId: ctx.orgId } });
  if (!store) throw notFound("Store");
  if (!store.isActive) throw invalid("This store is inactive");
  const expected = input.type === "PURCHASE" ? "SUPPLIER" : "CUSTOMER";
  if (store.type !== expected) throw invalid(`${input.type === "PURCHASE" ? "Purchase" : "Sales"} bills need a ${expected.toLowerCase()}`);

  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, orgId: ctx.orgId } });
  const byId = new Map(items.map((i) => [i.id, i]));

  const lines: PreparedLine[] = input.lines.map((l, idx) => {
    const item = byId.get(l.itemId);
    if (!item) throw invalid(`Line ${idx + 1}: item not found`);
    if (!item.isActive) throw invalid(`Line ${idx + 1}: ${item.name} is inactive`);
    if (input.type === "PURCHASE" && l.sourcePurchaseLineId) throw invalid("Purchase lines cannot link to a purchase source");
    try {
      const calc = calcLine(input.type, {
        unitType: item.unitType,
        entryMode: l.entryMode,
        weights: l.weights,
        quantity: l.quantity,
        bagCount: l.bagCount,
        rate: l.rate,
        cooliePerBag: item.cooliePerBag.toString(),
      });
      return { input: l, calc, itemName: item.name };
    } catch (e) {
      if (e instanceof BillCalcError) throw invalid(`Line ${idx + 1} (${item.name}): ${e.message}`, { line: idx + 1, field: e.field });
      throw e;
    }
  });
  return { store, lines };
}

async function insertLines(tx: Tx, orgId: string, billId: string, lines: PreparedLine[]) {
  for (const [idx, l] of lines.entries()) {
    const created = await tx.billLine.create({
      data: {
        orgId,
        billId,
        lineNo: idx + 1,
        itemId: l.input.itemId,
        entryMode: l.input.entryMode,
        lineMark: l.input.lineMark ?? null,
        bagCount: l.calc.bagCount,
        quantity: q3(l.calc.quantity),
        rate: m2(dec(l.input.rate)),
        amount: m2(l.calc.amount),
        coolieRate: m2(l.calc.coolieRate),
        coolieAmount: m2(l.calc.coolieAmount),
      },
    });
    if (l.calc.weights.length) {
      await tx.bagWeight.createMany({
        data: l.calc.weights.map((w, i) => ({ billLineId: created.id, seq: i + 1, weightKg: q3(w) })),
      });
    }
    if (l.input.sourcePurchaseLineId) {
      const src = await tx.billLine.findFirst({
        where: { id: l.input.sourcePurchaseLineId, orgId },
        include: { bill: { select: { type: true, status: true } } },
      });
      if (!src || src.bill.type !== "PURCHASE") throw invalid(`Line ${idx + 1}: linked purchase line does not exist`);
      if (src.bill.status !== "POSTED") throw invalid(`Line ${idx + 1}: linked purchase bill is not posted (cancelled or draft)`);
      if (src.itemId !== l.input.itemId) throw invalid(`Line ${idx + 1}: linked purchase line is a different item`);
      await tx.purchaseSaleLink.create({
        data: { orgId, salesLineId: created.id, purchaseLineId: src.id, quantity: q3(l.calc.quantity) },
      });
    }
  }
}

/** Remaining quantity on a purchase line = purchased − sold through POSTED sales lines (excluding one bill). */
export async function purchaseLineRemaining(client: Tx | typeof prisma, purchaseLineId: string, excludeSalesBillId?: string): Promise<Dec> {
  const rows = await client.$queryRaw<Array<{ purchased: string; sold: string }>>`
    SELECT pl."quantity"::text AS purchased,
           COALESCE((SELECT SUM(k."quantity") FROM "purchase_sale_links" k
                     JOIN "bill_lines" sl ON sl."id" = k."salesLineId"
                     JOIN "bills" sb ON sb."id" = sl."billId"
                     WHERE k."purchaseLineId" = pl."id" AND sb."status" = 'POSTED'
                       AND (${excludeSalesBillId ?? null}::uuid IS NULL OR sb."id" <> ${excludeSalesBillId ?? null}::uuid)), 0)::text AS sold
    FROM "bill_lines" pl WHERE pl."id" = ${purchaseLineId}::uuid`;
  const r = rows[0];
  if (!r) return dec(0);
  return dec(r.purchased).minus(dec(r.sold));
}

async function defaultCashModeId(tx: Tx, orgId: string): Promise<string> {
  const mode = await tx.paymentMode.findFirst({ where: { orgId, isActive: true, isDigital: false }, orderBy: { createdAt: "asc" } });
  if (!mode) throw invalid("No cash payment mode configured. Add one under Settings.");
  return mode.id;
}

async function postBillInTx(
  tx: Tx,
  ctx: BillCtx,
  billId: string,
  opts: { allowOversell: boolean; settlementModeId?: string | null; clientPreviousBalance?: string },
) {
  const bill = await tx.bill.findFirst({
    where: { id: billId, orgId: ctx.orgId },
    include: { lines: { include: { sourceLink: true }, orderBy: { lineNo: "asc" } } },
  });
  if (!bill) throw notFound("Bill");
  if (bill.status !== "DRAFT") throw conflict("Bill is already posted");
  await lockStore(tx, bill.storeId);

  // 1. Purchase-source validation (lock each source line to serialise availability checks).
  const warnings: string[] = [];
  const linked = bill.lines.filter((l) => l.sourceLink);
  const sourceIds = [...new Set(linked.map((l) => l.sourceLink!.purchaseLineId))].sort();
  for (const id of sourceIds) await lockKey(tx, `pline:${id}`);
  for (const id of sourceIds) {
    const src = await tx.billLine.findFirst({ where: { id, orgId: ctx.orgId }, include: { bill: { select: { status: true, type: true } } } });
    if (!src || src.bill.type !== "PURCHASE" || src.bill.status !== "POSTED") {
      throw conflict("A linked purchase bill was cancelled or no longer exists. Re-link the sale.");
    }
    const remaining = await purchaseLineRemaining(tx, id, bill.id);
    const wanted = linked.filter((l) => l.sourceLink!.purchaseLineId === id).reduce((a, l) => a.plus(dec(l.quantity)), dec(0));
    if (wanted.gt(remaining)) {
      const canApprove = opts.allowOversell && hasPermission(ctx.role, "bill:oversell:approve");
      if (!canApprove) {
        throw conflict(`Sale exceeds the linked purchase batch: ${q3(wanted)} requested, ${q3(remaining.isNegative() ? 0 : remaining)} remaining`, {
          purchaseLineId: id,
          requested: q3(wanted),
          remaining: q3(remaining),
        });
      }
      for (const l of linked.filter((x) => x.sourceLink!.purchaseLineId === id)) {
        await tx.purchaseSaleLink.update({ where: { id: l.sourceLink!.id }, data: { oversold: true, approvedById: ctx.userId } });
      }
      warnings.push(`Oversold batch approved and flagged for reconciliation (${q3(wanted)} vs ${q3(remaining)} remaining)`);
    }
  }

  // 2. Server-authoritative summary.
  const previous = await storeBalance(tx, ctx.orgId, bill.storeId);
  const type = bill.type as BillTypeT;
  const summary = calcSummary({
    billType: type,
    lines: bill.lines.map((l) => ({ amount: l.amount.toString(), coolieAmount: l.coolieAmount.toString() })),
    previousBalance: previous,
    lessAmount: bill.lessAmount.toString(),
    lessReason: bill.lessReason,
    bonusAmount: bill.bonusAmount.toString(),
    bonusReason: bill.bonusReason,
    commissionPercent: bill.commissionPercent.toString(),
    amountSettled: bill.amountSettled.toString(),
  });

  // 3. Gap-free number per (org, type). The row lock serialises concurrent posters.
  const seq = await tx.$queryRaw<Array<{ n: number }>>`
    INSERT INTO "bill_sequences" ("orgId", "billType", "nextNumber") VALUES (${ctx.orgId}::uuid, ${bill.type}::"BillType", 2)
    ON CONFLICT ("orgId", "billType") DO UPDATE SET "nextNumber" = "bill_sequences"."nextNumber" + 1
    RETURNING ("nextNumber" - 1)::int AS n`;
  const billNumber = seq[0]!.n;
  const billDate = fromDbDate(bill.billDate);
  const label = `${type === "SALES" ? "Sales" : "Purchase"} bill #${billNumber}`;

  // 4. Ledger entries (party-balance sign convention: + increases what is owed).
  const common = { orgId: ctx.orgId, storeId: bill.storeId, entryDate: billDate, createdById: ctx.userId, billId: bill.id };
  await postLedger(tx, { ...common, entryType: "BILL_CHARGE", amount: summary.todayBill, description: `${label}: items` });
  await postLedger(tx, { ...common, entryType: "COOLIE", amount: summary.coolieTotal, description: `${label}: coolie` });
  await postLedger(tx, { ...common, entryType: "LESS", amount: summary.lessAmount.negated(), description: `${label}: less — ${bill.lessReason ?? ""}` });
  await postLedger(tx, { ...common, entryType: "BONUS", amount: summary.bonusAmount, description: `${label}: bonus — ${bill.bonusReason ?? ""}` });
  await postLedger(tx, {
    ...common,
    entryType: "COMMISSION",
    amount: type === "SALES" ? summary.commissionAmount : summary.commissionAmount.negated(),
    description: `${label}: commission ${bill.commissionPercent.toString()}%`,
  });

  // 5. Amount settled / received at billing time is a real Payment record.
  if (summary.amountSettled.gt(0)) {
    const modeId = opts.settlementModeId ?? (await defaultCashModeId(tx, ctx.orgId));
    const mode = await tx.paymentMode.findFirst({ where: { id: modeId, orgId: ctx.orgId, isActive: true } });
    if (!mode) throw invalid("Payment mode not found");
    const payment = await tx.payment.create({
      data: {
        orgId: ctx.orgId,
        storeId: bill.storeId,
        billId: bill.id,
        direction: type === "SALES" ? "RECEIVED" : "PAID",
        paymentModeId: modeId,
        amount: m2(summary.amountSettled),
        paymentDate: bill.billDate,
        notes: `${type === "SALES" ? "Received" : "Settled"} with ${label}`,
        idempotencyKey: `bill-settlement:${bill.id}`,
        createdById: ctx.userId,
      },
    });
    await postLedger(tx, {
      ...common,
      entryType: "PAYMENT",
      amount: summary.amountSettled.negated(),
      description: `${type === "SALES" ? "Received" : "Paid"} (${mode.name}) with ${label}`,
      paymentId: payment.id,
    });
  }

  // 6. Stock movements: purchases IN (+), sales OUT (−).
  const sign = type === "PURCHASE" ? 1 : -1;
  for (const l of bill.lines) {
    await tx.inventoryMovement.create({
      data: {
        orgId: ctx.orgId,
        itemId: l.itemId,
        movementDate: bill.billDate,
        type: type === "PURCHASE" ? "PURCHASE" : "SALE",
        quantity: q3(dec(l.quantity).times(sign)),
        bagCount: l.bagCount * sign,
        billLineId: l.id,
        createdById: ctx.userId,
      },
    });
  }
  if (type === "SALES") {
    const itemIds = [...new Set(bill.lines.map((l) => l.itemId))];
    const stock = await tx.inventoryMovement.groupBy({ by: ["itemId"], where: { orgId: ctx.orgId, itemId: { in: itemIds } }, _sum: { quantity: true } });
    for (const s of stock) {
      if (dec(s._sum.quantity ?? 0).isNegative()) {
        const item = await tx.item.findUnique({ where: { id: s.itemId }, select: { name: true } });
        warnings.push(`Stock of ${item?.name ?? "an item"} is now negative (${q3(s._sum.quantity ?? 0)}). Record the purchase or reconcile.`);
      }
    }
  }

  // 7. Freeze: POSTED with server totals.
  const dueDate = bill.dueDate ?? (type === "SALES" ? toDbDate(addDays(billDate, ctx.settings.defaultCreditDays)) : null);
  await tx.bill.update({
    where: { id: bill.id },
    data: {
      status: "POSTED",
      billNumber,
      dueDate,
      previousBalance: m2(summary.previousBalance),
      todayBill: m2(summary.todayBill),
      coolieTotal: m2(summary.coolieTotal),
      total: m2(summary.total),
      commissionAmount: m2(summary.commissionAmount),
      totalBalance: m2(summary.totalBalance),
      postedAt: new Date(),
      postedById: ctx.userId,
      lastEditedById: ctx.userId,
      version: { increment: 1 },
    },
  });

  let drift: { client: string; server: string } | null = null;
  if (opts.clientPreviousBalance !== undefined && !dec(opts.clientPreviousBalance).equals(summary.previousBalance)) {
    drift = { client: m2(opts.clientPreviousBalance), server: m2(summary.previousBalance) };
    warnings.push(
      `Previous balance changed since this bill was prepared (device showed ${drift.client}, server used ${drift.server}). Totals were recalculated on the server.`,
    );
  }
  return { warnings, drift };
}

function draftData(ctx: BillCtx, input: Omit<BillInput, "id" | "type">, previous: Dec, lines: PreparedLine[], type: BillTypeT) {
  const summary = calcSummary({
    billType: type,
    lines: lines.map((l) => ({ amount: l.calc.amount, coolieAmount: l.calc.coolieAmount })),
    previousBalance: previous,
    lessAmount: input.lessAmount,
    lessReason: input.lessReason,
    bonusAmount: input.bonusAmount,
    bonusReason: input.bonusReason,
    commissionPercent: input.commissionPercent,
    amountSettled: input.amountSettled,
  });
  return {
    summary,
    data: {
      billDate: toDbDate(input.billDate),
      dueDate: input.dueDate ? toDbDate(input.dueDate) : null,
      storeId: input.storeId,
      previousBalance: m2(summary.previousBalance),
      todayBill: m2(summary.todayBill),
      coolieTotal: m2(summary.coolieTotal),
      total: m2(summary.total),
      lessAmount: m2(summary.lessAmount),
      lessReason: input.lessReason ?? null,
      bonusAmount: m2(summary.bonusAmount),
      bonusReason: input.bonusReason ?? null,
      commissionPercent: dec(input.commissionPercent).toFixed(2),
      commissionAmount: m2(summary.commissionAmount),
      amountSettled: m2(summary.amountSettled),
      totalBalance: m2(summary.totalBalance),
      notes: input.notes ?? null,
      lastEditedById: ctx.userId,
    },
  };
}

function wrapCalc<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BillCalcError) throw invalid(e.message, { field: e.field });
    throw e;
  }
}

/** Server-side preview: what the bill WOULD look like if posted now. Saves nothing. */
export async function previewBill(ctx: BillCtx, raw: z.input<typeof BillInputSchema>) {
  const input = BillInputSchema.parse(raw);
  assertCanCreate(ctx, input.type);
  const { store, lines } = await prepare(ctx, input);
  const previous = await storeBalance(prisma, ctx.orgId, store.id);
  const { summary } = wrapCalc(() => draftData(ctx, input, previous, lines, input.type));
  return {
    store: { id: store.id, label: storeLabel(store) },
    lines: lines.map((l) => ({
      itemId: l.input.itemId,
      itemName: l.itemName,
      bagCount: l.calc.bagCount,
      quantity: q3(l.calc.quantity),
      amount: m2(l.calc.amount),
      coolieAmount: m2(l.calc.coolieAmount),
    })),
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, m2(v)])),
  };
}

export async function createBill(ctx: BillCtx, raw: z.input<typeof BillInputSchema>, opts: { source?: BillSource } = {}) {
  const input = BillInputSchema.parse(raw);
  assertCanCreate(ctx, input.type);
  if (input.id) {
    const existing = await prisma.bill.findUnique({ where: { id: input.id }, select: { id: true, orgId: true } });
    if (existing) {
      if (existing.orgId !== ctx.orgId) throw conflict("Bill id already in use");
      return { bill: await getBill(ctx, existing.id), warnings: [] as string[], duplicate: true };
    }
  }
  const { lines } = await prepare(ctx, input);
  if (dec(input.amountSettled).gt(0) && input.settlementModeId) {
    const mode = await prisma.paymentMode.findFirst({ where: { id: input.settlementModeId, orgId: ctx.orgId } });
    if (!mode) throw invalid("Payment mode not found");
  }

  const result = await withActorTx(ctx, async (tx) => {
    await lockStore(tx, input.storeId);
    const previous = await storeBalance(tx, ctx.orgId, input.storeId);
    const { data } = wrapCalc(() => draftData(ctx, input, previous, lines, input.type));
    const bill = await tx.bill.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        orgId: ctx.orgId,
        type: input.type,
        status: "DRAFT",
        source: opts.source ?? "MANUAL",
        createdById: ctx.userId,
        ...data,
      },
    });
    await insertLines(tx, ctx.orgId, bill.id, lines);
    if (!input.post) return { billId: bill.id, warnings: [] as string[] };
    const posted = await postBillInTx(tx, ctx, bill.id, {
      allowOversell: lines.some((l) => l.input.allowOversell),
      settlementModeId: input.settlementModeId,
      clientPreviousBalance: input.clientPreviousBalance,
    });
    return { billId: bill.id, warnings: posted.warnings };
  });
  return { bill: await getBill(ctx, result.billId), warnings: result.warnings, duplicate: false };
}

export async function updateDraft(ctx: BillCtx, id: string, raw: z.input<typeof BillDraftUpdateSchema>) {
  const input = BillDraftUpdateSchema.parse(raw);
  const existing = await prisma.bill.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) throw notFound("Bill");
  assertCanCreate(ctx, existing.type);
  if (existing.status !== "DRAFT") throw conflict("Only draft bills can be edited. Posted bills are corrected with adjustments or cancellation.");
  const { lines } = await prepare(ctx, { ...input, type: existing.type });

  const result = await withActorTx(ctx, async (tx) => {
    await lockStore(tx, input.storeId);
    const previous = await storeBalance(tx, ctx.orgId, input.storeId);
    const { data } = wrapCalc(() => draftData(ctx, input, previous, lines, existing.type));
    const upd = await tx.bill.updateMany({ where: { id, orgId: ctx.orgId, status: "DRAFT", version: input.version }, data: { ...data, version: { increment: 1 } } });
    if (upd.count === 0) {
      const now = await tx.bill.findFirst({ where: { id }, select: { version: true, status: true } });
      throw conflict("This bill was changed on another device. Reload to see the latest version.", { currentVersion: now?.version, status: now?.status });
    }
    const oldLines = await tx.billLine.findMany({ where: { billId: id }, select: { id: true } });
    const oldIds = oldLines.map((l) => l.id);
    await tx.purchaseSaleLink.deleteMany({ where: { salesLineId: { in: oldIds } } });
    await tx.bagWeight.deleteMany({ where: { billLineId: { in: oldIds } } });
    await tx.billLine.deleteMany({ where: { billId: id } });
    await insertLines(tx, ctx.orgId, id, lines);
    if (!input.post) return { warnings: [] as string[] };
    return postBillInTx(tx, ctx, id, {
      allowOversell: lines.some((l) => l.input.allowOversell),
      settlementModeId: input.settlementModeId,
      clientPreviousBalance: input.clientPreviousBalance,
    });
  });
  return { bill: await getBill(ctx, id), warnings: result.warnings };
}

export async function postDraft(ctx: BillCtx, id: string, version: number, opts: { allowOversell?: boolean; settlementModeId?: string | null } = {}) {
  const existing = await prisma.bill.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) throw notFound("Bill");
  assertCanCreate(ctx, existing.type);
  if (existing.version !== version) throw conflict("This bill was changed on another device. Reload first.", { currentVersion: existing.version });
  const res = await withActorTx(ctx, (tx) => postBillInTx(tx, ctx, id, { allowOversell: opts.allowOversell ?? false, settlementModeId: opts.settlementModeId }));
  return { bill: await getBill(ctx, id), warnings: res.warnings };
}

export async function deleteDraft(ctx: BillCtx, id: string, version: number) {
  const existing = await prisma.bill.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!existing) throw notFound("Bill");
  assertCanCreate(ctx, existing.type);
  if (existing.status !== "DRAFT") throw conflict("Posted bills are never deleted. Cancel the bill instead.");
  if (existing.version !== version) throw conflict("This draft was changed on another device.");
  await withActorTx(ctx, async (tx) => {
    const lines = await tx.billLine.findMany({ where: { billId: id }, select: { id: true } });
    const ids = lines.map((l) => l.id);
    await tx.purchaseSaleLink.deleteMany({ where: { salesLineId: { in: ids } } });
    await tx.bagWeight.deleteMany({ where: { billLineId: { in: ids } } });
    await tx.billLine.deleteMany({ where: { billId: id } });
    await tx.bill.delete({ where: { id } });
  });
  return { deleted: true };
}

/**
 * Cancel a posted bill: reverse its ledger charges and stock movements with auditable reversal
 * records. The bill and its lines stay in history. Payments made at billing time are NOT
 * reversed automatically (the money really moved): they remain as a credit on the store's
 * account until separately cancelled.
 */
export async function cancelBill(ctx: BillCtx, id: string, reason: string, version: number) {
  const bill = await prisma.bill.findFirst({ where: { id, orgId: ctx.orgId }, include: { lines: { select: { id: true } } } });
  if (!bill) throw notFound("Bill");
  if (bill.status !== "POSTED") throw conflict(bill.status === "CANCELLED" ? "Bill is already cancelled" : "Drafts are deleted, not cancelled");
  if (bill.version !== version) throw conflict("This bill was changed on another device. Reload first.", { currentVersion: bill.version });

  await withActorTx(ctx, async (tx) => {
    await lockStore(tx, bill.storeId);
    if (bill.type === "PURCHASE") {
      const activeSales = await tx.purchaseSaleLink.count({
        where: { purchaseLineId: { in: bill.lines.map((l) => l.id) }, salesLine: { bill: { status: { in: ["POSTED", "DRAFT"] } } } },
      });
      if (activeSales > 0) {
        throw conflict(`${activeSales} sales line(s) are linked to this purchase. Cancel or re-link those sales first.`);
      }
    }
    const today = todayIST();
    await reverseEntries(tx, ctx.orgId, { billId: id, excludeTypes: ["PAYMENT"] }, today, ctx.userId, `bill cancelled — ${reason}`);
    const movements = await tx.inventoryMovement.findMany({
      where: { orgId: ctx.orgId, billLineId: { in: bill.lines.map((l) => l.id) }, reversedBy: null, type: { not: "CANCEL_REVERSAL" } },
    });
    for (const mv of movements) {
      await tx.inventoryMovement.create({
        data: {
          orgId: ctx.orgId,
          itemId: mv.itemId,
          movementDate: toDbDate(today),
          type: "CANCEL_REVERSAL",
          quantity: q3(dec(mv.quantity).negated()),
          bagCount: -mv.bagCount,
          billLineId: mv.billLineId,
          reversesMovementId: mv.id,
          note: `Bill cancelled — ${reason}`,
          createdById: ctx.userId,
        },
      });
    }
    const upd = await tx.bill.updateMany({
      where: { id, version, status: "POSTED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, lastEditedById: ctx.userId, version: { increment: 1 } },
    });
    if (upd.count === 0) throw conflict("This bill was changed concurrently. Reload and retry.");
  });
  return getBill(ctx, id);
}

/** Audited correction on a posted bill (coolie correction, extra less / bonus). */
export async function addBillAdjustment(
  ctx: BillCtx,
  billId: string,
  input: { type: "COOLIE_CORRECTION" | "LESS" | "BONUS"; amount: string; reason: string; entryDate: string },
) {
  const bill = await prisma.bill.findFirst({ where: { id: billId, orgId: ctx.orgId } });
  if (!bill) throw notFound("Bill");
  if (bill.status !== "POSTED") throw conflict("Adjustments can only be made on posted bills");
  if (input.type === "COOLIE_CORRECTION" && bill.type !== "SALES") throw invalid("Coolie applies to sales bills only");
  const active = await prisma.discountRequest.count({ where: { billId, status: { in: ["LISTED", "BID_ACCEPTED", "FUNDED", "DEFAULTED"] } } });
  if (active > 0) throw conflict("This invoice is under a financing request; its terms are frozen");

  let effect = dec(input.amount);
  if (input.type === "LESS") effect = effect.abs().negated();
  if (input.type === "BONUS") effect = effect.abs();
  if (input.type === "COOLIE_CORRECTION" && dec(bill.coolieTotal).plus(effect).isNegative()) {
    throw invalid("Coolie correction would make total coolie negative");
  }
  return withActorTx(ctx, async (tx) => {
    await lockStore(tx, bill.storeId);
    const adj = await tx.billAdjustment.create({
      data: { orgId: ctx.orgId, billId, storeId: bill.storeId, type: input.type, amount: m2(effect), reason: input.reason, createdById: ctx.userId },
    });
    await postLedger(tx, {
      orgId: ctx.orgId,
      storeId: bill.storeId,
      entryDate: input.entryDate,
      entryType: "ADJUSTMENT",
      amount: effect,
      description: `${input.type.replace("_", " ").toLowerCase()} on bill #${bill.billNumber}: ${input.reason}`,
      createdById: ctx.userId,
      billId,
      adjustmentId: adj.id,
    });
    return { id: adj.id, type: adj.type, amount: m2(adj.amount), reason: adj.reason };
  });
}

// ----------------------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------------------

export async function getBill(ctx: BillCtx, id: string, opts: { includeMargins?: boolean } = {}) {
  const bill = await prisma.bill.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      store: { select: { id: true, shopName: true, city: true, phone: true, type: true, storeMark: true } },
      createdBy: { select: { id: true, displayName: true } },
      lastEditedBy: { select: { id: true, displayName: true } },
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { id: true, name: true, unitType: true } },
          weights: { orderBy: { seq: "asc" } },
          sourceLink: {
            include: {
              purchaseLine: {
                include: { bill: { select: { id: true, billNumber: true, billDate: true, status: true, store: { select: { shopName: true, city: true } } } } },
              },
            },
          },
          soldLinks: {
            include: {
              salesLine: {
                include: { bill: { select: { id: true, billNumber: true, billDate: true, status: true, store: { select: { shopName: true, city: true } } } } },
              },
            },
          },
        },
      },
      payments: { orderBy: { createdAt: "asc" }, include: { paymentMode: { select: { name: true, isDigital: true } } } },
      adjustments: { orderBy: { createdAt: "asc" } },
      discountRequests: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!bill) throw notFound("Bill");
  // Cashiers may only see sales bills.
  if (bill.type === "PURCHASE" && !hasPermission(ctx.role, "bill:create:purchase")) throw notFound("Bill");

  const showMargins = Boolean(opts.includeMargins) && hasPermission(ctx.role, "bill:margin:view");
  const type = bill.type as BillTypeT;
  const charge = billCharge(
    { todayBill: dec(bill.todayBill), coolieTotal: dec(bill.coolieTotal), lessAmount: dec(bill.lessAmount), bonusAmount: dec(bill.bonusAmount), commissionAmount: dec(bill.commissionAmount) },
    type,
  );
  const adjTotal = bill.adjustments.reduce((a, x) => a.plus(dec(x.amount)), dec(0));

  let settlement: { outstanding: string; status: string; settledDate: string | null } | null = null;
  if (bill.status === "POSTED") {
    const map = await billSettlementMap(ctx.orgId, { storeIds: [bill.storeId], defaultCreditDays: ctx.settings.defaultCreditDays });
    const s = map.get(bill.id);
    if (s) settlement = { outstanding: s.outstanding, status: s.status, settledDate: s.settledDate };
  }

  return {
    id: bill.id,
    type: bill.type,
    status: bill.status,
    source: bill.source,
    billNumber: bill.billNumber,
    billDate: fromDbDate(bill.billDate),
    dueDate: bill.dueDate ? fromDbDate(bill.dueDate) : null,
    store: { id: bill.store.id, label: storeLabel(bill.store), shopName: bill.store.shopName, city: bill.store.city, phone: bill.store.phone, storeMark: bill.store.storeMark },
    previousBalance: m2(bill.previousBalance),
    coolieTotal: m2(bill.coolieTotal),
    todayBill: m2(bill.todayBill),
    total: m2(bill.total),
    lessAmount: m2(bill.lessAmount),
    lessReason: bill.lessReason,
    bonusAmount: m2(bill.bonusAmount),
    bonusReason: bill.bonusReason,
    commissionPercent: bill.commissionPercent.toString(),
    commissionAmount: m2(bill.commissionAmount),
    amountSettled: m2(bill.amountSettled),
    totalBalance: m2(bill.totalBalance),
    invoiceAmount: m2(charge.plus(adjTotal)),
    settlement,
    notes: bill.notes,
    version: bill.version,
    createdBy: { id: bill.createdBy.id, name: bill.createdBy.displayName },
    lastEditedBy: { id: bill.lastEditedBy.id, name: bill.lastEditedBy.displayName },
    postedAt: bill.postedAt,
    cancelledAt: bill.cancelledAt,
    cancelReason: bill.cancelReason,
    marginsIncluded: showMargins,
    lines: bill.lines.map((l) => {
      const src = l.sourceLink;
      const margin = showMargins && src ? calcMargin(l.rate.toString(), src.purchaseLine.rate.toString(), l.quantity.toString()) : null;
      return {
        id: l.id,
        lineNo: l.lineNo,
        item: l.item,
        entryMode: l.entryMode,
        lineMark: l.lineMark,
        bagCount: l.bagCount,
        quantity: q3(l.quantity),
        rate: m2(l.rate),
        amount: m2(l.amount),
        coolieRate: m2(l.coolieRate),
        coolieAmount: m2(l.coolieAmount),
        weights: l.weights.map((w) => q3(w.weightKg)),
        source: src
          ? {
              purchaseLineId: src.purchaseLineId,
              purchaseBillId: src.purchaseLine.bill.id,
              purchaseBillNumber: src.purchaseLine.bill.billNumber,
              supplier: storeLabel(src.purchaseLine.bill.store),
              purchaseDate: fromDbDate(src.purchaseLine.bill.billDate),
              purchaseQuantity: q3(src.purchaseLine.quantity),
              ...(showMargins ? { purchaseRate: m2(src.purchaseLine.rate) } : {}),
              oversold: src.oversold,
            }
          : null,
        soldLinks: l.soldLinks.map((k) => ({
          salesLineId: k.salesLineId,
          salesBillId: k.salesLine.bill.id,
          salesBillNumber: k.salesLine.bill.billNumber,
          salesBillStatus: k.salesLine.bill.status,
          customer: storeLabel(k.salesLine.bill.store),
          saleDate: fromDbDate(k.salesLine.bill.billDate),
          quantity: q3(k.quantity),
          ...(showMargins ? { salesRate: m2(k.salesLine.rate) } : {}),
          oversold: k.oversold,
        })),
        margin: margin ? { unitMargin: m2(margin.unitMargin), grossMargin: m2(margin.grossMargin) } : null,
      };
    }),
    payments: bill.payments.map((p) => ({
      id: p.id,
      amount: m2(p.amount),
      paymentDate: fromDbDate(p.paymentDate),
      mode: p.paymentMode.name,
      status: p.status,
    })),
    adjustments: bill.adjustments.map((a) => ({ id: a.id, type: a.type, amount: m2(a.amount), reason: a.reason, createdAt: a.createdAt })),
    discount: bill.discountRequests[0] ? { id: bill.discountRequests[0].id, status: bill.discountRequests[0].status } : null,
  };
}

export type BillDto = Awaited<ReturnType<typeof getBill>>;

export async function listBills(
  ctx: BillCtx,
  f: { type?: BillTypeT; status?: "DRAFT" | "POSTED" | "CANCELLED"; storeId?: string; from?: string; to?: string; q?: string; limit?: number },
) {
  const canPurchase = hasPermission(ctx.role, "bill:create:purchase");
  if (f.type === "PURCHASE" && !canPurchase) throw forbidden();
  const num = f.q && /^\d+$/.test(f.q.trim()) ? Number(f.q.trim()) : null;
  const rows = await prisma.bill.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.type ? { type: f.type } : canPurchase ? {} : { type: "SALES" }),
      ...(f.status ? { status: f.status } : {}),
      ...(f.storeId ? { storeId: f.storeId } : {}),
      ...(f.from || f.to ? { billDate: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } } : {}),
      ...(num ? { billNumber: num } : f.q ? { store: { shopName: { contains: f.q.trim(), mode: "insensitive" as const } } } : {}),
    },
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(f.limit ?? 100, 500),
    include: { store: { select: { shopName: true, city: true } }, createdBy: { select: { displayName: true } }, discountRequests: { where: { status: { in: ["LISTED", "BID_ACCEPTED", "FUNDED", "DEFAULTED"] } }, select: { status: true } } },
  });
  const storeIds = [...new Set(rows.filter((r) => r.status === "POSTED").map((r) => r.storeId))];
  const settle = storeIds.length ? await billSettlementMap(ctx.orgId, { storeIds, defaultCreditDays: ctx.settings.defaultCreditDays }) : new Map();
  return rows.map((b) => {
    const s = settle.get(b.id);
    return {
      id: b.id,
      type: b.type,
      status: b.status,
      billNumber: b.billNumber,
      billDate: fromDbDate(b.billDate),
      dueDate: b.dueDate ? fromDbDate(b.dueDate) : null,
      storeId: b.storeId,
      party: storeLabel(b.store),
      todayBill: m2(b.todayBill),
      coolieTotal: m2(b.coolieTotal),
      totalBalance: m2(b.totalBalance),
      invoiceAmount: s?.amount ?? m2(billCharge({ todayBill: dec(b.todayBill), coolieTotal: dec(b.coolieTotal), lessAmount: dec(b.lessAmount), bonusAmount: dec(b.bonusAmount), commissionAmount: dec(b.commissionAmount) }, b.type)),
      outstanding: s?.outstanding ?? null,
      paymentStatus: b.status === "POSTED" ? (s?.status ?? "PAID") : null,
      createdBy: b.createdBy.displayName,
      financing: b.discountRequests[0]?.status ?? null,
      version: b.version,
    };
  });
}

/** Purchase lines of an item that still have stock to link a sale to (newest first). */
export async function linkablePurchaseLines(ctx: BillCtx, itemId: string) {
  if (!hasPermission(ctx.role, "bill:create:sales")) throw forbidden();
  const lines = await prisma.billLine.findMany({
    where: { orgId: ctx.orgId, itemId, bill: { type: "PURCHASE", status: "POSTED" } },
    include: { bill: { select: { id: true, billNumber: true, billDate: true, store: { select: { shopName: true, city: true } } } } },
    orderBy: [{ bill: { billDate: "desc" } }],
    take: 50,
  });
  const showRate = hasPermission(ctx.role, "bill:margin:view");
  const out = [];
  for (const l of lines) {
    const remaining = await purchaseLineRemaining(prisma, l.id);
    out.push({
      purchaseLineId: l.id,
      purchaseBillNumber: l.bill.billNumber,
      purchaseDate: fromDbDate(l.bill.billDate),
      supplier: storeLabel(l.bill.store),
      lineMark: l.lineMark,
      quantity: q3(l.quantity),
      remaining: q3(remaining),
      ...(showRate ? { rate: m2(l.rate) } : {}),
    });
  }
  return out.filter((l) => dec(l.remaining).gt(0));
}
