// prisma/seed.ts — FICTIONAL demo data for local development only.
// Run: npm run db:seed   (uses SEED_*_PASSWORD from .env; refuses to run in production)
// Everything is created through the real services, so the seed also exercises the business rules.
import "dotenv/config";
import { prisma } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";
import { withActorTx } from "../src/server/tx";
import { createStore } from "../src/server/services/stores";
import { createItem } from "../src/server/services/items";
import { createBill } from "../src/server/services/bills";
import { createPayment } from "../src/server/services/payments";
import { createExpense, createSalary, createWorker } from "../src/server/services/expenses";
import { OrgSettingsSchema } from "../src/lib/validation/settings";
import { addDays, todayIST } from "../src/lib/dates";
import type { SessionContext } from "../src/server/auth/session";
import type { BillInputSchema } from "../src/lib/validation/schemas";
import type { z } from "zod";

function need(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("REPLACE_ME")) throw new Error(`Set ${name} in .env before seeding`);
  return v;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database");
  if (await prisma.organization.findFirst({ where: { name: "Sri Murugan Vegetable Traders (demo)" } })) {
    console.log("Demo data already present — run `npm run db:reset` first to re-seed.");
    return;
  }

  const [ownerPw, dadPw, cashierPw] = (await Promise.all([need("SEED_OWNER_PASSWORD"), need("SEED_DAD_PASSWORD"), need("SEED_CASHIER_PASSWORD")].map(hashPassword))) as [string, string, string];

  // ----------------------------- Users & organisations -----------------------------
  const me = await prisma.user.create({ data: { username: "me", displayName: "Me", passwordHash: ownerPw, profile: { create: { phone: "9000000001" } } } });
  const dad = await prisma.user.create({ data: { username: "dad", displayName: "Dad", passwordHash: dadPw, profile: { create: { phone: "9000000002" } } } });
  const cashier = await prisma.user.create({ data: { username: "cashier", displayName: "Market Cashier", passwordHash: cashierPw } });
  const investorUser = await prisma.user.create({ data: { username: "investor", displayName: "Demo Investor", passwordHash: ownerPw } });
  const lenderUser = await prisma.user.create({ data: { username: "lender", displayName: "Demo Lender Officer", passwordHash: ownerPw } });

  const settings = OrgSettingsSchema.parse({ profitAllocation: { [me.id]: 50, [dad.id]: 50 } });
  const org = await prisma.organization.create({ data: { name: "Sri Murugan Vegetable Traders (demo)", type: "MSME", settings: settings as object, shareCreditProfile: true } });
  await prisma.membership.createMany({
    data: [
      { userId: me.id, orgId: org.id, role: "MSME_OWNER" },
      { userId: dad.id, orgId: org.id, role: "MSME_OWNER" },
      { userId: cashier.id, orgId: org.id, role: "STAFF_CASHIER" },
    ],
  });

  const partner = await prisma.lendingPartner.create({ data: { name: "Demo Co-operative Bank (fictional)", isDemo: true } });
  await prisma.loanProduct.createMany({
    data: [
      { lendingPartnerId: partner.id, name: "Working Capital Line (demo)", minTrustScore: 600, maxInterestRatePercent: "14.00", maxLoanAmount: "500000.00", minAnnualTurnover: "100000.00", minMonthsHistory: 1 },
      { lendingPartnerId: partner.id, name: "Premium Trade Credit (demo)", minTrustScore: 780, maxInterestRatePercent: "11.50", maxLoanAmount: "1500000.00", minAnnualTurnover: "2500000.00", minMonthsHistory: 6 },
    ],
  });
  const investorOrg = await prisma.organization.create({ data: { name: "Demo Capital (fictional)", type: "FINANCIER" } });
  const lenderOrg = await prisma.organization.create({ data: { name: "Demo Co-operative Bank desk", type: "FINANCIER", lendingPartnerId: partner.id } });
  await prisma.membership.create({ data: { userId: investorUser.id, orgId: investorOrg.id, role: "INVESTOR" } });
  await prisma.membership.create({ data: { userId: lenderUser.id, orgId: lenderOrg.id, role: "LENDER_BANK" } });

  const meCtx: SessionContext = { userId: me.id, displayName: "Me", orgId: org.id, orgName: org.name, orgType: "MSME", role: "MSME_OWNER", settings, lendingPartnerId: null };
  const dadCtx: SessionContext = { ...meCtx, userId: dad.id, displayName: "Dad" };

  await withActorTx(meCtx, (tx) =>
    tx.paymentMode.createMany({
      data: [
        { orgId: org.id, name: "Cash", isDigital: false },
        { orgId: org.id, name: "UPI", isDigital: true },
        { orgId: org.id, name: "Bank transfer", isDigital: true },
        { orgId: org.id, name: "Cheque (account payee)", isDigital: true },
      ],
    }),
  );
  const modes = await prisma.paymentMode.findMany({ where: { orgId: org.id } });
  const mode = (n: string) => modes.find((m) => m.name === n)!.id;

  // ----------------------------------- Masters --------------------------------------
  const sup = {
    ganesh: await createStore(meCtx, { type: "SUPPLIER", shopName: "Ganesh Farms", city: "Oddanchatram", ownerName: "K. Ganesan", phone: "9000000101", storeMark: "GF", openingBalance: "12000.00" }),
    lakshmi: await createStore(meCtx, { type: "SUPPLIER", shopName: "Lakshmi Agencies", city: "Mettupalayam", ownerName: "R. Lakshmi", phone: "9000000102", storeMark: "LA", openingBalance: "0" }),
    selvam: await createStore(dadCtx, { type: "SUPPLIER", shopName: "Selvam Traders", city: "Ooty", phone: "9000000103", storeMark: "ST", openingBalance: "0" }),
  };
  const cust = {
    kochi: await createStore(meCtx, { type: "CUSTOMER", shopName: "Kerala Fresh Mart", city: "Kochi", ownerName: "Joseph M.", phone: "9000000201", upiId: "keralafresh@upi", storeMark: "KFM", openingBalance: "8500.00" }),
    calicut: await createStore(dadCtx, { type: "CUSTOMER", shopName: "Malabar Veg Stores", city: "Kozhikode", phone: "9000000202", storeMark: "MVS", openingBalance: "0" }),
    thrissur: await createStore(meCtx, { type: "CUSTOMER", shopName: "Thrissur Greens", city: "Thrissur", phone: "9000000203", storeMark: "TG", openingBalance: "0" }),
  };
  const items = {
    tomato: await createItem(meCtx, { name: "Tomato", unitType: "KG", cooliePerBag: "10" }),
    carrot: await createItem(meCtx, { name: "Carrot", unitType: "KG", cooliePerBag: "10" }),
    cabbage: await createItem(meCtx, { name: "Cabbage", unitType: "KG", cooliePerBag: "8" }),
    onion: await createItem(meCtx, { name: "Onion", unitType: "BAG", cooliePerBag: "12" }),
    potato: await createItem(meCtx, { name: "Potato", unitType: "BAG", cooliePerBag: "12" }),
    beans: await createItem(meCtx, { name: "Beans", unitType: "BOX", cooliePerBag: "15" }),
  };
  const w1 = await createWorker(meCtx, { name: "Murugan", phone: "9000000301" });
  const w2 = await createWorker(meCtx, { name: "Ravi", phone: null });

  // ----------------------------------- Bills ----------------------------------------
  const T = todayIST();
  const base = { lessAmount: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0", post: true } as const;
  const bill = (ctx: SessionContext, b: z.input<typeof BillInputSchema>) => createBill(ctx, { ...base, ...b });

  // Purchases over the last ~2 months (on supplier credit, partly settled).
  const p1 = await bill(meCtx, {
    type: "PURCHASE", storeId: sup.ganesh.id, billDate: addDays(T, -50),
    lines: [
      { itemId: items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80", "75.5"], rate: "22", lineMark: "A" },
      { itemId: items.carrot.id, entryMode: "WEIGHED", weights: ["50", "52"], rate: "30", lineMark: "Ooty" },
    ],
    amountSettled: "3000", settlementModeId: mode("Cash"),
  });
  const p2 = await bill(dadCtx, {
    type: "PURCHASE", storeId: sup.lakshmi.id, billDate: addDays(T, -20),
    lines: [
      { itemId: items.onion.id, entryMode: "COUNT", quantity: "20", rate: "900" },
      { itemId: items.potato.id, entryMode: "COUNT", quantity: "10", rate: "1100" },
    ],
    bonusAmount: "200", bonusReason: "Festival bonus agreed with supplier", amountSettled: "5000", settlementModeId: mode("UPI"),
  });
  const p3 = await bill(meCtx, {
    type: "PURCHASE", storeId: sup.selvam.id, billDate: addDays(T, -3),
    lines: [
      { itemId: items.cabbage.id, entryMode: "WEIGHED", weights: ["60", "62", "58", "61"], rate: "14", lineMark: "Big" },
      { itemId: items.beans.id, entryMode: "COUNT", quantity: "12", rate: "650" },
      { itemId: items.tomato.id, entryMode: "WEIGHED", weights: ["72", "68"], rate: "24", lineMark: "B" },
    ],
  });

  const pl = (b: Awaited<ReturnType<typeof bill>>, n: number) => b.bill.lines[n]!.id;

  // Sales to Kerala buyers, linked to purchase batches for real margins.
  const s1 = await bill(meCtx, {
    type: "SALES", storeId: cust.kochi.id, billDate: addDays(T, -48), dueDate: addDays(T, -18),
    lines: [
      { itemId: items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "28", lineMark: "A", sourcePurchaseLineId: pl(p1, 0) },
      { itemId: items.carrot.id, entryMode: "COMBINED_LOT", quantity: "100", bagCount: 2, rate: "36", sourcePurchaseLineId: pl(p1, 1) },
    ],
  });
  await bill(dadCtx, {
    type: "SALES", storeId: cust.calicut.id, billDate: addDays(T, -18), dueDate: addDays(T, 12),
    lines: [
      { itemId: items.onion.id, entryMode: "COUNT", quantity: "12", rate: "1000", sourcePurchaseLineId: pl(p2, 0) },
      { itemId: items.potato.id, entryMode: "COUNT", quantity: "6", rate: "1250", sourcePurchaseLineId: pl(p2, 1) },
    ],
    amountSettled: "4000", settlementModeId: mode("Bank transfer"),
  });
  await bill(meCtx, {
    type: "SALES", storeId: cust.thrissur.id, billDate: addDays(T, -2), dueDate: addDays(T, 40),
    lines: [
      { itemId: items.cabbage.id, entryMode: "WEIGHED", weights: ["60", "62"], rate: "19", lineMark: "Big", sourcePurchaseLineId: pl(p3, 0) },
      { itemId: items.beans.id, entryMode: "COUNT", quantity: "10", rate: "760", sourcePurchaseLineId: pl(p3, 1) },
      { itemId: items.tomato.id, entryMode: "WEIGHED", weights: ["72", "68"], rate: "30", lineMark: "B", sourcePurchaseLineId: pl(p3, 2) },
    ],
  });

  // Partial payments recorded after billing.
  await createPayment(meCtx, { storeId: cust.kochi.id, billId: s1.bill.id, paymentModeId: mode("UPI"), amount: "5000", paymentDate: addDays(T, -30), idempotencyKey: "seed-pay-1", reference: "UPI-DEMO-1" });
  await createPayment(meCtx, { storeId: cust.kochi.id, paymentModeId: mode("Cash"), amount: "3500", paymentDate: addDays(T, -15), idempotencyKey: "seed-pay-2" });
  await createPayment(dadCtx, { storeId: sup.ganesh.id, paymentModeId: mode("Bank transfer"), amount: "6000", paymentDate: addDays(T, -10), idempotencyKey: "seed-pay-3", reference: "NEFT-DEMO" });

  // Expenses and salaries (kept separate from coolie).
  await createExpense(meCtx, { expenseDate: addDays(T, -48), category: "LORRY_HIRE", amount: "4500", notes: "Oddanchatram → Kochi", paymentModeId: mode("Cash"), idempotencyKey: "seed-exp-1" });
  await createExpense(dadCtx, { expenseDate: addDays(T, -18), category: "FUEL", amount: "1800", paymentModeId: mode("UPI"), idempotencyKey: "seed-exp-2" });
  await createExpense(meCtx, { expenseDate: addDays(T, -2), category: "TOLLS", amount: "640", paymentModeId: mode("Cash"), idempotencyKey: "seed-exp-3" });
  await createSalary(meCtx, { workerId: w1.id, paymentDate: addDays(T, -30), amount: "12000", paymentModeId: mode("Cash"), idempotencyKey: "seed-sal-1" });
  await createSalary(meCtx, { workerId: w2.id, paymentDate: addDays(T, -30), amount: "9000", paymentModeId: mode("UPI"), idempotencyKey: "seed-sal-2" });

  console.log("Seeded fictional demo data.");
  console.log("Logins: me / dad (owners), cashier (cashier), investor, lender — passwords from your .env SEED_* values (investor and lender use SEED_OWNER_PASSWORD).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
