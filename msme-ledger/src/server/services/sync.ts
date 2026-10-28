// src/server/services/sync.ts
// Offline synchronisation.
//
// PUSH: devices send queued mutations, each with a client-generated UUID. The server:
//   * replays the stored result if that UUID was already processed (idempotent retries),
//   * validates every mutation exactly like a live request (server-authoritative totals),
//   * records CONFLICT / REJECTED outcomes instead of discarding anything. The device keeps
//     its local copy until the user resolves it; the server record is never overwritten.
// PULL: the cursor is audit_logs.id (BIGSERIAL, monotonic). Every change to synced tables
//   writes an audit row via trigger, so "changes since cursor" is exact and gap-free.
import "server-only";
import { z } from "zod";
import { prisma, Prisma } from "../db";
import { AppError, conflict, notFound } from "../errors";
import { createBill, getBill, listBills, updateDraft, type BillCtx } from "./bills";
import { createPayment, listPaymentModes } from "./payments";
import { createExpense } from "./expenses";
import { listStores, storePublicSelect, storeLabel } from "./stores";
import { listItems } from "./items";
import { BillDraftUpdateSchema, BillInputSchema, ExpenseInputSchema, PaymentInputSchema } from "@/lib/validation/schemas";
import { hasPermission } from "../authorization/permissions";
import { addDays, todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";

export const MutationSchema = z.object({
  id: z.uuid(),
  type: z.enum(["BILL_CREATE", "BILL_DRAFT_UPDATE", "PAYMENT_CREATE", "EXPENSE_CREATE"]),
  payload: z.unknown(),
  clientCreatedAt: z.string().max(40).optional(),
});
export const PushSchema = z.object({ deviceId: z.string().min(4).max(100), mutations: z.array(MutationSchema).max(100) });

export type MutationOutcome =
  | { id: string; status: "APPLIED"; result: unknown; replayed: boolean }
  | { id: string; status: "CONFLICT" | "REJECTED"; error: { code: string; message: string; details?: unknown }; serverRecord?: unknown; replayed: boolean }
  | { id: string; status: "RETRY"; error: { code: string; message: string } };

type Ctx = SessionContext;

async function apply(ctx: Ctx, m: z.infer<typeof MutationSchema>): Promise<unknown> {
  const billCtx: BillCtx = ctx;
  switch (m.type) {
    case "BILL_CREATE": {
      const input = BillInputSchema.parse(m.payload);
      if (!input.id) throw new AppError("VALIDATION", "Offline bills must carry a client id");
      const r = await createBill(billCtx, input, { source: "OFFLINE_SYNC" });
      return { billId: r.bill.id, billNumber: r.bill.billNumber, status: r.bill.status, totalBalance: r.bill.totalBalance, warnings: r.warnings };
    }
    case "BILL_DRAFT_UPDATE": {
      const p = z.object({ billId: z.uuid() }).and(BillDraftUpdateSchema).parse(m.payload);
      const { billId, ...rest } = p;
      const r = await updateDraft(billCtx, billId, rest);
      return { billId: r.bill.id, billNumber: r.bill.billNumber, status: r.bill.status, version: r.bill.version, warnings: r.warnings };
    }
    case "PAYMENT_CREATE": {
      // The device's idempotency key (if it already tried online) wins; otherwise the mutation id.
      // Either way, retries can never create a second payment.
      const input = PaymentInputSchema.parse({ idempotencyKey: `sync:${m.id}`, ...(m.payload as object) });
      const r = await createPayment(ctx, input);
      return { paymentId: r.payment.id, duplicate: r.duplicate };
    }
    case "EXPENSE_CREATE": {
      if (!hasPermission(ctx.role, "expense:create")) throw new AppError("FORBIDDEN", "Not allowed");
      const input = ExpenseInputSchema.parse({ idempotencyKey: `sync:${m.id}`, ...(m.payload as object) });
      const r = await createExpense(ctx, input);
      return { expenseId: r.expense.id, duplicate: r.duplicate };
    }
  }
}

async function serverSnapshotFor(ctx: Ctx, m: z.infer<typeof MutationSchema>): Promise<unknown> {
  try {
    if (m.type === "BILL_DRAFT_UPDATE") {
      const billId = (m.payload as { billId?: string })?.billId;
      if (billId) return await getBill(ctx, billId);
    }
  } catch {
    return null;
  }
  return null;
}

export async function push(ctx: Ctx, input: z.infer<typeof PushSchema>): Promise<MutationOutcome[]> {
  const out: MutationOutcome[] = [];
  for (const m of input.mutations) {
    const prior = await prisma.syncMutation.findUnique({ where: { id: m.id } });
    if (prior) {
      if (prior.orgId !== ctx.orgId) {
        out.push({ id: m.id, status: "REJECTED", error: { code: "CONFLICT", message: "Mutation id already used" }, replayed: true });
        continue;
      }
      if (prior.status === "APPLIED") out.push({ id: m.id, status: "APPLIED", result: prior.result, replayed: true });
      else if (prior.status === "RESOLVED")
        out.push({ id: m.id, status: "REJECTED", error: { code: "RESOLVED", message: `Already reviewed (${prior.resolution ?? "resolved"})` }, replayed: true });
      else
        out.push({
          id: m.id,
          status: prior.status,
          error: (prior.result as { code: string; message: string }) ?? { code: "CONFLICT", message: "Conflict" },
          serverRecord: prior.conflictData,
          replayed: true,
        });
      continue;
    }

    let status: "APPLIED" | "CONFLICT" | "REJECTED";
    let result: unknown = null;
    let conflictData: unknown = null;
    try {
      result = await apply(ctx, m);
      status = "APPLIED";
    } catch (e) {
      const err = e instanceof AppError ? e : e instanceof z.ZodError ? new AppError("VALIDATION", "Invalid offline record", { issues: e.issues.map((i) => i.message) }) : null;
      if (!err || err.code === "INTERNAL" || err.code === "RATE_LIMITED") {
        // Transient: do NOT record; the device retries with backoff.
        out.push({ id: m.id, status: "RETRY", error: { code: "TRANSIENT", message: "Temporary server problem; will retry" } });
        if (!err) console.error("[sync] transient failure", e);
        continue;
      }
      status = err.code === "CONFLICT" ? "CONFLICT" : "REJECTED";
      result = { code: err.code, message: err.message, details: err.details ?? null };
      conflictData = status === "CONFLICT" ? await serverSnapshotFor(ctx, m) : null;
    }
    try {
      await prisma.syncMutation.create({
        data: {
          id: m.id,
          orgId: ctx.orgId,
          userId: ctx.userId,
          deviceId: input.deviceId,
          type: m.type,
          payload: (m.payload ?? {}) as Prisma.InputJsonValue,
          status,
          result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
          conflictData: (conflictData ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch {
      // Same mutation processed concurrently by another request: the business record itself
      // is protected by its own idempotency key, so just report what is stored.
    }
    if (status === "APPLIED") out.push({ id: m.id, status, result, replayed: false });
    else out.push({ id: m.id, status, error: result as { code: string; message: string }, serverRecord: conflictData ?? undefined, replayed: false });
  }
  return out;
}

const SYNCED_TABLES = ["bills", "payments", "stores", "items", "payment_modes"];

export async function pull(ctx: Ctx, cursorRaw: string | null) {
  const cursor = cursorRaw && /^\d+$/.test(cursorRaw) ? BigInt(cursorRaw) : 0n;
  const head = await prisma.auditLog.aggregate({ where: { orgId: ctx.orgId }, _max: { id: true } });
  const newCursor = (head._max.id ?? 0n).toString();
  const canPurchase = hasPermission(ctx.role, "bill:create:purchase");

  if (cursor === 0n) {
    const [stores, items, modes, bills] = await Promise.all([
      listStores(ctx, { includeInactive: true }),
      listItems(ctx, { includeInactive: true }),
      listPaymentModes(ctx),
      listBills(ctx, { from: addDays(todayIST(), -30), limit: 500 }),
    ]);
    return { full: true, cursor: newCursor, stores: canPurchase ? stores : stores.filter((s) => s.type === "CUSTOMER"), items, paymentModes: modes, bills };
  }

  const changes = await prisma.auditLog.findMany({
    where: { orgId: ctx.orgId, id: { gt: cursor }, entityType: { in: SYNCED_TABLES } },
    select: { entityType: true, entityId: true },
    orderBy: { id: "asc" },
    take: 2000,
  });
  const ids = (t: string) => [...new Set(changes.filter((c) => c.entityType === t).map((c) => c.entityId))];
  const storeIds = ids("stores");
  const billIds = ids("bills");
  const [stores, items, modes, billRows] = await Promise.all([
    storeIds.length ? prisma.store.findMany({ where: { orgId: ctx.orgId, id: { in: storeIds }, ...(canPurchase ? {} : { type: "CUSTOMER" as const }) }, select: storePublicSelect }) : [],
    ids("items").length ? listItems(ctx, { includeInactive: true }).then((all) => all.filter((i) => ids("items").includes(i.id))) : [],
    ids("payment_modes").length ? listPaymentModes(ctx) : [],
    billIds.length ? listBills(ctx, { limit: 500 }).then((all) => all.filter((b) => billIds.includes(b.id))) : [],
  ]);
  const truncated = changes.length === 2000;
  return {
    full: false,
    // If we hit the page size, hand back the last processed id so the client pulls again.
    cursor: truncated ? String(await lastId(ctx.orgId, cursor, 2000)) : newCursor,
    hasMore: truncated,
    stores: stores.map((s) => ({ ...s, label: storeLabel(s) })),
    items,
    paymentModes: modes,
    bills: billRows,
  };
}

async function lastId(orgId: string, cursor: bigint, take: number): Promise<bigint> {
  const rows = await prisma.auditLog.findMany({ where: { orgId, id: { gt: cursor }, entityType: { in: SYNCED_TABLES } }, select: { id: true }, orderBy: { id: "asc" }, take });
  return rows[rows.length - 1]?.id ?? cursor;
}

export async function listConflicts(ctx: Ctx) {
  const rows = await prisma.syncMutation.findMany({
    where: { orgId: ctx.orgId, status: { in: ["CONFLICT", "REJECTED"] }, ...(hasPermission(ctx.role, "team:manage") ? {} : { userId: ctx.userId }) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({ id: r.id, type: r.type, status: r.status, deviceId: r.deviceId, userId: r.userId, payload: r.payload, error: r.result, serverRecord: r.conflictData, createdAt: r.createdAt }));
}

/** Mark a conflict as reviewed. Never deletes server data; the local copy decision is the device's. */
export async function resolveConflict(ctx: Ctx, id: string, resolution: "DISCARDED_LOCAL" | "RESUBMITTED" | "KEPT_SERVER") {
  const m = await prisma.syncMutation.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!m) throw notFound("Sync record");
  if (m.status === "APPLIED" || m.status === "RESOLVED") throw conflict("Nothing to resolve");
  if (m.userId !== ctx.userId && !hasPermission(ctx.role, "team:manage")) throw notFound("Sync record");
  await prisma.syncMutation.update({ where: { id }, data: { status: "RESOLVED", resolution, resolvedById: ctx.userId, resolvedAt: new Date() } });
  return { id, status: "RESOLVED", resolution };
}
