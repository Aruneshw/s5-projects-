// src/server/services/credit.ts
// Trust score inputs, snapshots, credit profile and the loan-product matchmaker.
// Offers are INDICATIVE / pre-qualified only — never approvals.
import "server-only";
import { createHash } from "node:crypto";
import { prisma, Prisma } from "../db";
import { withActorTx } from "../tx";
import { conflict, forbidden, notFound } from "../errors";
import { allocateStores } from "./receivables";
import { totals } from "./ledger";
import { computeTrustScore, type TrustInputs, type TrustResult } from "@/features/credit/trust-score";
import { dec, m2, money, sum, D } from "@/lib/money";
import { addDays, daysBetween, fromDbDate, lastMonths, monthKey, toDbDate, todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";

export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

export async function gatherTrustInputs(orgId: string, asOf: string = todayIST()): Promise<TrustInputs> {
  const settings = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const creditDays = Number((settings.settings as { defaultCreditDays?: number })?.defaultCreditDays ?? 30);
  const allocs = await allocateStores(orgId, { type: "CUSTOMER", defaultCreditDays: creditDays });
  const windowStart = addDays(asOf, -180);
  const dueInvoices = allocs
    .flatMap((s) => s.allocations)
    .filter((a) => a.id.startsWith("b:") && a.dueDate >= windowStart && a.dueDate <= asOf)
    .map((a) => ({ amount: a.amount.toNumber(), dueDate: a.dueDate, settledDate: a.settledDate && a.settledDate <= asOf ? a.settledDate : null }));

  const months = lastMonths(asOf, 6);
  const from = `${months[0]}-01`;
  const [payments, expenses, salaries] = await Promise.all([
    prisma.payment.findMany({ where: { orgId, status: "ACTIVE", paymentDate: { gte: toDbDate(from), lte: toDbDate(asOf) } }, select: { direction: true, amount: true, paymentDate: true } }),
    prisma.expense.findMany({ where: { orgId, status: "ACTIVE", expenseDate: { gte: toDbDate(from), lte: toDbDate(asOf) } }, select: { amount: true, expenseDate: true } }),
    prisma.workerSalary.findMany({ where: { orgId, status: "ACTIVE", paymentDate: { gte: toDbDate(from), lte: toDbDate(asOf) } }, select: { amount: true, paymentDate: true } }),
  ]);
  const net = new Map(months.map((m) => [m, dec(0)]));
  const active = new Set<string>();
  const add = (date: Date, amt: InstanceType<typeof D>) => {
    const k = monthKey(fromDbDate(date));
    if (!net.has(k)) return;
    net.set(k, net.get(k)!.plus(amt));
    active.add(k);
  };
  for (const p of payments) add(p.paymentDate, p.direction === "RECEIVED" ? dec(p.amount) : dec(p.amount).negated());
  for (const e of expenses) add(e.expenseDate, dec(e.amount).negated());
  for (const s of salaries) add(s.paymentDate, dec(s.amount).negated());

  const days = await prisma.$queryRaw<Array<{ active: bigint; last: Date | null }>>`
    SELECT COUNT(DISTINCT "entryDate") FILTER (WHERE "entryDate" > ${toDbDate(addDays(asOf, -90))}::date AND "entryDate" <= ${toDbDate(asOf)}::date) AS active,
           MAX("entryDate") FILTER (WHERE "entryDate" <= ${toDbDate(asOf)}::date) AS last
    FROM "ledger_entries" WHERE "orgId" = ${orgId}::uuid`;
  const last = days[0]?.last ? fromDbDate(days[0].last) : null;

  const adj = await prisma.trustScoreAdjustment.aggregate({ where: { orgId, revokedAt: null }, _sum: { points: true } });

  return {
    asOf,
    dueInvoices,
    monthlyNet: months.map((m) => Number(net.get(m)!.toFixed(2))),
    activeMonths: active.size,
    activeLedgerDays90: Number(days[0]?.active ?? 0),
    daysSinceLastEntry: last ? daysBetween(last, asOf) : null,
    adjustmentPoints: adj._sum.points ?? 0,
  };
}

export async function computeAndStoreTrust(orgId: string, actorId: string = SYSTEM_ACTOR, asOf?: string): Promise<TrustResult & { inputs: TrustInputs; computedAt: Date }> {
  const inputs = await gatherTrustInputs(orgId, asOf);
  const result = computeTrustScore(inputs);
  const snap = await withActorTx({ userId: actorId, orgId }, (tx) =>
    tx.trustScoreSnapshot.create({
      data: {
        orgId,
        score: result.score,
        baseScore: result.baseScore,
        adjustmentTotal: result.adjustmentTotal,
        formulaVersion: result.formulaVersion,
        inputs: inputs as unknown as Prisma.InputJsonValue,
        factors: result.factors as unknown as Prisma.InputJsonValue,
        explanations: result.explanations as unknown as Prisma.InputJsonValue,
      },
    }),
  );
  return { ...result, inputs, computedAt: snap.computedAt };
}

/** Latest snapshot if computed within `maxAgeMinutes`, else recompute. */
export async function currentTrust(orgId: string, actorId: string, maxAgeMinutes = 60) {
  const latest = await prisma.trustScoreSnapshot.findFirst({ where: { orgId }, orderBy: { computedAt: "desc" } });
  const adjCount = await prisma.trustScoreAdjustment.count({ where: { orgId, createdAt: { gt: latest?.computedAt ?? new Date(0) } } });
  if (latest && adjCount === 0 && Date.now() - latest.computedAt.getTime() < maxAgeMinutes * 60_000) {
    return {
      score: latest.score,
      baseScore: latest.baseScore,
      adjustmentTotal: latest.adjustmentTotal,
      formulaVersion: latest.formulaVersion,
      factors: latest.factors as TrustResult["factors"],
      explanations: latest.explanations as string[],
      computedAt: latest.computedAt,
    };
  }
  const fresh = await computeAndStoreTrust(orgId, actorId);
  return { ...fresh, inputs: undefined };
}

// --------------------------------- Credit profile ---------------------------------------

export async function buildCreditProfile(ctx: Pick<SessionContext, "orgId" | "userId" | "settings">) {
  const asOf = todayIST();
  const months = lastMonths(asOf, 12);
  const from = `${months[0]}-01`;
  const bills = await prisma.bill.findMany({
    where: { orgId: ctx.orgId, status: "POSTED", billDate: { gte: toDbDate(from), lte: toDbDate(asOf) } },
    select: { type: true, billDate: true, todayBill: true, coolieTotal: true, lessAmount: true, bonusAmount: true, commissionAmount: true },
  });
  const turnover = new Map(months.map((m) => [m, dec(0)]));
  const purchases = new Map(months.map((m) => [m, dec(0)]));
  for (const b of bills) {
    const k = monthKey(fromDbDate(b.billDate));
    const comm = dec(b.commissionAmount);
    const c = dec(b.todayBill).plus(dec(b.coolieTotal)).minus(dec(b.lessAmount)).plus(dec(b.bonusAmount)).plus(b.type === "SALES" ? comm : comm.negated());
    const target = b.type === "SALES" ? turnover : purchases;
    if (target.has(k)) target.set(k, target.get(k)!.plus(c));
  }
  const [expensesByMonth, salariesByMonth] = await Promise.all([
    prisma.expense.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", expenseDate: { gte: toDbDate(from) } }, select: { amount: true, expenseDate: true } }),
    prisma.workerSalary.findMany({ where: { orgId: ctx.orgId, status: "ACTIVE", paymentDate: { gte: toDbDate(from) } }, select: { amount: true, paymentDate: true } }),
  ]);
  const costs = new Map(months.map((m) => [m, dec(0)]));
  for (const e of expensesByMonth) {
    const k = monthKey(fromDbDate(e.expenseDate));
    if (costs.has(k)) costs.set(k, costs.get(k)!.plus(dec(e.amount)));
  }
  for (const s of salariesByMonth) {
    const k = monthKey(fromDbDate(s.paymentDate));
    if (costs.has(k)) costs.set(k, costs.get(k)!.plus(dec(s.amount)));
  }
  const monthly = months.map((m) => {
    const t = turnover.get(m)!;
    const result = t.minus(purchases.get(m)!).minus(costs.get(m)!);
    return { month: m, turnover: m2(t), tradingResult: m2(result) };
  });
  const annualTurnover = money(sum(monthly.map((x) => x.turnover)));
  const activeMonths = monthly.filter((x) => !dec(x.turnover).isZero()).length;
  const last6 = monthly.slice(-6).filter((x) => !dec(x.turnover).isZero());
  const profitConsistency = last6.length ? Math.round((100 * last6.filter((x) => dec(x.tradingResult).gt(0)).length) / last6.length) : 0;

  const period = async (type: "CUSTOMER" | "SUPPLIER") => {
    const allocs = await allocateStores(ctx.orgId, { type, defaultCreditDays: ctx.settings.defaultCreditDays });
    let weighted = 0;
    let amount = 0;
    for (const a of allocs.flatMap((x) => x.allocations)) {
      if (!a.id.startsWith("b:") || !a.settledDate) continue;
      const amt = a.amount.toNumber();
      weighted += daysBetween(a.date, a.settledDate) * amt;
      amount += amt;
    }
    return amount > 0 ? Math.round((weighted / amount) * 10) / 10 : null;
  };

  const payments = await prisma.payment.findMany({
    where: { orgId: ctx.orgId, status: "ACTIVE", direction: "RECEIVED", paymentDate: { gte: toDbDate(from) } },
    include: { paymentMode: { select: { isDigital: true } } },
  });
  const rec = sum(payments.map((p) => p.amount.toString()));
  const digital = sum(payments.filter((p) => p.paymentMode.isDigital).map((p) => p.amount.toString()));
  const bal = await totals(ctx);
  const trust = await currentTrust(ctx.orgId, ctx.userId);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { riskFlag: true } });
  const openDefaults = await prisma.defaultEvent.count({ where: { orgId: ctx.orgId, resolvedAt: null } });

  const metrics = {
    asOf,
    monthly,
    annualTurnover: m2(annualTurnover),
    activeMonths,
    avgCollectionDays: await period("CUSTOMER"),
    avgSupplierPaymentDays: await period("SUPPLIER"),
    receivables: bal.receivable,
    payables: bal.payable,
    digitalReceiptPercent: rec.isZero() ? "0.00" : digital.div(rec).times(100).toFixed(2),
    profitConsistencyPercent: profitConsistency,
    riskIndicators: [
      ...(org.riskFlag === "HIGH_RISK" ? ["Account flagged HIGH_RISK"] : []),
      ...(openDefaults ? [`${openDefaults} unresolved financing default(s)`] : []),
      ...(activeMonths < 3 ? ["Less than 3 months of trading history"] : []),
    ],
  };
  const snap = await withActorTx(ctx, (tx) =>
    tx.creditProfileSnapshot.create({
      data: { orgId: ctx.orgId, metrics: metrics as unknown as Prisma.InputJsonValue, trustScore: trust.score, riskFlag: org.riskFlag },
    }),
  );
  return { snapshotId: snap.id, trustScore: trust.score, riskFlag: org.riskFlag, metrics, trust };
}

