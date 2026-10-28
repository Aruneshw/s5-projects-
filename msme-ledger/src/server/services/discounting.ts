// src/server/services/discounting.ts
// Invoice discounting WORKFLOW. This app is not a lender: it records requests, real bids by
// authenticated financiers, funding confirmations and settlements. No bids are fabricated.
//
// Double-financing protection, in layers:
//   1. advisory lock per bill inside the transaction,
//   2. re-validation inside the transaction,
//   3. partial UNIQUE index on discount_requests(billId) for live statuses (final guard),
//   4. trigger freezing the request's financial terms and the bill's cancellation.
import "server-only";
import { prisma, type Tx } from "../db";
import { withActorTx, lockKey, lockStore } from "../tx";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { billSettlementMap } from "./receivables";
import { currentTrust, SYSTEM_ACTOR } from "./credit";
import { postLedger } from "./ledger";
import { calculateDiscountPricing, pricingToJSON, PricingError } from "@/features/discounting/pricing";
import { dec, m2 } from "@/lib/money";
import { daysBetween, fromDbDate, toDbDate, todayIST } from "@/lib/dates";
import type { SessionContext } from "../auth/session";

const LIVE = ["LISTED", "BID_ACCEPTED", "FUNDED", "DEFAULTED"] as const;
export const DEFAULT_GRACE_DAYS = 15;
export const DEFAULT_PENALTY_POINTS = -50;

type OwnerCtx = Pick<SessionContext, "orgId" | "userId" | "role" | "settings">;

export interface Eligibility {
  eligible: boolean;
  reasons: string[];
  billId: string;
  invoiceAmount: string | null;
  dueDate: string | null;
  tenureDays: number | null;
  trustScore: number | null;
  quote: ReturnType<typeof pricingToJSON> | null;
}

export async function validateInvoiceForDiscounting(ctx: OwnerCtx, billId: string, client: Tx | typeof prisma = prisma): Promise<Eligibility> {
  const reasons: string[] = [];
  const bill = await client.bill.findFirst({ where: { id: billId, orgId: ctx.orgId }, include: { payments: { where: { status: "ACTIVE" } }, adjustments: true } });
  if (!bill) throw notFound("Invoice"); // other orgs' invoices are indistinguishable from missing ones
  const out: Eligibility = { eligible: false, reasons, billId, invoiceAmount: null, dueDate: null, tenureDays: null, trustScore: null, quote: null };

  if (bill.type !== "SALES") reasons.push("Only sales invoices can be financed");
  if (bill.status === "CANCELLED") reasons.push("Invoice is cancelled");
  if (bill.status === "DRAFT") reasons.push("Invoice is not posted");

  const live = await client.discountRequest.findFirst({ where: { billId, status: { in: [...LIVE] } } });
  if (live) reasons.push(live.status === "LISTED" ? "Invoice is already listed" : "Invoice is already discounted / under financing");

  const defaults = await client.defaultEvent.count({ where: { orgId: ctx.orgId, resolvedAt: null } });
  if (defaults > 0) reasons.push("Business has an unresolved default on a previously financed invoice");

  if (bill.status === "POSTED" && bill.type === "SALES") {
    if (bill.payments.length > 0) reasons.push("Invoice is not fully unpaid (payments are recorded against it)");
    const settle = (await billSettlementMap(ctx.orgId, { storeIds: [bill.storeId], defaultCreditDays: ctx.settings.defaultCreditDays })).get(bill.id);
    if (!settle) reasons.push("Invoice has no outstanding amount");
    else {
      out.invoiceAmount = settle.amount;
      if (settle.status === "PAID") reasons.push("Invoice is already paid");
      else if (!dec(settle.outstanding).equals(dec(settle.amount))) reasons.push("Invoice is partly paid; only unpaid invoices qualify");
      if (dec(settle.amount).lt(ctx.settings.minDiscountInvoiceAmount)) {
        reasons.push(`Invoice amount is below the minimum of ₹${ctx.settings.minDiscountInvoiceAmount.toLocaleString("en-IN")}`);
      }
    }
    if (!bill.dueDate) reasons.push("Invoice has no due date");
    else {
      const due = fromDbDate(bill.dueDate);
      const days = daysBetween(todayIST(), due);
      out.dueDate = due;
      out.tenureDays = days;
      if (days < ctx.settings.discountMinDaysToDue) reasons.push(`Due date is less than ${ctx.settings.discountMinDaysToDue} days away (${days})`);
      if (days > ctx.settings.discountMaxDaysToDue) reasons.push(`Due date is more than ${ctx.settings.discountMaxDaysToDue} days away (${days})`);
    }
    // Integrity: bill charge + adjustments must equal the ledger-derived invoice amount.
    const charge = dec(bill.todayBill).plus(dec(bill.coolieTotal)).minus(dec(bill.lessAmount)).plus(dec(bill.bonusAmount)).plus(dec(bill.commissionAmount));
    const withAdj = bill.adjustments.reduce((a, x) => a.plus(dec(x.amount)), charge);
    if (out.invoiceAmount && !withAdj.equals(dec(out.invoiceAmount))) reasons.push("Invoice failed an integrity check (ledger mismatch). Contact support.");
  }

  if (reasons.length === 0 && out.invoiceAmount && out.tenureDays) {
    const trust = await currentTrust(ctx.orgId, ctx.userId);
    out.trustScore = trust.score;
    try {
      out.quote = pricingToJSON(calculateDiscountPricing(out.invoiceAmount, out.tenureDays, trust.score));
    } catch (e) {
      if (e instanceof PricingError) reasons.push(e.message);
      else throw e;
    }
  }
  out.eligible = reasons.length === 0;
  return out;
}

