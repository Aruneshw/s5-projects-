// src/server/services/inventory.ts
// Stock = SUM(InventoryMovement.quantity). Sign convention: + IN (purchases), − OUT (sales).
// Cancellations add equal-and-opposite CANCEL_REVERSAL movements; manual corrections are
// ADJUSTMENT movements with a mandatory reason. Nothing is ever updated or deleted.
import "server-only";
import { prisma } from "../db";
import { withActorTx } from "../tx";
import { notFound } from "../errors";
import { dec, q3 } from "@/lib/money";
import { daysBetween, fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { StockAdjustmentSchema } from "@/lib/validation/schemas";

type Ctx = Pick<SessionContext, "orgId" | "userId" | "settings">;
type ReadCtx = Pick<SessionContext, "orgId" | "settings">;

const UNIT_LABEL = { KG: "kg", BAG: "bags", BOX: "boxes" } as const;

export async function stockSummary(ctx: ReadCtx, asOf: string = todayIST()) {
  const items = await prisma.item.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" } });
  const sums = await prisma.inventoryMovement.groupBy({
    by: ["itemId"],
    where: { orgId: ctx.orgId, movementDate: { lte: toDbDate(asOf) } },
    _sum: { quantity: true, bagCount: true },
  });
  const lastIn = await prisma.inventoryMovement.groupBy({
    by: ["itemId"],
    where: { orgId: ctx.orgId, type: "PURCHASE", movementDate: { lte: toDbDate(asOf) } },
    _max: { movementDate: true },
  });
  const oversold = await prisma.purchaseSaleLink.findMany({
    where: { orgId: ctx.orgId, oversold: true, salesLine: { bill: { status: "POSTED" } } },
    select: { salesLine: { select: { itemId: true } } },
  });
  const oversoldItems = new Set(oversold.map((o) => o.salesLine.itemId));
  const sumBy = new Map(sums.map((s) => [s.itemId, s]));
  const lastBy = new Map(lastIn.map((s) => [s.itemId, s._max.movementDate]));

  return items
    .map((i) => {
      const s = sumBy.get(i.id);
      const quantity = dec(s?._sum.quantity ?? 0);
      const last = lastBy.get(i.id);
      const lastPurchaseDate = last ? fromDbDate(last) : null;
      const ageDays = lastPurchaseDate ? daysBetween(lastPurchaseDate, asOf) : null;
      return {
        itemId: i.id,
        name: i.name,
        unitType: i.unitType,
        unit: UNIT_LABEL[i.unitType],
        isActive: i.isActive,
        quantity: q3(quantity),
        bagCount: s?._sum.bagCount ?? 0,
        lastPurchaseDate,
        ageDays,
        stale: quantity.gt(0) && ageDays !== null && ageDays >= ctx.settings.staleStockDays,
        negative: quantity.isNegative(),
        oversoldFlag: oversoldItems.has(i.id),
      };
    })
    .filter((r) => r.isActive || !dec(r.quantity).isZero());
}

/** Opening / in / out / closing per item for a date range. */
export async function stockForRange(ctx: ReadCtx, from: string, to: string) {
  const rows = await prisma.$queryRaw<
    Array<{ itemId: string; name: string; unitType: "KG" | "BAG" | "BOX"; opening: string; inQty: string; outQty: string; closing: string }>
  >`
    SELECT i."id" AS "itemId", i."name", i."unitType",
      COALESCE(SUM(m."quantity") FILTER (WHERE m."movementDate" < ${toDbDate(from)}::date), 0)::text AS opening,
      COALESCE(SUM(m."quantity") FILTER (WHERE m."movementDate" BETWEEN ${toDbDate(from)}::date AND ${toDbDate(to)}::date AND m."quantity" > 0), 0)::text AS "inQty",
      COALESCE(-SUM(m."quantity") FILTER (WHERE m."movementDate" BETWEEN ${toDbDate(from)}::date AND ${toDbDate(to)}::date AND m."quantity" < 0), 0)::text AS "outQty",
      COALESCE(SUM(m."quantity") FILTER (WHERE m."movementDate" <= ${toDbDate(to)}::date), 0)::text AS closing
    FROM "items" i LEFT JOIN "inventory_movements" m ON m."itemId" = i."id"
    WHERE i."orgId" = ${ctx.orgId}::uuid
    GROUP BY i."id" ORDER BY i."name"`;
  return rows.map((r) => ({ ...r, unit: UNIT_LABEL[r.unitType], opening: q3(r.opening), inQty: q3(r.inQty), outQty: q3(r.outQty), closing: q3(r.closing) }));
}

export async function itemMovements(ctx: ReadCtx, itemId: string, range: { from?: string; to?: string } = {}) {
  const item = await prisma.item.findFirst({ where: { id: itemId, orgId: ctx.orgId } });
  if (!item) throw notFound("Item");
  const rows = await prisma.inventoryMovement.findMany({
    where: {
      orgId: ctx.orgId,
      itemId,
      ...(range.from || range.to ? { movementDate: { ...(range.from ? { gte: toDbDate(range.from) } : {}), ...(range.to ? { lte: toDbDate(range.to) } : {}) } } : {}),
    },
    orderBy: [{ movementDate: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { billLine: { select: { bill: { select: { id: true, billNumber: true, type: true } } } } },
  });
  return {
    item: { id: item.id, name: item.name, unit: UNIT_LABEL[item.unitType] },
    movements: rows.map((m) => ({
      id: m.id,
      date: fromDbDate(m.movementDate),
      type: m.type,
      quantity: q3(m.quantity),
      bagCount: m.bagCount,
      note: m.note,
      billId: m.billLine?.bill.id ?? null,
      billNumber: m.billLine?.bill.billNumber ?? null,
      billType: m.billLine?.bill.type ?? null,
    })),
  };
}

export async function adjustStock(ctx: Ctx, raw: z.input<typeof StockAdjustmentSchema>) {
  const input = StockAdjustmentSchema.parse(raw);
  const item = await prisma.item.findFirst({ where: { id: input.itemId, orgId: ctx.orgId } });
  if (!item) throw notFound("Item");
  const m = await withActorTx(ctx, (tx) =>
    tx.inventoryMovement.create({
      data: {
        orgId: ctx.orgId,
        itemId: item.id,
        movementDate: toDbDate(input.movementDate),
        type: "ADJUSTMENT",
        quantity: q3(input.quantity),
        bagCount: input.bagCount,
        note: input.reason,
        createdById: ctx.userId,
      },
    }),
  );
  return { id: m.id, quantity: q3(m.quantity) };
}

/** Reconciliation history: manual adjustments + oversold links needing review. */
export async function reconciliationHistory(ctx: ReadCtx) {
  const [adjustments, oversold] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where: { orgId: ctx.orgId, type: "ADJUSTMENT" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { item: { select: { name: true, unitType: true } } },
    }),
    prisma.purchaseSaleLink.findMany({
      where: { orgId: ctx.orgId, oversold: true },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        salesLine: { include: { item: { select: { name: true } }, bill: { select: { id: true, billNumber: true, status: true } } } },
        purchaseLine: { include: { bill: { select: { id: true, billNumber: true } } } },
      },
    }),
  ]);
  return {
    adjustments: adjustments.map((a) => ({ id: a.id, date: fromDbDate(a.movementDate), item: a.item.name, unit: UNIT_LABEL[a.item.unitType], quantity: q3(a.quantity), reason: a.note })),
    oversold: oversold.map((o) => ({
      id: o.id,
      item: o.salesLine.item.name,
      quantity: q3(o.quantity),
      salesBillId: o.salesLine.bill.id,
      salesBillNumber: o.salesLine.bill.billNumber,
      salesBillStatus: o.salesLine.bill.status,
      purchaseBillId: o.purchaseLine.bill.id,
      purchaseBillNumber: o.purchaseLine.bill.billNumber,
      approvedById: o.approvedById,
    })),
  };
}