/**
 * Matching rules (documented in docs/FINANCIAL_RULES.md §Matchmaker):
 *   score ≥ product.minTrustScore, annual turnover ≥ product.minAnnualTurnover,
 *   active months ≥ product.minMonthsHistory, and not HIGH_RISK if product.excludeHighRisk.
 *   Indicative amount = min(product.maxLoanAmount, 25% of trailing-12-month turnover), floored to ₹1,000.
 *   Indicative rate = product's published maximum rate (a ceiling, not a quote).
 */
export async function matchLoanOffers(ctx: Pick<SessionContext, "orgId" | "userId" | "settings">) {
  const profile = await buildCreditProfile(ctx);
  const products = await prisma.loanProduct.findMany({ where: { isActive: true, partner: { isActive: true } }, include: { partner: true } });
  const turnover = dec(profile.metrics.annualTurnover);
  const results = [];
  for (const p of products) {
    const reasons: string[] = [];
    if (profile.trustScore < p.minTrustScore) reasons.push(`Trust score ${profile.trustScore} below ${p.minTrustScore}`);
    if (turnover.lt(dec(p.minAnnualTurnover))) reasons.push(`Turnover below ₹${m2(p.minAnnualTurnover)}`);
    if (profile.metrics.activeMonths < p.minMonthsHistory) reasons.push(`Needs ${p.minMonthsHistory} months of history`);
    if (p.excludeHighRisk && profile.riskFlag === "HIGH_RISK") reasons.push("Not available to HIGH_RISK accounts");
    const amount = D.min(dec(p.maxLoanAmount), turnover.times("0.25")).div(1000).floor().times(1000);
    if (amount.lte(0)) reasons.push("Turnover too low for an indicative amount");
    let offerId: string | null = null;
    if (reasons.length === 0) {
      const offer = await withActorTx(ctx, (tx) =>
        tx.loanOffer.upsert({
          where: { orgId_loanProductId_creditProfileSnapshotId: { orgId: ctx.orgId, loanProductId: p.id, creditProfileSnapshotId: profile.snapshotId } },
          create: { orgId: ctx.orgId, loanProductId: p.id, creditProfileSnapshotId: profile.snapshotId, indicativeAmount: m2(amount), indicativeRatePercent: p.maxInterestRatePercent },
          update: {},
        }),
      );
      offerId = offer.id;
    }
    results.push({
      productId: p.id,
      productName: p.name,
      partner: p.partner.name,
      isDemoPartner: p.partner.isDemo,
      eligible: reasons.length === 0,
      reasons,
      offerId,
      indicativeAmount: reasons.length === 0 ? m2(amount) : null,
      indicativeMaxRatePercent: p.maxInterestRatePercent.toString(),
    });
  }
  return {
    disclaimer: "Indicative pre-qualification only. Not a loan approval or offer. The lender makes its own decision after its own checks.",
    profile: { trustScore: profile.trustScore, riskFlag: profile.riskFlag, metrics: profile.metrics },
    products: results,
  };
}