/** Owner explicitly accepts the displayed quote → invoice becomes "Available for Advance". */
export async function acceptDiscount(ctx: OwnerCtx, input: { billId: string; expectedUpfrontPayout: string; settlementRouting: "TO_BUSINESS" | "TO_FINANCIER" }) {
  return withActorTx(ctx, async (tx) => {
    await lockKey(tx, `discount:${input.billId}`);
    const v = await validateInvoiceForDiscounting(ctx, input.billId, tx);
    if (!v.eligible || !v.quote || !v.dueDate || v.trustScore === null) throw conflict("Invoice is not eligible for an advance", { reasons: v.reasons });
    if (!dec(v.quote.upfrontPayout).equals(dec(input.expectedUpfrontPayout))) {
      throw conflict("The quote changed since you viewed it. Review the new terms and accept again.", { quote: v.quote });
    }
    const req = await tx.discountRequest.create({
      data: {
        orgId: ctx.orgId,
        billId: input.billId,
        status: "LISTED",
        invoiceAmount: v.quote.invoiceAmount,
        tenureDays: v.quote.tenureDays,
        annualRatePercent: v.quote.annualRatePercent,
        discountFee: v.quote.discountFee,
        reserveHoldback: v.quote.reserveHoldback,
        upfrontPayout: v.quote.upfrontPayout,
        trustScoreAtRequest: v.trustScore,
        dueDate: toDbDate(v.dueDate),
        acceptedTermsAt: new Date(),
        acceptedById: ctx.userId,
        settlementRouting: input.settlementRouting,
      },
    });
    return requestDto(req);
  });
}

function requestDto(r: {
  id: string;
  billId: string;
  status: string;
  invoiceAmount: unknown;
  tenureDays: number;
  annualRatePercent: unknown;
  discountFee: unknown;
  reserveHoldback: unknown;
  upfrontPayout: unknown;
  trustScoreAtRequest: number;
  dueDate: Date;
  fundedAmount: unknown;
  fundedAt: Date | null;
  fundingReference: string | null;
  settlementRouting: string;
  settledAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    billId: r.billId,
    status: r.status,
    invoiceAmount: m2(r.invoiceAmount as string),
    tenureDays: r.tenureDays,
    annualRatePercent: String(r.annualRatePercent),
    discountFee: m2(r.discountFee as string),
    reserveHoldback: m2(r.reserveHoldback as string),
    upfrontPayout: m2(r.upfrontPayout as string),
    trustScoreAtRequest: r.trustScoreAtRequest,
    dueDate: fromDbDate(r.dueDate),
    fundedAmount: r.fundedAmount ? m2(r.fundedAmount as string) : null,
    fundedAt: r.fundedAt,
    fundingReference: r.fundingReference,
    settlementRouting: r.settlementRouting,
    settledAt: r.settledAt,
    createdAt: r.createdAt,
  };
}

