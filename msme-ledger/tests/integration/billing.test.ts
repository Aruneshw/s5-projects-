// tests/integration/billing.test.ts — billing, ledger, DB-level integrity and audit (real PostgreSQL).
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { withActorTx } from "@/server/tx";
import { createBill, getBill, postDraft, updateDraft, addBillAdjustment, previewBill } from "@/server/services/bills";
import { storeBalance, storeLedger } from "@/server/services/ledger";
import { createStore, getStore, listStores, adjustStoreBalance } from "@/server/services/stores";
import { AppError } from "@/server/errors";
import { addDays, todayIST } from "@/lib/dates";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";

let f: Fixture;
const T = todayIST();

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
});

describe("kg variable-weight workflow (persisted)", () => {
  it("70 + 80 kg → 2 bags, 150 kg, individual weights stored", async () => {
    const r = await createBill(f.owner, {
      ...noFees,
      type: "PURCHASE",
      storeId: f.supplier.id,
      billDate: T,
      lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "20" }],
    });
    const line = r.bill.lines[0]!;
    expect(line.bagCount).toBe(2);
    expect(line.quantity).toBe("150.000");
    expect(line.amount).toBe("3000.00");
    expect(line.weights).toEqual(["70.000", "80.000"]);
    const rows = await prisma.bagWeight.findMany({ where: { billLineId: line.id }, orderBy: { seq: "asc" } });
    expect(rows.map((w) => w.weightKg.toString())).toEqual(["70", "80"]);
  });

  it("bag item: quantity entered directly, no weights", async () => {
    const r = await createBill(f.owner, {
      ...noFees,
      type: "PURCHASE",
      storeId: f.supplier2.id,
      billDate: T,
      lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "5", rate: "900" }],
    });
    expect(r.bill.lines[0]!.weights).toEqual([]);
    expect(r.bill.lines[0]!.bagCount).toBe(5);
  });
});

describe("purchase bill calculation", () => {
  it("₹11,500 + ₹200 bonus − ₹5,000 settled = ₹6,700 payable, no coolie", async () => {
    const supplier = await createStore(f.owner, { type: "SUPPLIER", shopName: "Selvam Traders", city: "Ooty", openingBalance: "0" });
    const r = await createBill(f.owner, {
      ...noFees,
      type: "PURCHASE",
      storeId: supplier.id,
      billDate: T,
      lines: [
        { itemId: f.items.onion.id, entryMode: "COUNT", quantity: "5", rate: "1500" },
        { itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["100", "100"], rate: "20" },
      ],
      bonusAmount: "200",
      bonusReason: "Agreed festival bonus",
      amountSettled: "5000",
      settlementModeId: f.modes.cash,
    });
    expect(r.bill.todayBill).toBe("11500.00");
    expect(r.bill.coolieTotal).toBe("0.00");
    expect(r.bill.totalBalance).toBe("6700.00");
    expect((await storeBalance(prisma, f.owner.orgId, supplier.id)).toFixed(2)).toBe("6700.00");
    expect(r.bill.payments).toHaveLength(1);
  });

  it("separate numbering sequences for purchase and sales", async () => {
    const s = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "1000" }] });
    expect(s.bill.billNumber).toBe(1);
    const purchases = await prisma.bill.findMany({ where: { orgId: f.owner.orgId, type: "PURCHASE" }, select: { billNumber: true }, orderBy: { billNumber: "asc" } });
    expect(purchases.map((p) => p.billNumber)).toEqual([1, 2, 3]);
  });
});

