// src/server/services/admin.ts
// Settings, financial years (year-end carry-forward), audit log and the dashboard summary.
import "server-only";
import { prisma, Prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, invalid, notFound } from "../errors";
import { balances, totals } from "./ledger";
import { currentTrust } from "./credit";
import { listBills } from "./bills";
import { stockSummary } from "./inventory";
import { balanceReport } from "./reports";
import { OrgSettingsSchema, type OrgSettings } from "@/lib/validation/settings";
import { dec, m2, sum } from "@/lib/money";
import { financialYearOf, fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import { hasPermission } from "../authorization/permissions";
import type { SessionContext } from "../auth/session";

export async function getSettings(ctx: Pick<SessionContext, "orgId" | "settings">) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true, shareCreditProfile: true, riskFlag: true } });
  return { orgName: org.name, shareCreditProfile: org.shareCreditProfile, riskFlag: org.riskFlag, settings: ctx.settings };
}

export async function updateSettings(ctx: Pick<SessionContext, "orgId" | "userId" | "settings">, patch: Partial<OrgSettings> & { orgName?: string }) {
  const { orgName, ...rest } = patch;
  const merged = OrgSettingsSchema.parse({ ...ctx.settings, ...rest, taxAssumptions: { ...ctx.settings.taxAssumptions, ...(rest.taxAssumptions ?? {}) } });
  const alloc = Object.values(merged.profitAllocation);
  if (alloc.length > 0 && Math.abs(alloc.reduce((a, b) => a + b, 0) - 100) > 0.001) throw invalid("Profit allocation percentages must add up to 100");
  if (merged.discountMinDaysToDue > merged.discountMaxDaysToDue) throw invalid("Minimum days to due must be ≤ maximum");
  await withActorTx(ctx, (tx) =>
    tx.organization.update({
      where: { id: ctx.orgId },
      data: { settings: merged as unknown as Prisma.InputJsonValue, ...(orgName ? { name: orgName.trim().slice(0, 120) } : {}) },
    }),
  );
  return merged;
}

export async function listFinancialYears(ctx: Pick<SessionContext, "orgId">) {
  const rows = await prisma.financialYear.findMany({ where: { orgId: ctx.orgId }, orderBy: { startDate: "desc" } });
  const current = financialYearOf(todayIST());
  const list = rows.map((r) => ({ id: r.id, label: r.label, startDate: fromDbDate(r.startDate), endDate: fromDbDate(r.endDate), isClosed: r.isClosed, closedAt: r.closedAt }));
  if (!list.some((r) => r.label === current.label)) list.unshift({ id: "", label: current.label, startDate: current.start, endDate: current.end, isClosed: false, closedAt: null });
  return list;
}

/**
 * Year-end close: stores a snapshot of every store's closing balance for reporting.
 * NO ledger entries are created — the ledger is continuous, so next year's opening balance
 * is simply the running balance. That is how duplicate opening entries are avoided.
 */
export async function closeFinancialYear(ctx: Pick<SessionContext, "orgId" | "userId">, label: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw invalid("Use a label like 2025-26");
  const start = `${m[1]}-04-01`;
  const end = `${Number(m[1]) + 1}-03-31`;
  if (end >= todayIST()) throw invalid("A financial year can only be closed after it ends");
  const existing = await prisma.financialYear.findUnique({ where: { orgId_label: { orgId: ctx.orgId, label } } });
  if (existing?.isClosed) throw conflict("Year already closed");
  const rows = await prisma.$queryRaw<Array<{ storeId: string; shopName: string; city: string; type: string; balance: string }>>`
    SELECT s."id" AS "storeId", s."shopName", s."city", s."type"::text AS "type", COALESCE(SUM(l."amount"), 0)::text AS balance
    FROM "stores" s LEFT JOIN "ledger_entries" l ON l."storeId" = s."id" AND l."entryDate" <= ${toDbDate(end)}::date
    WHERE s."orgId" = ${ctx.orgId}::uuid GROUP BY s."id"`;
  const snapshot = rows.map((r) => ({ ...r, balance: m2(r.balance) }));
  return withActorTx(ctx, (tx) =>
    tx.financialYear.upsert({
      where: { orgId_label: { orgId: ctx.orgId, label } },
      create: { orgId: ctx.orgId, label, startDate: toDbDate(start), endDate: toDbDate(end), isClosed: true, closedAt: new Date(), closedById: ctx.userId, closingSnapshot: snapshot as unknown as Prisma.InputJsonValue },
      update: { isClosed: true, closedAt: new Date(), closedById: ctx.userId, closingSnapshot: snapshot as unknown as Prisma.InputJsonValue },
      select: { id: true, label: true, isClosed: true },
    }),
  );
}