export async function listOwnRequests(ctx: OwnerCtx) {
  const rows = await prisma.discountRequest.findMany({
    where: { orgId: ctx.orgId },
    include: {
      bill: { select: { billNumber: true, store: { select: { shopName: true, city: true } } } },
      bids: { orderBy: { createdAt: "asc" } },
      settlements: true,
      default: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    ...requestDto(r),
    billNumber: r.bill.billNumber,
    party: `${r.bill.store.shopName} — ${r.bill.store.city}`,
    bids: r.bids.map((b) => ({ id: b.id, annualRatePercent: b.annualRatePercent.toString(), advanceAmount: m2(b.advanceAmount), status: b.status, createdAt: b.createdAt })),
    settled: m2(r.settlements.reduce((a, s) => a.plus(dec(s.amount)), dec(0))),
    defaulted: r.default ? { detectedAt: r.default.detectedAt, daysOverdue: r.default.daysOverdue, resolvedAt: r.default.resolvedAt } : null,
  }));
}

export async function withdrawRequest(ctx: OwnerCtx, id: string) {
  const r = await prisma.discountRequest.findFirst({ where: { id, orgId: ctx.orgId } });
  if (!r) throw notFound("Request");
  if (!["LISTED", "BID_ACCEPTED"].includes(r.status)) throw conflict("Only requests that are not yet funded can be withdrawn");
  return withActorTx(ctx, async (tx) => {
    await tx.discountBid.updateMany({ where: { discountRequestId: id, status: { in: ["OPEN", "ACCEPTED"] } }, data: { status: "REJECTED" } });
    const u = await tx.discountRequest.update({ where: { id }, data: { status: "WITHDRAWN", version: { increment: 1 } } });
    return requestDto(u);
  });
}

export async function acceptBid(ctx: OwnerCtx, requestId: string, bidId: string) {
  const r = await prisma.discountRequest.findFirst({ where: { id: requestId, orgId: ctx.orgId } });
  if (!r) throw notFound("Request");
  return withActorTx(ctx, async (tx) => {
    await lockKey(tx, `discount-req:${requestId}`);
    const fresh = await tx.discountRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (fresh.status !== "LISTED") throw conflict("Request is no longer open for bids");
    const bid = await tx.discountBid.findFirst({ where: { id: bidId, discountRequestId: requestId, status: "OPEN" } });
    if (!bid) throw notFound("Bid");
    await tx.discountBid.update({ where: { id: bidId }, data: { status: "ACCEPTED" } });
    await tx.discountBid.updateMany({ where: { discountRequestId: requestId, id: { not: bidId }, status: "OPEN" }, data: { status: "REJECTED" } });
    const u = await tx.discountRequest.update({
      where: { id: requestId },
      data: { status: "BID_ACCEPTED", financierOrgId: bid.financierOrgId, acceptedBidId: bid.id, version: { increment: 1 } },
    });
    return requestDto(u);
  });
}

/**
 * The MSME owner records what the buyer paid. TO_FINANCIER: the buyer paid the financier directly,
 * so the customer's receivable is cleared with a ledger payment via a "Via financier" mode.
 * TO_BUSINESS: the buyer paid the business — record that customer payment as usual; this
 * entry only tracks the financing side.
 */
