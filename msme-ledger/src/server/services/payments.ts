// src/server/services/payments.ts
// Payments are recorded independently of bills, can be partial, and many can apply to one bill.
// Idempotency: (orgId, idempotencyKey) is UNIQUE in the database. Resubmitting the same key
// (double tap, network retry, offline sync replay) returns the original payment.
import "server-only";
import { prisma } from "../db";
import { withActorTx, lockStore } from "../tx";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { postLedger, reverseEntries } from "./ledger";
import { storeLabel } from "./stores";
import { dec, m2 } from "@/lib/money";
import { fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import { hasPermission } from "../authorization/permissions";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { PaymentInputSchema } from "@/lib/validation/schemas";

type Ctx = Pick<SessionContext, "orgId" | "userId" | "role">;

async function toDto(id: string, orgId: string) {
  const p = await prisma.payment.findFirstOrThrow({
    where: { id, orgId },
    include: {
      store: { select: { shopName: true, city: true, type: true } },
      paymentMode: { select: { name: true, isDigital: true } },
      bill: { select: { billNumber: true, type: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  return {
    id: p.id,
    storeId: p.storeId,
    party: storeLabel(p.store),
    partyType: p.store.type,
    direction: p.direction,
    amount: m2(p.amount),
    paymentDate: fromDbDate(p.paymentDate),
    mode: p.paymentMode.name,
    isDigital: p.paymentMode.isDigital,
    billId: p.billId,
    billNumber: p.bill?.billNumber ?? null,
    reference: p.reference,
    notes: p.notes,
    status: p.status,
    cancelReason: p.cancelReason,
    createdBy: p.createdBy.displayName,
    createdAt: p.createdAt,
  };
}

export type PaymentDto = Awaited<ReturnType<typeof toDto>>;

export async function createPayment(ctx: Ctx, raw: z.input<typeof PaymentInputSchema>): Promise<{ payment: PaymentDto; duplicate: boolean }> {
  const input = PaymentInputSchema.parse(raw);
  const dup = await prisma.payment.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } } });
  if (dup) return { payment: await toDto(dup.id, ctx.orgId), duplicate: true };

  const store = await prisma.store.findFirst({ where: { id: input.storeId, orgId: ctx.orgId } });
  if (!store) throw notFound("Store");
  // Supplier payments require purchase rights (cashiers only record customer receipts).
  if (store.type === "SUPPLIER" && !hasPermission(ctx.role, "bill:create:purchase")) throw forbidden("You cannot record supplier payments");
  const mode = await prisma.paymentMode.findFirst({ where: { id: input.paymentModeId, orgId: ctx.orgId, isActive: true } });
  if (!mode) throw invalid("Payment mode not found");
  if (input.billId) {
    const bill = await prisma.bill.findFirst({ where: { id: input.billId, orgId: ctx.orgId } });
    if (!bill || bill.storeId !== store.id) throw invalid("That bill does not belong to this store");
    if (bill.status !== "POSTED") throw invalid("Payments can only be linked to posted bills");
  }
  const direction = store.type === "CUSTOMER" ? "RECEIVED" : "PAID";

  try {
    const id = await withActorTx(ctx, async (tx) => {
      await lockStore(tx, store.id);
      const p = await tx.payment.create({
        data: {
          orgId: ctx.orgId,
          storeId: store.id,
          billId: input.billId ?? null,
          direction,
          paymentModeId: mode.id,
          amount: m2(input.amount),
          paymentDate: toDbDate(input.paymentDate),
          reference: input.reference,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: ctx.userId,
        },
      });
      await postLedger(tx, {
        orgId: ctx.orgId,
        storeId: store.id,
        entryDate: input.paymentDate,
        entryType: "PAYMENT",
        amount: dec(input.amount).negated(),
        description: `${direction === "RECEIVED" ? "Received from" : "Paid to"} ${store.shopName} (${mode.name})${input.reference ? ` ref ${input.reference}` : ""}`,
        createdById: ctx.userId,
        billId: input.billId ?? null,
        paymentId: p.id,
      });
      return p.id;
    });
    return { payment: await toDto(id, ctx.orgId), duplicate: false };
  } catch (e) {
    // Two identical requests raced: the unique index let exactly one win. Return it.
    const again = await prisma.payment.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } } });
    if (again) return { payment: await toDto(again.id, ctx.orgId), duplicate: true };
    throw e;
  }
}

export async function cancelPayment(ctx: Ctx, id: string, reason: string) {
  const p = await prisma.payment.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!p) throw notFound("Payment");
  if (p.status === "CANCELLED") throw conflict("Payment is already cancelled");
  const active = p.billId
    ? await prisma.discountRequest.count({ where: { billId: p.billId, status: { in: ["FUNDED", "DEFAULTED"] } } })
    : 0;
  if (active > 0) throw conflict("This payment is part of a financed invoice; record a financing settlement instead");
  await withActorTx(ctx, async (tx) => {
    await lockStore(tx, p.storeId);
    await reverseEntries(tx, ctx.orgId, { paymentId: id }, todayIST(), ctx.userId, `payment cancelled — ${reason}`);
    const upd = await tx.payment.updateMany({
      where: { id, status: "ACTIVE" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason },
    });
    if (upd.count === 0) throw conflict("Payment was cancelled concurrently");
  });
  return toDto(id, ctx.orgId);
}

export async function listPayments(
  ctx: Ctx,
  f: { storeId?: string; from?: string; to?: string; direction?: "RECEIVED" | "PAID"; limit?: number },
) {
  const canSupplier = hasPermission(ctx.role, "bill:create:purchase");
  const rows = await prisma.payment.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.storeId ? { storeId: f.storeId } : {}),
      ...(f.direction ? { direction: f.direction } : {}),
      ...(canSupplier ? {} : { direction: "RECEIVED" as const }),
      ...(f.from || f.to ? { paymentDate: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } } : {}),
    },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: Math.min(f.limit ?? 100, 500),
    select: { id: true },
  });
  return Promise.all(rows.map((r) => toDto(r.id, ctx.orgId)));
}

export async function listPaymentModes(ctx: Pick<SessionContext, "orgId">) {
  return prisma.paymentMode.findMany({ where: { orgId: ctx.orgId, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, isDigital: true } });
}

export async function createPaymentMode(ctx: Pick<SessionContext, "orgId" | "userId">, input: { name: string; isDigital: boolean }) {
  const dup = await prisma.paymentMode.findFirst({ where: { orgId: ctx.orgId, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) throw conflict("A payment mode with that name exists");
  return withActorTx(ctx, (tx) => tx.paymentMode.create({ data: { orgId: ctx.orgId, name: input.name, isDigital: input.isDigital }, select: { id: true, name: true, isDigital: true } }));
}