export async function listAudit(ctx: Pick<SessionContext, "orgId">, f: { entityType?: string; entityId?: string; before?: string; limit?: number }) {
  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: ctx.orgId,
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.before && /^\d+$/.test(f.before) ? { id: { lt: BigInt(f.before) } } : {}),
    },
    orderBy: { id: "desc" },
    take: Math.min(f.limit ?? 100, 300),
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((u) => [u.id, u.displayName]));
  return rows.map((r) => ({
    id: r.id.toString(),
    at: r.createdAt,
    actor: r.actorId ? (names.get(r.actorId) ?? (r.actorId.startsWith("00000000") ? "System" : r.actorId)) : "—",
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    source: r.source,
    oldData: r.oldData,
    newData: r.newData,
  }));
}

export async function dashboard(ctx: SessionContext) {
  const today = todayIST();
  const monthStart = `${today.slice(0, 7)}-01`;
  const canFin = hasPermission(ctx.role, "dashboard:financials");
  const recent = await listBills(ctx, { limit: 8 });
  const drafts = await prisma.bill.count({ where: { orgId: ctx.orgId, status: "DRAFT", ...(canFin ? {} : { createdById: ctx.userId }) } });
  const conflicts = await prisma.syncMutation.count({ where: { orgId: ctx.orgId, status: { in: ["CONFLICT", "REJECTED"] }, ...(canFin ? {} : { userId: ctx.userId }) } });
  if (!canFin) return { financials: null, recent, pending: { drafts, syncConflicts: conflicts } };

  const sales = await prisma.bill.findMany({
    where: { orgId: ctx.orgId, type: "SALES", status: "POSTED", billDate: { gte: toDbDate(monthStart), lte: toDbDate(today) } },
    select: { billDate: true, todayBill: true, coolieTotal: true, lessAmount: true, bonusAmount: true, commissionAmount: true },
  });
  const value = (b: (typeof sales)[number]) => dec(b.todayBill).plus(dec(b.coolieTotal)).minus(dec(b.lessAmount)).plus(dec(b.bonusAmount)).plus(dec(b.commissionAmount));
  const [bal, trust, stock, overdue] = await Promise.all([totals(ctx), currentTrust(ctx.orgId, ctx.userId), stockSummary(ctx), balanceReport(ctx, "CUSTOMER")]);
  const topDues = (await balances(ctx, "CUSTOMER")).slice(0, 5);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { riskFlag: true } });
  return {
    financials: {
      todayRevenue: m2(sum(sales.filter((b) => fromDbDate(b.billDate) === today).map(value))),
      monthRevenue: m2(sum(sales.map(value))),
      customerDues: bal.receivable,
      supplierPayables: bal.payable,
      trustScore: trust.score,
      riskFlag: org.riskFlag,
      topDues,
    },
    recent,
    pending: {
      drafts,
      syncConflicts: conflicts,
      staleStock: stock.filter((s) => s.stale).map((s) => s.name),
      negativeStock: stock.filter((s) => s.negative).map((s) => s.name),
      overdueCustomers: overdue.filter((o) => o.alert).map((o) => ({ storeId: o.storeId, label: `${o.shopName} — ${o.city}`, overdueAmount: o.overdueAmount, overdueDays: o.overdueDays })),
    },
  };
}

export async function ensureOrg(ctx: Pick<SessionContext, "orgId">) {
  const org = await prisma.organization.findUnique({ where: { id: ctx.orgId } });
  if (!org) throw notFound("Organisation");
  return org;
}