export async function recordSettlement(
  ctx: OwnerCtx,
  requestId: string,
  input: { amount: string; routing: "TO_BUSINESS" | "TO_FINANCIER"; settledOn: string; reserveReleased: string; reference?: string | null },
) {
  const r = await prisma.discountRequest.findFirst({ where: { id: requestId, orgId: ctx.orgId }, include: { bill: true, settlements: true } });
  if (!r) throw notFound("Request");
  if (!["FUNDED", "DEFAULTED"].includes(r.status)) throw conflict("Only funded requests can be settled");
  const already = r.settlements.reduce((a, s) => a.plus(dec(s.amount)), dec(0));
  const after = already.plus(dec(input.amount));
  if (after.gt(dec(r.invoiceAmount))) throw invalid("Settlements cannot exceed the invoice amount");
  if (dec(input.reserveReleased).gt(dec(r.reserveHoldback))) throw invalid("Reserve released cannot exceed the reserve holdback");

  return withActorTx(ctx, async (tx) => {
    await lockKey(tx, `discount-req:${requestId}`);
    const s = await tx.financingSettlement.create({
      data: {
        discountRequestId: requestId,
        amount: m2(input.amount),
        routing: input.routing,
        settledOn: toDbDate(input.settledOn),
        reserveReleased: m2(input.reserveReleased),
        reference: input.reference ?? null,
        recordedById: ctx.userId,
      },
    });
    if (input.routing === "TO_FINANCIER") {
      await lockStore(tx, r.bill.storeId);
      let mode = await tx.paymentMode.findFirst({ where: { orgId: ctx.orgId, name: "Via financier" } });
      if (!mode) mode = await tx.paymentMode.create({ data: { orgId: ctx.orgId, name: "Via financier", isDigital: true } });
      const p = await tx.payment.create({
        data: {
          orgId: ctx.orgId,
          storeId: r.bill.storeId,
          billId: r.billId,
          direction: "RECEIVED",
          paymentModeId: mode.id,
          amount: m2(input.amount),
          paymentDate: toDbDate(input.settledOn),
          reference: input.reference ?? null,
          notes: "Buyer paid the financier directly",
          idempotencyKey: `financing-settlement:${s.id}`,
          createdById: ctx.userId,
        },
      });
      await postLedger(tx, {
        orgId: ctx.orgId,
        storeId: r.bill.storeId,
        entryDate: input.settledOn,
        entryType: "PAYMENT",
        amount: dec(input.amount).negated(),
        description: `Buyer paid financier for bill #${r.bill.billNumber}`,
        createdById: ctx.userId,
        billId: r.billId,
        paymentId: p.id,
      });
    }
    const fullySettled = after.equals(dec(r.invoiceAmount));
    if (fullySettled) {
      await tx.discountRequest.update({ where: { id: requestId }, data: { status: "SETTLED", settledAt: new Date(), version: { increment: 1 } } });
      await tx.defaultEvent.updateMany({ where: { discountRequestId: requestId, resolvedAt: null }, data: { resolvedAt: new Date() } });
      // The penalty stays in history; the HIGH_RISK flag clears once no default is unresolved.
      const open = await tx.defaultEvent.count({ where: { orgId: ctx.orgId, resolvedAt: null } });
      if (open === 0) await tx.organization.update({ where: { id: ctx.orgId }, data: { riskFlag: "NORMAL" } });
    }
    return { settlementId: s.id, fullySettled, totalSettled: m2(after) };
  });
}

// ------------------------------ Financier (investor) side -------------------------------

function mask(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : w[0] + "*".repeat(Math.min(6, w.length - 1))))
    .join(" ");
}

type FinCtx = Pick<SessionContext, "orgId" | "userId" | "role" | "orgType">;

function assertFinancier(ctx: FinCtx) {
  if (ctx.orgType !== "FINANCIER" || ctx.role !== "INVESTOR") throw forbidden();
}

