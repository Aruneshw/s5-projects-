// tests/integration/discounting.test.ts — eligibility, double-financing, defaults, trust score.
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createBill } from "@/server/services/bills";
import { acceptBid, acceptDiscount, confirmFunding, marketplace, placeBid, recordSettlement, runDefaultCheck, validateInvoiceForDiscounting } from "@/server/services/discounting";
import { computeAndStoreTrust, currentTrust, matchLoanOffers, expressInterest, lenderProfiles, setCreditSharing } from "@/server/services/credit";
import { createPayment } from "@/server/services/payments";
import { withActorTx } from "@/server/tx";
import { addDays, todayIST } from "@/lib/dates";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";
import type { SessionContext } from "@/server/auth/session";

let f: Fixture;
let investor: SessionContext;
let investor2: SessionContext;
const T = todayIST();

const sale = (amountRate: string, dueInDays: number, qty = "10") =>
  createBill(f.owner, {
    ...noFees,
    type: "SALES",
    storeId: f.customer.id,
    billDate: T,
    dueDate: addDays(T, dueInDays),
    lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: qty, rate: amountRate }],
  });

async function mkInvestor(name: string): Promise<SessionContext> {
  const org = await prisma.organization.create({ data: { name, type: "FINANCIER" } });
  const u = await prisma.user.create({ data: { username: `${name.toLowerCase().replace(/\W/g, "")}-${Date.now()}`, displayName: name, passwordHash: "x" } });
  await prisma.membership.create({ data: { userId: u.id, orgId: org.id, role: "INVESTOR" } });
  return { userId: u.id, displayName: name, orgId: org.id, orgName: org.name, orgType: "FINANCIER", role: "INVESTOR", settings: f.owner.settings, lendingPartnerId: null };
}

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
  investor = await mkInvestor("Alpha Capital");
  investor2 = await mkInvestor("Beta Funds");
});

