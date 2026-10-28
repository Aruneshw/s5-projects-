// tests/integration/payments-sync.test.ts — idempotency, offline sync replay, conflicts.
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { createPayment, cancelPayment } from "@/server/services/payments";
import { createBill } from "@/server/services/bills";
import { storeBalance } from "@/server/services/ledger";
import { pull, push, listConflicts, resolveConflict } from "@/server/services/sync";
import { todayIST } from "@/lib/dates";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";

let f: Fixture;
const T = todayIST();

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
});

describe("payment idempotency", () => {
  it("re-submitting the same key returns the original payment", async () => {
    const input = { storeId: f.customer.id, paymentModeId: f.modes.upi, amount: "750", paymentDate: T, idempotencyKey: "tap-twice-001" };
    const a = await createPayment(f.owner, input);
    const b = await createPayment(f.owner, input);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(await prisma.payment.count({ where: { orgId: f.owner.orgId, idempotencyKey: "tap-twice-001" } })).toBe(1);
  });

  it("concurrent duplicates still produce exactly one payment and one ledger entry", async () => {
    const input = { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "100", paymentDate: T, idempotencyKey: "race-key-002" };
    const results = await Promise.all([createPayment(f.owner, input), createPayment(f.dad, input), createPayment(f.owner, input)]);
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    const p = await prisma.payment.findFirstOrThrow({ where: { idempotencyKey: "race-key-002" } });
    expect(await prisma.ledgerEntry.count({ where: { paymentId: p.id } })).toBe(1);
  });

  it("cancelling a payment reverses it and keeps it in history", async () => {
    const before = await storeBalance(prisma, f.owner.orgId, f.customer.id);
    const p = await createPayment(f.owner, { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "40", paymentDate: T, idempotencyKey: "to-cancel-1" });
    const c = await cancelPayment(f.owner, p.payment.id, "Entered against wrong shop");
    expect(c.status).toBe("CANCELLED");
    expect((await storeBalance(prisma, f.owner.orgId, f.customer.id)).toFixed(2)).toBe(before.toFixed(2));
    await expect(cancelPayment(f.owner, p.payment.id, "again please")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cashier cannot record supplier payments", async () => {
    await expect(createPayment(f.cashier, { storeId: f.supplier.id, paymentModeId: f.modes.cash, amount: "10", paymentDate: T, idempotencyKey: "cashier-sup-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("offline sync", () => {
  it("bills created offline sync after reconnection with no loss and no duplicates on retry", async () => {
    const billId = randomUUID();
    const mutation = {
      id: randomUUID(),
      type: "BILL_CREATE" as const,
      payload: { ...noFees, id: billId, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "28" }] },
    };
    const payMutation = { id: randomUUID(), type: "PAYMENT_CREATE" as const, payload: { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "1000", paymentDate: T } };
    const first = await push(f.owner, { deviceId: "phone-dad", mutations: [mutation, payMutation] });
    expect(first.map((r) => r.status)).toEqual(["APPLIED", "APPLIED"]);
    // Network dropped before the phone saw the response → it retries the same batch.
    const retry = await push(f.owner, { deviceId: "phone-dad", mutations: [mutation, payMutation] });
    expect(retry.every((r) => r.status === "APPLIED" && r.replayed)).toBe(true);
    expect(await prisma.bill.count({ where: { id: billId } })).toBe(1);
    expect(await prisma.payment.count({ where: { orgId: f.owner.orgId, idempotencyKey: `sync:${payMutation.id}` } })).toBe(1);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: { include: { weights: true } } } });
    expect(bill.source).toBe("OFFLINE_SYNC");
    expect(bill.lines[0]!.weights).toHaveLength(2);
  });

  it("concurrent draft edits from two phones become a recorded conflict, nothing is overwritten", async () => {
    const d = await createBill(f.owner, { ...noFees, post: false, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "500" }] });
    const edit = (qty: string) => ({
      billId: d.bill.id,
      version: d.bill.version,
      storeId: f.customer.id,
      billDate: T,
      lessAmount: "0",
      bonusAmount: "0",
      commissionPercent: "0",
      amountSettled: "0",
      post: false,
      lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: qty, rate: "500" }],
    });
    const me = await push(f.owner, { deviceId: "phone-me", mutations: [{ id: randomUUID(), type: "BILL_DRAFT_UPDATE", payload: edit("2") }] });
    const dadM = { id: randomUUID(), type: "BILL_DRAFT_UPDATE" as const, payload: edit("7") };
    const dad = await push(f.dad, { deviceId: "phone-dad", mutations: [dadM] });
    expect(me[0]!.status).toBe("APPLIED");
    expect(dad[0]!.status).toBe("CONFLICT");
    const server = await prisma.bill.findUniqueOrThrow({ where: { id: d.bill.id }, include: { lines: true } });
    expect(server.lines[0]!.quantity.toString()).toBe("2"); // first writer kept
    const conflicts = await listConflicts(f.owner);
    const c = conflicts.find((x) => x.id === dadM.id)!;
    expect(c.payload).toMatchObject({ lines: [{ quantity: "7" }] }); // the losing local edit is preserved
    expect(c.serverRecord).toBeTruthy();
    await resolveConflict(f.owner, dadM.id, "KEPT_SERVER");
    expect((await listConflicts(f.owner)).some((x) => x.id === dadM.id)).toBe(false);
  });

  it("invalid offline records are rejected with a reason and kept for review", async () => {
    const m = { id: randomUUID(), type: "BILL_CREATE" as const, payload: { ...noFees, id: randomUUID(), type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["-5"], rate: "10" }] } };
    const r = await push(f.owner, { deviceId: "phone-me", mutations: [m] });
    expect(r[0]!.status).toBe("REJECTED");
    expect(await prisma.syncMutation.count({ where: { id: m.id, status: "REJECTED" } })).toBe(1);
  });

  it("pull: full snapshot, then only changes after the cursor", async () => {
    const full = await pull(f.owner, null);
    expect(full.full).toBe(true);
    expect(full.stores.length).toBeGreaterThan(0);
    const again = await pull(f.owner, full.cursor);
    expect(again.bills).toHaveLength(0);
    await createPayment(f.owner, { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "5", paymentDate: T, idempotencyKey: "pull-test-1" });
    const b = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "5" }] });
    const delta = await pull(f.owner, full.cursor);
    expect(delta.bills.map((x) => x.id)).toEqual([b.bill.id]);
    expect(BigInt(delta.cursor)).toBeGreaterThan(BigInt(full.cursor));
    // A cashier's pull never contains suppliers.
    const cashierPull = await pull(f.cashier, null);
    expect(cashierPull.stores.every((s) => s.type === "CUSTOMER")).toBe(true);
  });
});
