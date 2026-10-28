// src/server/services/stores.ts
import "server-only";
import { prisma } from "../db";
import { withActorTx, lockStore } from "../tx";
import { conflict, invalid, notFound } from "../errors";
import { postLedger } from "./ledger";
import { dec, m2 } from "@/lib/money";
import { todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { BalanceAdjustmentSchema, StoreBankSchema, StoreCreateSchema, StoreUpdateSchema } from "@/lib/validation/schemas";

/**
 * Public projection of a store. `openingBalance` is DELIBERATELY excluded: after creation
 * the opening balance is never returned by the API (it lives on in the ledger).
 */
export const storePublicSelect = {
  id: true,
  type: true,
  shopName: true,
  city: true,
  location: true,
  ownerName: true,
  coOwnerName: true,
  contactName: true,
  phone: true,
  address: true,
  upiId: true,
  storeMark: true,
  isActive: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function storeLabel(s: { shopName: string; city: string }): string {
  return `${s.shopName} — ${s.city}`;
}

export async function listStores(
  ctx: Pick<SessionContext, "orgId">,
  opts: { type?: "SUPPLIER" | "CUSTOMER"; q?: string; includeInactive?: boolean } = {},
) {
  const q = opts.q?.trim();
  const rows = await prisma.store.findMany({
    where: {
      orgId: ctx.orgId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(q
        ? {
            OR: [
              { shopName: { contains: q, mode: "insensitive" as const } },
              { city: { contains: q, mode: "insensitive" as const } },
              { storeMark: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    select: storePublicSelect,
    orderBy: [{ shopName: "asc" }, { city: "asc" }],
    take: 200,
  });
  return rows.map((s) => ({ ...s, label: storeLabel(s) }));
}

export async function getStore(ctx: Pick<SessionContext, "orgId">, id: string) {
  const s = await prisma.store.findFirst({ where: { id, orgId: ctx.orgId }, select: storePublicSelect });
  if (!s) throw notFound("Store");
  return { ...s, label: storeLabel(s) };
}

export async function createStore(ctx: Pick<SessionContext, "orgId" | "userId">, raw: z.input<typeof StoreCreateSchema>) {
  const input = StoreCreateSchema.parse(raw);
  const exists = await prisma.store.findFirst({
    where: { orgId: ctx.orgId, type: input.type, shopName: input.shopName, city: input.city },
    select: { id: true },
  });
  if (exists) throw conflict(`A ${input.type.toLowerCase()} named "${input.shopName}" in ${input.city} already exists`);

  const opening = dec(input.openingBalance);
  return withActorTx(ctx, async (tx) => {
    const store = await tx.store.create({
      data: {
        orgId: ctx.orgId,
        type: input.type,
        shopName: input.shopName,
        city: input.city,
        location: input.location,
        ownerName: input.ownerName,
        coOwnerName: input.coOwnerName,
        contactName: input.contactName,
        phone: input.phone ?? null,
        address: input.address,
        upiId: input.upiId ?? null,
        storeMark: input.storeMark,
        openingBalance: m2(opening),
        createdById: ctx.userId,
      },
      select: storePublicSelect,
    });
    if (!opening.isZero()) {
      await postLedger(tx, {
        orgId: ctx.orgId,
        storeId: store.id,
        entryDate: todayIST(),
        entryType: "OPENING",
        amount: opening,
        description: "Opening balance (entered at store creation)",
        createdById: ctx.userId,
      });
    }
    return { ...store, label: storeLabel(store) };
  });
}

export async function updateStore(
  ctx: Pick<SessionContext, "orgId" | "userId">,
  id: string,
  raw: z.input<typeof StoreUpdateSchema>,
) {
  const { version, ...data } = StoreUpdateSchema.parse(raw);
  return withActorTx(ctx, async (tx) => {
    const res = await tx.store.updateMany({
      where: { id, orgId: ctx.orgId, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count === 0) {
      const exists = await tx.store.findFirst({ where: { id, orgId: ctx.orgId }, select: { version: true } });
      if (!exists) throw notFound("Store");
      throw conflict("This store was changed on another device. Reload and try again.", { currentVersion: exists.version });
    }
    const s = await tx.store.findFirstOrThrow({ where: { id, orgId: ctx.orgId }, select: storePublicSelect });
    return { ...s, label: storeLabel(s) };
  });
}

export async function getBankDetail(ctx: Pick<SessionContext, "orgId">, storeId: string) {
  await getStore(ctx, storeId);
  const b = await prisma.storeBankDetail.findUnique({ where: { storeId } });
  if (!b) return null;
  return { ...b, accountNumberMasked: `XXXX${b.accountNumber.slice(-4)}` };
}

export async function setBankDetail(ctx: Pick<SessionContext, "orgId" | "userId">, storeId: string, raw: z.input<typeof StoreBankSchema>) {
  const input = StoreBankSchema.parse(raw);
  await getStore(ctx, storeId);
  return withActorTx(ctx, (tx) =>
    tx.storeBankDetail.upsert({
      where: { storeId },
      create: { storeId, ...input },
      update: input,
      select: { id: true, accountName: true, ifsc: true, bankName: true, updatedAt: true },
    }),
  );
}

/**
 * Authorised, audited balance correction (incl. opening balance corrections). The original
 * opening balance is never modified; a new adjustment + ledger entry records the change.
 */
export async function adjustStoreBalance(
  ctx: Pick<SessionContext, "orgId" | "userId">,
  storeId: string,
  raw: z.input<typeof BalanceAdjustmentSchema>,
) {
  const input = BalanceAdjustmentSchema.parse(raw);
  await getStore(ctx, storeId);
  if (input.reason.trim().length < 5) throw invalid("A reason is required");
  return withActorTx(ctx, async (tx) => {
    await lockStore(tx, storeId);
    const adj = await tx.billAdjustment.create({
      data: { orgId: ctx.orgId, storeId, type: input.type, amount: m2(input.amount), reason: input.reason, createdById: ctx.userId },
    });
    await postLedger(tx, {
      orgId: ctx.orgId,
      storeId,
      entryDate: input.entryDate,
      entryType: "ADJUSTMENT",
      amount: input.amount,
      description: `${input.type === "OPENING_BALANCE_CORRECTION" ? "Opening balance correction" : "Balance correction"}: ${input.reason}`,
      createdById: ctx.userId,
      adjustmentId: adj.id,
    });
    return { id: adj.id, type: adj.type, amount: m2(adj.amount), reason: adj.reason, createdAt: adj.createdAt };
  });
}