export async function expressInterest(ctx: Pick<SessionContext, "orgId" | "userId">, offerId: string) {
  const offer = await prisma.loanOffer.findFirst({ where: { id: offerId, orgId: ctx.orgId } });
  if (!offer) throw notFound("Offer");
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  if (!org.shareCreditProfile) throw conflict("Turn on 'Share anonymised credit profile with lenders' in Settings first");
  if (offer.status !== "INDICATIVE") throw conflict("Interest was already expressed or the offer is closed");
  return withActorTx(ctx, (tx) => tx.loanOffer.update({ where: { id: offerId }, data: { status: "INTEREST_EXPRESSED" }, select: { id: true, status: true } }));
}

export async function setCreditSharing(ctx: Pick<SessionContext, "orgId" | "userId">, share: boolean) {
  return withActorTx(ctx, (tx) => tx.organization.update({ where: { id: ctx.orgId }, data: { shareCreditProfile: share }, select: { shareCreditProfile: true } }));
}

// ------------------------------------ Lender portal --------------------------------------

export function anonymousId(orgId: string): string {
  return "MSME-" + createHash("sha256").update(`msme:${orgId}`).digest("hex").slice(0, 8).toUpperCase();
}

export async function lenderProfiles(ctx: Pick<SessionContext, "lendingPartnerId" | "role">) {
  if (ctx.role !== "LENDER_BANK" || !ctx.lendingPartnerId) throw forbidden("This account is not linked to a lending partner");
  const offers = await prisma.loanOffer.findMany({
    where: { product: { lendingPartnerId: ctx.lendingPartnerId }, status: { in: ["INTEREST_EXPRESSED", "LENDER_DECLINED"] } },
    include: { product: true, snapshot: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const orgs = await prisma.organization.findMany({ where: { id: { in: offers.map((o) => o.orgId) } }, select: { id: true, shareCreditProfile: true } });
  const consent = new Map(orgs.map((o) => [o.id, o.shareCreditProfile]));
  return offers
    .filter((o) => consent.get(o.orgId))
    .map((o) => {
      const m = o.snapshot.metrics as { annualTurnover?: string; avgCollectionDays?: number | null; avgSupplierPaymentDays?: number | null; digitalReceiptPercent?: string; profitConsistencyPercent?: number; activeMonths?: number; riskIndicators?: string[] };
      return {
        offerId: o.id,
        applicant: anonymousId(o.orgId), // no names, cities, customers or suppliers
        product: o.product.name,
        status: o.status,
        indicativeAmount: m2(o.indicativeAmount),
        indicativeRatePercent: o.indicativeRatePercent.toString(),
        trustScore: o.snapshot.trustScore,
        riskFlag: o.snapshot.riskFlag,
        profileDate: o.snapshot.computedAt,
        metrics: {
          annualTurnover: m.annualTurnover,
          avgCollectionDays: m.avgCollectionDays,
          avgSupplierPaymentDays: m.avgSupplierPaymentDays,
          digitalReceiptPercent: m.digitalReceiptPercent,
          profitConsistencyPercent: m.profitConsistencyPercent,
          activeMonths: m.activeMonths,
          riskIndicators: m.riskIndicators,
        },
      };
    });
}

export async function lenderDecline(ctx: Pick<SessionContext, "lendingPartnerId" | "role" | "userId" | "orgId">, offerId: string, note: string) {
  if (ctx.role !== "LENDER_BANK" || !ctx.lendingPartnerId) throw forbidden();
  const offer = await prisma.loanOffer.findFirst({ where: { id: offerId, product: { lendingPartnerId: ctx.lendingPartnerId } } });
  if (!offer) throw notFound("Offer");
  return withActorTx(ctx, (tx) => tx.loanOffer.update({ where: { id: offerId }, data: { status: "LENDER_DECLINED", lenderNote: note.slice(0, 300) }, select: { id: true, status: true } }));
}