/** Listings visible to authorised investors, with sensitive details masked. */
export async function marketplace(ctx: FinCtx) {
  assertFinancier(ctx);
  const rows = await prisma.discountRequest.findMany({
    where: { status: "LISTED" },
    include: { bill: { select: { store: { select: { city: true } } } }, bids: { where: { financierOrgId: ctx.orgId } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const orgs = await prisma.organization.findMany({ where: { id: { in: rows.map((r) => r.orgId) } }, select: { id: true, name: true } });
  const names = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    seller: mask(names.get(r.orgId) ?? "MSME"),
    buyerCity: r.bill.store.city, // buyer name, invoice number and addresses are never shown
    invoiceAmount: m2(r.invoiceAmount),
    dueDate: fromDbDate(r.dueDate),
    tenureDays: r.tenureDays,
    trustScore: r.trustScoreAtRequest,
    platformRatePercent: r.annualRatePercent.toString(),
    myBid: r.bids[0] ? { id: r.bids[0].id, status: r.bids[0].status, annualRatePercent: r.bids[0].annualRatePercent.toString(), advanceAmount: m2(r.bids[0].advanceAmount) } : null,
  }));
}

export async function placeBid(ctx: FinCtx, requestId: string, input: { annualRatePercent: string; advanceAmount: string }) {
  assertFinancier(ctx);
  const r = await prisma.discountRequest.findUnique({ where: { id: requestId } });
  if (!r || r.status !== "LISTED") throw notFound("Listing");
  if (dec(input.advanceAmount).gt(dec(r.invoiceAmount))) throw invalid("Advance cannot exceed the invoice amount");
  const existing = await prisma.discountBid.findUnique({ where: { discountRequestId_financierOrgId: { discountRequestId: requestId, financierOrgId: ctx.orgId } } });
  if (existing) throw conflict("Your organisation has already bid on this listing");
  const b = await withActorTx(ctx, (tx) =>
    tx.discountBid.create({
      data: { discountRequestId: requestId, financierOrgId: ctx.orgId, bidderUserId: ctx.userId, annualRatePercent: input.annualRatePercent, advanceAmount: m2(input.advanceAmount) },
    }),
  );
  return { id: b.id, status: b.status };
}

export async function investments(ctx: FinCtx) {
  assertFinancier(ctx);
  const rows = await prisma.discountRequest.findMany({
    where: { financierOrgId: ctx.orgId },
    include: { settlements: true, bill: { select: { store: { select: { city: true } } } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    buyerCity: r.bill.store.city,
    invoiceAmount: m2(r.invoiceAmount),
    dueDate: fromDbDate(r.dueDate),
    fundedAmount: r.fundedAmount ? m2(r.fundedAmount) : null,
    fundedAt: r.fundedAt,
    fundingReference: r.fundingReference,
    settlementRouting: r.settlementRouting,
    settled: m2(r.settlements.reduce((a, s) => a.plus(dec(s.amount)), dec(0))),
  }));
}

/** The financier confirms it actually transferred funds (with its own reference). */
export async function confirmFunding(ctx: FinCtx, requestId: string, input: { fundedAmount: string; fundingReference: string }) {
  assertFinancier(ctx);
  const r = await prisma.discountRequest.findUnique({ where: { id: requestId } });
  if (!r || r.financierOrgId !== ctx.orgId) throw notFound("Investment");
  if (r.status !== "BID_ACCEPTED") throw conflict("Funding can only be confirmed after the business accepts your bid");
  if (dec(input.fundedAmount).gt(dec(r.invoiceAmount))) throw invalid("Funded amount cannot exceed the invoice amount");
  return withActorTx({ userId: ctx.userId, orgId: r.orgId }, async (tx) => {
    const u = await tx.discountRequest.update({
      where: { id: requestId },
      data: { status: "FUNDED", fundedAmount: m2(input.fundedAmount), fundedAt: new Date(), fundingReference: input.fundingReference, version: { increment: 1 } },
    });
    return { id: u.id, status: u.status };
  });
}

// ----------------------------------- Default job ---------------------------------------

/**
 * Idempotent. For every FUNDED request more than 15 days past due: create ONE DefaultEvent
 * (unique per request), ONE −50 adjustment (unique per default event), mark DEFAULTED and
 * flag the MSME HIGH_RISK. Re-running the job changes nothing.
 */
export async function runDefaultCheck(asOf: string = todayIST()) {
  const candidates = await prisma.discountRequest.findMany({ where: { status: "FUNDED" }, select: { id: true, orgId: true, dueDate: true } });
  const created: string[] = [];
  for (const c of candidates) {
    const daysOverdue = daysBetween(fromDbDate(c.dueDate), asOf);
    if (daysOverdue <= DEFAULT_GRACE_DAYS) continue;
    const done = await withActorTx({ userId: SYSTEM_ACTOR, orgId: c.orgId }, async (tx) => {
      await lockKey(tx, `default:${c.id}`);
      const existing = await tx.defaultEvent.findUnique({ where: { discountRequestId: c.id } });
      if (existing) return false;
      const fresh = await tx.discountRequest.findUniqueOrThrow({ where: { id: c.id } });
      if (fresh.status !== "FUNDED") return false;
      const ev = await tx.defaultEvent.create({ data: { orgId: c.orgId, discountRequestId: c.id, daysOverdue } });
      await tx.trustScoreAdjustment.create({
        data: { orgId: c.orgId, points: DEFAULT_PENALTY_POINTS, reason: `Financed invoice unpaid ${daysOverdue} days after due date`, defaultEventId: ev.id },
      });
      await tx.discountRequest.update({ where: { id: c.id }, data: { status: "DEFAULTED", version: { increment: 1 } } });
      await tx.organization.update({ where: { id: c.orgId }, data: { riskFlag: "HIGH_RISK" } });
      return true;
    });
    if (done) created.push(c.id);
  }
  return { checked: candidates.length, defaultsCreated: created };
}
