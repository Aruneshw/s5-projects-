// src/offline/db.ts — the device's local database (IndexedDB via Dexie).
// Each phone has its OWN copy; phones never share IndexedDB. They converge through the server.
import Dexie, { type EntityTable } from "dexie";

export type MutationType = "BILL_CREATE" | "BILL_DRAFT_UPDATE" | "PAYMENT_CREATE" | "EXPENSE_CREATE";
export type MutationStatus = "pending" | "syncing" | "synced" | "conflict" | "error";

export interface LocalMutation {
  id: string; // client UUID = idempotency key on the server
  type: MutationType;
  payload: unknown;
  status: MutationStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  result: unknown;
  createdAt: number;
  label: string; // human description for the sync screen
}

export interface LocalDraft {
  id: string; // the bill's client UUID
  type: "PURCHASE" | "SALES";
  form: unknown; // the bill-entry form state, including individual bag weights
  updatedAt: number;
}

export interface CachedStore {
  id: string;
  type: "SUPPLIER" | "CUSTOMER";
  shopName: string;
  city: string;
  label: string;
  phone: string | null;
  isActive: boolean;
}

export interface CachedItem {
  id: string;
  name: string;
  unitType: "KG" | "BAG" | "BOX";
  cooliePerBag: string;
  isActive: boolean;
}

export interface CachedMode {
  id: string;
  name: string;
  isDigital: boolean;
}

export interface CachedBill {
  id: string;
  type: "PURCHASE" | "SALES";
  status: string;
  billNumber: number | null;
  billDate: string;
  party: string;
  storeId: string;
  totalBalance: string;
  invoiceAmount: string;
  paymentStatus: string | null;
}

export interface Meta {
  key: string;
  value: string;
}

export class LedgerDB extends Dexie {
  mutations!: EntityTable<LocalMutation, "id">;
  drafts!: EntityTable<LocalDraft, "id">;
  stores!: EntityTable<CachedStore, "id">;
  items!: EntityTable<CachedItem, "id">;
  modes!: EntityTable<CachedMode, "id">;
  bills!: EntityTable<CachedBill, "id">;
  meta!: EntityTable<Meta, "key">;

  constructor(name = "msme-ledger") {
    super(name);
    this.version(1).stores({
      mutations: "id, status, nextAttemptAt, createdAt",
      drafts: "id, type, updatedAt",
      stores: "id, type, shopName",
      items: "id, name",
      modes: "id",
      bills: "id, billDate, storeId",
      meta: "key",
    });
  }
}

let instance: LedgerDB | null = null;
export function localDb(): LedgerDB {
  if (!instance) instance = new LedgerDB();
  return instance;
}

/** Called on logout: a shared phone must not keep another user's cached data. */
export async function wipeLocal(): Promise<void> {
  const db = localDb();
  const pending = await db.mutations.where("status").anyOf("pending", "syncing", "conflict", "error").count();
  if (pending > 0) return; // never destroy unsynced financial records
  await db.delete();
  instance = null;
}