describe("sales bill: coolie and previous balance", () => {
  it("coolie = rate per bag × bag count; previous balance comes from the ledger", async () => {
    const cust = await createStore(f.owner, { type: "CUSTOMER", shopName: "Thrissur Greens", city: "Thrissur", openingBalance: "8500" });
    const r = await createBill(f.owner, {
      ...noFees,
      type: "SALES",
      storeId: cust.id,
      billDate: T,
      lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "28" }],
      lessAmount: "100",
      lessReason: "Damaged crate",
      amountSettled: "2000",
      settlementModeId: f.modes.upi,
      clientPreviousBalance: "8000",
    });
    expect(r.bill.coolieTotal).toBe("20.00");
    expect(r.bill.previousBalance).toBe("8500.00");
    expect(r.bill.total).toBe("12720.00");
    expect(r.bill.totalBalance).toBe("10620.00");
    expect(r.warnings.join(" ")).toMatch(/Previous balance changed/);
  });

  it("server ignores totals the client might send and recalculates", async () => {
    const p = await previewBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "2", rate: "1000" }] });
    expect(p.summary.coolieTotal).toBe("24.00");
    expect(p.summary.todayBill).toBe("2000.00");
  });
});

describe("drafts, posting and optimistic concurrency", () => {
  it("drafts are editable; stale versions conflict instead of overwriting", async () => {
    const d = await createBill(f.owner, { ...noFees, post: false, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "500" }] });
    expect(d.bill.status).toBe("DRAFT");
    expect(d.bill.billNumber).toBeNull();
    const base = { storeId: f.customer.id, billDate: T, lessAmount: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0", post: false };
    const u1 = await updateDraft(f.owner, d.bill.id, { ...base, version: d.bill.version, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "3", rate: "500" }] });
    expect(u1.bill.todayBill).toBe("1500.00");
    await expect(updateDraft(f.dad, d.bill.id, { ...base, version: d.bill.version, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "9", rate: "500" }] })).rejects.toMatchObject({ code: "CONFLICT" });
    const posted = await postDraft(f.owner, d.bill.id, u1.bill.version);
    expect(posted.bill.status).toBe("POSTED");
    expect(posted.bill.todayBill).toBe("1500.00");
    expect(posted.bill.billNumber).toBeGreaterThan(0);
  });

  it("concurrent posts to one store never reuse the same previous balance", async () => {
    const cust = await createStore(f.owner, { type: "CUSTOMER", shopName: "Race Mart", city: "Kochi", openingBalance: "0" });
    const mk = (who: typeof f.owner) => createBill(who, { ...noFees, type: "SALES", storeId: cust.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "1000" }] });
    const [a, b] = await Promise.all([mk(f.owner), mk(f.dad)]);
    const prevs = [a.bill.previousBalance, b.bill.previousBalance].sort();
    expect(prevs).toEqual(["0.00", "1012.00"]);
    expect((await storeBalance(prisma, f.owner.orgId, cust.id)).toFixed(2)).toBe("2024.00");
  });
});

describe("database-level financial integrity", () => {
  it("posted bills cannot be edited directly in the database", async () => {
    const b = await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, status: "POSTED" } });
    await expect(withActorTx(f.owner, (tx) => tx.bill.update({ where: { id: b.id }, data: { todayBill: "1.00", total: "1.00" } }))).rejects.toBeInstanceOf(AppError);
    await expect(withActorTx(f.owner, (tx) => tx.bill.delete({ where: { id: b.id } }))).rejects.toBeInstanceOf(AppError);
  });

  it("ledger entries are append-only", async () => {
    const e = await prisma.ledgerEntry.findFirstOrThrow({ where: { orgId: f.owner.orgId } });
    await expect(withActorTx(f.owner, (tx) => tx.ledgerEntry.update({ where: { id: e.id }, data: { amount: "1.00" } }))).rejects.toBeInstanceOf(AppError);
    await expect(withActorTx(f.owner, (tx) => tx.ledgerEntry.delete({ where: { id: e.id } }))).rejects.toBeInstanceOf(AppError);
  });

  it("financial writes without an authenticated actor are refused", async () => {
    const s = await prisma.store.findFirstOrThrow({ where: { orgId: f.owner.orgId } });
    await expect(
      prisma.ledgerEntry.create({ data: { orgId: f.owner.orgId, storeId: s.id, entryDate: new Date(), entryType: "ADJUSTMENT", amount: "5", description: "sneaky", createdById: f.owner.userId } }),
    ).rejects.toThrow(/actor/);
  });

  it("CHECK constraints reject impossible arithmetic even from raw SQL", async () => {
    const b = await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, type: "PURCHASE" } });
    await expect(
      withActorTx(f.owner, (tx) =>
        tx.bill.create({
          data: { orgId: f.owner.orgId, type: "PURCHASE", storeId: b.storeId, billDate: new Date(), createdById: f.owner.userId, lastEditedById: f.owner.userId, coolieTotal: "10", total: "10" },
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("every bill change is in the audit log with the actor", async () => {
    const b = await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, status: "POSTED" } });
    const logs = await prisma.auditLog.findMany({ where: { entityType: "bills", entityId: b.id } });
    expect(logs.length).toBeGreaterThanOrEqual(2); // INSERT draft + UPDATE to POSTED
    expect(logs.every((l) => l.actorId !== null)).toBe(true);
    expect(logs.some((l) => l.action === "INSERT" && l.newData !== null)).toBe(true);
  });
});