describe("validateInvoiceForDiscounting", () => {
  it("accepts an unpaid invoice ≥ ₹5,000 due in 15–90 days and quotes it", async () => {
    const b = await sale("1000", 45); // 10 bags × 1000 + 120 coolie = 10,120
    const v = await validateInvoiceForDiscounting(f.owner, b.bill.id);
    expect(v.reasons).toEqual([]);
    expect(v.eligible).toBe(true);
    expect(v.invoiceAmount).toBe("10120.00");
    expect(v.tenureDays).toBe(45);
    expect(v.trustScore).toBeGreaterThanOrEqual(300);
    expect(Number(v.quote!.upfrontPayout) + Number(v.quote!.reserveHoldback) + Number(v.quote!.discountFee)).toBeCloseTo(10120, 2);
  });

  it("rejects below the minimum amount, wrong tenure, partly paid, purchase and cancelled invoices", async () => {
    const small = await sale("100", 30, "1");
    expect((await validateInvoiceForDiscounting(f.owner, small.bill.id)).reasons.join(" ")).toMatch(/below the minimum/);
    const soon = await sale("1000", 10);
    expect((await validateInvoiceForDiscounting(f.owner, soon.bill.id)).reasons.join(" ")).toMatch(/less than 15 days/);
    const far = await sale("1000", 120);
    expect((await validateInvoiceForDiscounting(f.owner, far.bill.id)).reasons.join(" ")).toMatch(/more than 90 days/);
    const partly = await sale("1000", 40);
    await createPayment(f.owner, { storeId: f.customer.id, billId: partly.bill.id, paymentModeId: f.modes.upi, amount: "100", paymentDate: T, idempotencyKey: "partly-paid" });
    expect((await validateInvoiceForDiscounting(f.owner, partly.bill.id)).reasons.join(" ")).toMatch(/not fully unpaid/);
    const purchase = await createBill(f.owner, { ...noFees, type: "PURCHASE", storeId: f.supplier.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "10", rate: "900" }] });
    expect((await validateInvoiceForDiscounting(f.owner, purchase.bill.id)).reasons.join(" ")).toMatch(/Only sales invoices/);
  });

  it("another organisation's invoice is indistinguishable from a missing one", async () => {
    const other = await makeFixture("Other Org");
    const b = await sale("1000", 45);
    await expect(validateInvoiceForDiscounting(other.owner, b.bill.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("double financing is impossible", () => {
  it("concurrent acceptances: exactly one succeeds", async () => {
    const b = await sale("1000", 60);
    const v = await validateInvoiceForDiscounting(f.owner, b.bill.id);
    const req = { billId: b.bill.id, expectedUpfrontPayout: v.quote!.upfrontPayout, settlementRouting: "TO_FINANCIER" as const };
    const results = await Promise.allSettled([acceptDiscount(f.owner, req), acceptDiscount(f.dad, req), acceptDiscount(f.owner, req)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.discountRequest.count({ where: { billId: b.bill.id } })).toBe(1);
  });

  it("the database refuses a second live request even if the service is bypassed", async () => {
    const r = await prisma.discountRequest.findFirstOrThrow({ where: { orgId: f.owner.orgId, status: "LISTED" } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...copy } = r;
    await expect(withActorTx(f.owner, (tx) => tx.discountRequest.create({ data: copy }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("financial terms are frozen; the invoice cannot be cancelled while financed", async () => {
    const r = await prisma.discountRequest.findFirstOrThrow({ where: { orgId: f.owner.orgId, status: "LISTED" } });
    await expect(withActorTx(f.owner, (tx) => tx.discountRequest.update({ where: { id: r.id }, data: { discountFee: "1.00" } }))).rejects.toMatchObject({ code: "CONFLICT" });
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: r.billId } });
    await expect(
      withActorTx(f.owner, (tx) => tx.bill.update({ where: { id: bill.id }, data: { status: "CANCELLED", cancelReason: "try", cancelledAt: new Date() } })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a stale quote is refused", async () => {
    const b = await sale("1000", 50);
    await expect(acceptDiscount(f.owner, { billId: b.bill.id, expectedUpfrontPayout: "1.00", settlementRouting: "TO_FINANCIER" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("financier workflow and default penalty", () => {
  it("masked listing → real bid → accepted → funded → default penalty applied exactly once", async () => {
    const listing = (await marketplace(investor))[0]!;
    expect(listing).not.toHaveProperty("party");
    expect(listing.seller).toMatch(/\*/);
    const bid = await placeBid(investor, listing.id, { annualRatePercent: "11.5", advanceAmount: "8000" });
    await expect(placeBid(investor, listing.id, { annualRatePercent: "11", advanceAmount: "8000" })).rejects.toMatchObject({ code: "CONFLICT" });
    await placeBid(investor2, listing.id, { annualRatePercent: "12", advanceAmount: "8200" });
    await acceptBid(f.owner, listing.id, bid.id);
    await expect(confirmFunding(investor2, listing.id, { fundedAmount: "8200", fundingReference: "NEFT-BETA" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmFunding(investor, listing.id, { fundedAmount: "999999", fundingReference: "NEFT-ALPHA" })).rejects.toMatchObject({ code: "VALIDATION" });
    await confirmFunding(investor, listing.id, { fundedAmount: "8000", fundingReference: "NEFT-ALPHA-1" });

    const req = await prisma.discountRequest.findUniqueOrThrow({ where: { id: listing.id } });
    const due = req.dueDate.toISOString().slice(0, 10);
    const before = await computeAndStoreTrust(f.owner.orgId, f.owner.userId);

    expect((await runDefaultCheck(addDays(due, 15))).defaultsCreated).toHaveLength(0); // exactly 15 days: not yet
    const first = await runDefaultCheck(addDays(due, 16));
    const second = await runDefaultCheck(addDays(due, 17));
    expect(first.defaultsCreated).toEqual([listing.id]);
    expect(second.defaultsCreated).toEqual([]);
    expect(await prisma.trustScoreAdjustment.count({ where: { orgId: f.owner.orgId } })).toBe(1);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.owner.orgId } })).riskFlag).toBe("HIGH_RISK");

    const after = await computeAndStoreTrust(f.owner.orgId, f.owner.userId);
    expect(after.adjustmentTotal).toBe(-50);
    expect(after.score).toBe(Math.max(300, after.baseScore - 50));
    expect(after.score).toBeGreaterThanOrEqual(300);
    expect(before.adjustmentTotal).toBe(0);

    // An unresolved default blocks new financing.
    const b = await sale("1000", 45);
    expect((await validateInvoiceForDiscounting(f.owner, b.bill.id)).reasons.join(" ")).toMatch(/unresolved default/);

    // Settling clears the default (penalty stays in history) and the risk flag.
    await recordSettlement(f.owner, listing.id, { amount: req.invoiceAmount.toString(), routing: "TO_FINANCIER", settledOn: T, reserveReleased: "0" });
    expect((await prisma.discountRequest.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe("SETTLED");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: f.owner.orgId } })).riskFlag).toBe("NORMAL");
    expect(await prisma.trustScoreAdjustment.count({ where: { orgId: f.owner.orgId } })).toBe(1);
  });

  it("trust score is cached, deterministic and bounded", async () => {
    const a = await currentTrust(f.owner.orgId, f.owner.userId);
    const b = await currentTrust(f.owner.orgId, f.owner.userId);
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThanOrEqual(300);
    expect(a.score).toBeLessThanOrEqual(900);
  });
});

describe("credit matchmaker", () => {
  it("indicative offers only; lenders see anonymised profiles only after consent", async () => {
    const partner = await prisma.lendingPartner.create({ data: { name: "Test Bank (fictional)", isDemo: true } });
    await prisma.loanProduct.create({ data: { lendingPartnerId: partner.id, name: "Starter line", minTrustScore: 300, maxInterestRatePercent: "16", maxLoanAmount: "100000", minAnnualTurnover: "1000" } });
    const m = await matchLoanOffers(f.owner);
    expect(m.disclaimer).toMatch(/not a loan approval/i);
    const p = m.products.find((x) => x.productName === "Starter line")!;
    expect(p.eligible).toBe(true);
    await setCreditSharing(f.owner, false);
    await expect(expressInterest(f.owner, p.offerId!)).rejects.toMatchObject({ code: "CONFLICT" });
    await setCreditSharing(f.owner, true);
    await expressInterest(f.owner, p.offerId!);

    const lenderOrg = await prisma.organization.create({ data: { name: "Bank desk", type: "FINANCIER", lendingPartnerId: partner.id } });
    const lender: SessionContext = { userId: investor.userId, displayName: "Lender", orgId: lenderOrg.id, orgName: "Bank desk", orgType: "FINANCIER", role: "LENDER_BANK", settings: f.owner.settings, lendingPartnerId: partner.id };
    const profiles = await lenderProfiles(lender);
    expect(profiles).toHaveLength(1);
    const json = JSON.stringify(profiles);
    expect(json).not.toContain("Kerala Fresh Mart");
    expect(json).not.toContain(f.owner.orgName);
    expect(profiles[0]!.applicant).toMatch(/^MSME-[0-9A-F]{8}$/);
  });
});
