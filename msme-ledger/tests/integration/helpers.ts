// tests/integration/helpers.ts — fixtures for integration tests against the TEST PostgreSQL database.
import { prisma } from "@/server/db";
import { withActorTx } from "@/server/tx";
import { createStore } from "@/server/services/stores";
import { createItem } from "@/server/services/items";
import { OrgSettingsSchema } from "@/lib/validation/settings";
import type { SessionContext } from "@/server/auth/session";
import { randomUUID } from "node:crypto";

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses row-level immutability triggers — acceptable ONLY for a throwaway test DB.
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export interface Fixture {
  owner: SessionContext;
  dad: SessionContext;
  cashier: SessionContext;
  supplier: { id: string };
  supplier2: { id: string };
  customer: { id: string };
  items: { tomato: { id: string }; onion: { id: string }; carrot: { id: string } };
  modes: { cash: string; upi: string };
}

export async function makeFixture(name = "Test Traders"): Promise<Fixture> {
  const settings = OrgSettingsSchema.parse({});
  const org = await prisma.organization.create({ data: { name: `${name} ${randomUUID().slice(0, 6)}`, settings: settings as object } });
  const mk = async (username: string, role: "MSME_OWNER" | "STAFF_CASHIER") => {
    const u = await prisma.user.create({ data: { username: `${username}-${randomUUID().slice(0, 8)}`, displayName: username, passwordHash: "x" } });
    await prisma.membership.create({ data: { userId: u.id, orgId: org.id, role } });
    const ctx: SessionContext = { userId: u.id, displayName: username, orgId: org.id, orgName: org.name, orgType: "MSME", role, settings, lendingPartnerId: null };
    return ctx;
  };
  const owner = await mk("me", "MSME_OWNER");
  const dad = await mk("dad", "MSME_OWNER");
  const cashier = await mk("cashier", "STAFF_CASHIER");
  await withActorTx(owner, (tx) =>
    tx.paymentMode.createMany({
      data: [
        { orgId: org.id, name: "Cash", isDigital: false },
        { orgId: org.id, name: "UPI", isDigital: true },
      ],
    }),
  );
  const modes = await prisma.paymentMode.findMany({ where: { orgId: org.id } });
  const supplier = await createStore(owner, { type: "SUPPLIER", shopName: "Ganesh Farms", city: "Oddanchatram", openingBalance: "0" });
  const supplier2 = await createStore(owner, { type: "SUPPLIER", shopName: "Lakshmi Agencies", city: "Mettupalayam", openingBalance: "0" });
  const customer = await createStore(owner, { type: "CUSTOMER", shopName: "Kerala Fresh Mart", city: "Kochi", openingBalance: "0" });
  const items = {
    tomato: await createItem(owner, { name: "Tomato", unitType: "KG", cooliePerBag: "10" }),
    onion: await createItem(owner, { name: "Onion", unitType: "BAG", cooliePerBag: "12" }),
    carrot: await createItem(owner, { name: "Carrot", unitType: "KG", cooliePerBag: "10" }),
  };
  return {
    owner,
    dad,
    cashier,
    supplier,
    supplier2,
    customer,
    items,
    modes: { cash: modes.find((m) => m.name === "Cash")!.id, upi: modes.find((m) => m.name === "UPI")!.id },
  };
}

export const noFees = { lessAmount: "0", bonusAmount: "0", commissionPercent: "0", amountSettled: "0", post: true } as const;