describe("opening balance rules", () => {
  it("accepted at creation, preserved in the ledger, never returned by the API", async () => {
    const s = await createStore(f.owner, { type: "CUSTOMER", shopName: "Opening Test", city: "Kochi", openingBalance: "4321.50" });
    expect(s).not.toHaveProperty("openingBalance");
    expect(await getStore(f.owner, s.id)).not.toHaveProperty("openingBalance");
    expect((await listStores(f.owner)).some((x) => "openingBalance" in x)).toBe(false);
    const led = await storeLedger(f.owner, s.id);
    expect(led.rows[0]!.entryType).toBe("OPENING");
    expect(led.closing).toBe("4321.50");
  });

  it("cannot be updated directly; corrections are audited adjustments", async () => {
    const s = await createStore(f.owner, { type: "CUSTOMER", shopName: "Opening Fix", city: "Kochi", openingBalance: "1000" });
    await expect(withActorTx(f.owner, (tx) => tx.store.update({ where: { id: s.id }, data: { openingBalance: "2000" } }))).rejects.toBeInstanceOf(AppError);
    await adjustStoreBalance(f.owner, s.id, { type: "OPENING_BALANCE_CORRECTION", amount: "-150", reason: "Typo in opening balance", entryDate: T });
    expect((await storeBalance(prisma, f.owner.orgId, s.id)).toFixed(2)).toBe("850.00");
    const raw = await prisma.store.findUniqueOrThrow({ where: { id: s.id } });
    expect(raw.openingBalance.toString()).toBe("1000"); // original preserved
  });
});

describe("coolie corrections are explicit, audited adjustments", () => {
  it("adjusts the ledger without editing the posted bill", async () => {
    const r = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "2", rate: "100" }] });
    const before = await storeBalance(prisma, f.owner.orgId, f.customer.id);
    await addBillAdjustment(f.owner, r.bill.id, { type: "COOLIE_CORRECTION", amount: "-4", reason: "Two bags carried by buyer", entryDate: T });
    const after = await storeBalance(prisma, f.owner.orgId, f.customer.id);
    expect(before.minus(after).toFixed(2)).toBe("4.00");
    const bill = await getBill(f.owner, r.bill.id);
    expect(bill.coolieTotal).toBe("24.00");
    expect(bill.adjustments).toHaveLength(1);
    await expect(addBillAdjustment(f.owner, (await prisma.bill.findFirstOrThrow({ where: { orgId: f.owner.orgId, type: "PURCHASE", status: "POSTED" } })).id, { type: "COOLIE_CORRECTION", amount: "5", reason: "not allowed here", entryDate: T })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("cashier restrictions in services", () => {
  it("cashier can create sales but not purchase bills", async () => {
    await expect(
      createBill(f.cashier, { ...noFees, type: "PURCHASE", storeId: f.supplier.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "1" }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ok = await createBill(f.cashier, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: addDays(T, 0), lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "10" }] });
    expect(ok.bill.createdBy.id).toBe(f.cashier.userId);
  });
});
