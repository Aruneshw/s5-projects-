// tests/integration/traceability.test.ts — purchase→sale links, margins, stock, cancellation.
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { cancelBill, createBill, getBill, linkablePurchaseLines } from "@/server/services/bills";
import { storeBalance } from "@/server/services/ledger";
import { stockSummary, stockForRange } from "@/server/services/inventory";
import { createPayment } from "@/server/services/payments";
import { marginReport } from "@/server/services/reports";
import { todayIST } from "@/lib/dates";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";

let f: Fixture;
let purchaseLineId: string;
let purchaseBillId: string;
const T = todayIST();

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
  const p = await createBill(f.owner, {
    ...noFees,
    type: "PURCHASE",
    storeId: f.supplier.id,
    billDate: T,
    lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "22", lineMark: "A grade" }],
  });
  purchaseBillId = p.bill.id;
  purchaseLineId = p.bill.lines[0]!.id;
});

describe("linking sales to purchase sources", () => {
  it("rejects a link to a nonexistent purchase line", async () => {
    await expect(
      createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["10"], rate: "30", sourcePurchaseLineId: randomUUID() }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a link to an incompatible item", async () => {
    await expect(
      createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.carrot.id, entryMode: "WEIGHED", weights: ["10"], rate: "30", sourcePurchaseLineId: purchaseLineId }] }),
    ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/different item/) });
  });

  it("a link is a reference only — no purchase bill is created", async () => {
    const before = await prisma.bill.count({ where: { orgId: f.owner.orgId, type: "PURCHASE" } });
    const s = await createBill(f.owner, {
      ...noFees,
      type: "SALES",
      storeId: f.customer.id,
      billDate: T,
      lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["50", "50"], rate: "28", lineMark: "A grade", sourcePurchaseLineId: purchaseLineId }],
    });
    expect(await prisma.bill.count({ where: { orgId: f.owner.orgId, type: "PURCHASE" } })).toBe(before);
    expect(s.bill.lines[0]!.source).toMatchObject({ purchaseBillId, supplier: "Ganesh Farms — Oddanchatram", purchaseQuantity: "150.000" });
  });

  it("from the purchase line, all linked sales are visible", async () => {
    const p = await getBill(f.owner, purchaseBillId);
    expect(p.lines[0]!.soldLinks).toHaveLength(1);
    expect(p.lines[0]!.soldLinks[0]!.quantity).toBe("100.000");
    const linkable = await linkablePurchaseLines(f.owner, f.items.tomato.id);
    expect(linkable[0]!.remaining).toBe("50.000");
  });

  it("overselling a batch is blocked; an owner may approve and it is flagged", async () => {
    const line = { itemId: f.items.tomato.id, entryMode: "WEIGHED" as const, weights: ["60"], rate: "29", sourcePurchaseLineId: purchaseLineId };
    await expect(createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [line] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createBill(f.cashier, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ ...line, allowOversell: true }] })).rejects.toMatchObject({ code: "CONFLICT" });
    const ok = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ ...line, allowOversell: true }] });
    expect(ok.bill.lines[0]!.source!.oversold).toBe(true);
    expect(ok.warnings.join(" ")).toMatch(/flagged for reconciliation/);
  });
});

describe("margins", () => {
  it("are hidden unless explicitly requested by a permitted user", async () => {
    const sale = await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, type: "SALES" }, orderBy: { billNumber: "asc" } });
    const hidden = await getBill(f.owner, sale.id);
    expect(hidden.lines[0]!.margin).toBeNull();
    expect(hidden.lines[0]!.source).not.toHaveProperty("purchaseRate");
    // Hiding margins never hides quantities or invoice totals.
    expect(hidden.lines[0]!.quantity).toBe("100.000");
    expect(hidden.todayBill).toBe("2800.00");
    const shown = await getBill(f.owner, sale.id, { includeMargins: true });
    expect(shown.lines[0]!.margin).toEqual({ unitMargin: "6.00", grossMargin: "600.00" });
    const cashierView = await getBill(f.cashier, sale.id, { includeMargins: true });
    expect(cashierView.lines[0]!.margin).toBeNull();
  });

  it("margin report uses linked purchase rates", async () => {
    const r = await marginReport(f.owner, { from: T, to: T });
    const tomato = r.items.find((i) => i.name === "Tomato")!;
    // 100 kg × (28 − 22) + 60 kg × (29 − 22)
    expect(tomato.grossMargin).toBe("1020.00");
  });
});

