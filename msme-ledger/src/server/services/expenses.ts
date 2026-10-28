// src/server/services/expenses.ts
// Expenses and worker salaries are stored separately (salaries are NOT coolie and NOT general expenses).
import "server-only";
import { prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, invalid, notFound } from "../errors";
import { m2 } from "@/lib/money";
import { fromDbDate, toDbDate } from "@/lib/dates";
import type { SessionContext } from "../auth/session";
import type { z } from "zod";
import { ExpenseInputSchema, SalaryInputSchema, WorkerInputSchema } from "@/lib/validation/schemas";

type Ctx = Pick<SessionContext, "orgId" | "userId">;

async function checkMode(orgId: string, id?: string | null) {
  if (!id) return null;
  const m = await prisma.paymentMode.findFirst({ where: { id, orgId, isActive: true } });
  if (!m) throw invalid("Payment mode not found");
  return m.id;
}

function expenseDto(e: {
  id: string;
  expenseDate: Date;
  category: string;
  amount: { toString(): string };
  notes: string | null;
  status: string;
  paymentMode: { name: string } | null;
  createdById: string;
}) {
  return { id: e.id, expenseDate: fromDbDate(e.expenseDate), category: e.category, amount: m2(e.amount), notes: e.notes, status: e.status, mode: e.paymentMode?.name ?? null, createdById: e.createdById };
}

export async function createExpense(ctx: Ctx, raw: z.input<typeof ExpenseInputSchema>) {
  const input = ExpenseInputSchema.parse(raw);
  const dup = await prisma.expense.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } }, include: { paymentMode: true } });
  if (dup) return { expense: expenseDto(dup), duplicate: true };
  const modeId = await checkMode(ctx.orgId, input.paymentModeId);
  try {
    const e = await withActorTx(ctx, (tx) =>
      tx.expense.create({
        data: {
          orgId: ctx.orgId,
          expenseDate: toDbDate(input.expenseDate),
          category: input.category,
          amount: m2(input.amount),
          notes: input.notes,
          paymentModeId: modeId,
          idempotencyKey: input.idempotencyKey,
          createdById: ctx.userId,
        },
        include: { paymentMode: true },
      }),
    );
    return { expense: expenseDto(e), duplicate: false };
  } catch (err) {
    const again = await prisma.expense.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } }, include: { paymentMode: true } });
    if (again) return { expense: expenseDto(again), duplicate: true };
    throw err;
  }
}

export async function cancelExpense(ctx: Ctx, id: string) {
  const e = await prisma.expense.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!e) throw notFound("Expense");
  if (e.status === "CANCELLED") throw conflict("Already cancelled");
  await withActorTx(ctx, (tx) => tx.expense.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.userId } }));
  return { id, status: "CANCELLED" };
}

export async function listExpenses(ctx: Ctx, f: { from?: string; to?: string; mineOnly?: boolean }) {
  const rows = await prisma.expense.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.mineOnly ? { createdById: ctx.userId } : {}),
      ...(f.from || f.to ? { expenseDate: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } } : {}),
    },
    include: { paymentMode: true },
    orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return rows.map(expenseDto);
}

export async function listWorkers(ctx: Pick<SessionContext, "orgId">) {
  return prisma.worker.findMany({ where: { orgId: ctx.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, isActive: true } });
}

export async function createWorker(ctx: Ctx, raw: z.input<typeof WorkerInputSchema>) {
  const input = WorkerInputSchema.parse(raw);
  const dup = await prisma.worker.findFirst({ where: { orgId: ctx.orgId, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) throw conflict("A worker with this name exists");
  return withActorTx(ctx, (tx) =>
    tx.worker.create({ data: { orgId: ctx.orgId, name: input.name, phone: input.phone }, select: { id: true, name: true, phone: true, isActive: true } }),
  );
}

export async function createSalary(ctx: Ctx, raw: z.input<typeof SalaryInputSchema>) {
  const input = SalaryInputSchema.parse(raw);
  const dup = await prisma.workerSalary.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } } });
  if (dup) return { id: dup.id, duplicate: true };
  const worker = await prisma.worker.findFirst({ where: { id: input.workerId, orgId: ctx.orgId } });
  if (!worker) throw notFound("Worker");
  if (input.periodFrom && input.periodTo && input.periodFrom > input.periodTo) throw invalid("Period start must be before end");
  const modeId = await checkMode(ctx.orgId, input.paymentModeId);
  try {
    const s = await withActorTx(ctx, (tx) =>
      tx.workerSalary.create({
        data: {
          orgId: ctx.orgId,
          workerId: worker.id,
          paymentDate: toDbDate(input.paymentDate),
          periodFrom: input.periodFrom ? toDbDate(input.periodFrom) : null,
          periodTo: input.periodTo ? toDbDate(input.periodTo) : null,
          amount: m2(input.amount),
          paymentModeId: modeId,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: ctx.userId,
        },
      }),
    );
    return { id: s.id, duplicate: false };
  } catch (err) {
    const again = await prisma.workerSalary.findUnique({ where: { orgId_idempotencyKey: { orgId: ctx.orgId, idempotencyKey: input.idempotencyKey } } });
    if (again) return { id: again.id, duplicate: true };
    throw err;
  }
}

export async function cancelSalary(ctx: Ctx, id: string) {
  const s = await prisma.workerSalary.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!s) throw notFound("Salary payment");
  if (s.status === "CANCELLED") throw conflict("Already cancelled");
  await withActorTx(ctx, (tx) => tx.workerSalary.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: ctx.userId } }));
  return { id, status: "CANCELLED" };
}

export async function listSalaries(ctx: Ctx, f: { from?: string; to?: string; workerId?: string }) {
  const rows = await prisma.workerSalary.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.workerId ? { workerId: f.workerId } : {}),
      ...(f.from || f.to ? { paymentDate: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } } : {}),
    },
    include: { worker: { select: { name: true } }, paymentMode: { select: { name: true } } },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return rows.map((s) => ({
    id: s.id,
    worker: s.worker.name,
    workerId: s.workerId,
    paymentDate: fromDbDate(s.paymentDate),
    periodFrom: s.periodFrom ? fromDbDate(s.periodFrom) : null,
    periodTo: s.periodTo ? fromDbDate(s.periodTo) : null,
    amount: m2(s.amount),
    mode: s.paymentMode?.name ?? null,
    notes: s.notes,
    status: s.status,
  }));
}