describe("stock", () => {
  it("purchases add, sales subtract (+IN / −OUT)", async () => {
    const s = await stockSummary(f.owner);
    const tomato = s.find((x) => x.name === "Tomato")!;
    expect(tomato.quantity).toBe("-10.000"); // 150 − 100 − 60
    expect(tomato.negative).toBe(true);
    expect(tomato.oversoldFlag).toBe(true);
    const range = await stockForRange(f.owner, T, T);
    expect(range.find((x) => x.name === "Tomato")).toMatchObject({ opening: "0.000", inQty: "150.000", outQty: "160.000", closing: "-10.000" });
  });
});

describe("cancellation", () => {
  it("purchase with live linked sales cannot be cancelled", async () => {
    const p = await getBill(f.owner, purchaseBillId);
    await expect(cancelBill(f.owner, purchaseBillId, "Entered twice", p.version)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reverses stock and money, keeps history, keeps the payment as credit", async () => {
    const cust = f.customer.id;
    const s = await createBill(f.owner, {
      ...noFees,
      type: "SALES",
      storeId: cust,
      billDate: T,
      lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "3", rate: "1000" }],
      amountSettled: "500",
      settlementModeId: f.modes.cash,
    });
    const balBefore = await storeBalance(prisma, f.owner.orgId, cust);
    const onionBefore = (await stockSummary(f.owner)).find((x) => x.name === "Onion")!.quantity;
    const cancelled = await cancelBill(f.owner, s.bill.id, "Customer returned the whole lot", s.bill.version);
    expect(cancelled.status).toBe("CANCELLED");
    // bill charge (3000 + 36 coolie) reversed, the ₹500 payment remains as a credit
    const balAfter = await storeBalance(prisma, f.owner.orgId, cust);
    expect(balBefore.minus(balAfter).toFixed(2)).toBe("3036.00");
    expect((await stockSummary(f.owner)).find((x) => x.name === "Onion")!.quantity).toBe((Number(onionBefore) + 3).toFixed(3));
    // history kept
    const rows = await prisma.ledgerEntry.findMany({ where: { billId: s.bill.id } });
    expect(rows.filter((r) => r.entryType === "REVERSAL")).toHaveLength(2);
    expect(await prisma.bill.count({ where: { id: s.bill.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { billId: s.bill.id, status: "ACTIVE" } })).toBe(1);
    // cannot cancel twice
    await expect(cancelBill(f.owner, s.bill.id, "again please", cancelled.version)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cancelling a sale frees its linked purchase quantity", async () => {
    const before = (await linkablePurchaseLines(f.owner, f.items.tomato.id)).find((l) => l.purchaseLineId === purchaseLineId);
    expect(before).toBeUndefined(); // fully used (oversold)
    const sale = await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, type: "SALES", status: "POSTED", lines: { some: { sourceLink: { isNot: null } } } }, orderBy: { billNumber: "desc" } });
    await cancelBill(f.owner, sale.id, "Wrong customer", sale.version);
    const after = (await linkablePurchaseLines(f.owner, f.items.tomato.id)).find((l) => l.purchaseLineId === purchaseLineId);
    expect(after?.remaining).toBe("50.000");
  });

  it("payments are independent of bills and can be partial / multiple", async () => {
    const s = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "1000" }] });
    await createPayment(f.owner, { storeId: f.customer.id, billId: s.bill.id, paymentModeId: f.modes.upi, amount: "300", paymentDate: T, idempotencyKey: "partial-1" });
    await createPayment(f.owner, { storeId: f.customer.id, billId: s.bill.id, paymentModeId: f.modes.cash, amount: "200", paymentDate: T, idempotencyKey: "partial-2" });
    const b = await getBill(f.owner, s.bill.id);
    expect(b.payments.map((p) => p.amount)).toEqual(["300.00", "200.00"]);
  });
});
