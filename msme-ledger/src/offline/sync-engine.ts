// src/offline/sync-engine.ts — persistent queue + push/pull with exponential backoff.
//
// Guarantees:
//  * Every queued record has a client UUID. The server treats it as an idempotency key, so a
//    retry after a dropped response never creates a duplicate bill or payment.
//  * Records leave the queue only after the server confirms APPLIED. CONFLICT / REJECTED
//    records stay on the device (status "conflict"/"error") until a person resolves them.
//  * Totals are always recalculated by the server; the device only shows previews.
import { localDb, type LocalMutation, type MutationType } from "./db";

export const BATCH = 20;
const BASE_DELAY = 2_000;
const MAX_DELAY = 5 * 60_000;

export function backoffDelay(attempts: number): number {
  return Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.max(0, attempts - 1));
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function deviceId(): Promise<string> {
  const db = localDb();
  const row = await db.meta.get("deviceId");
  if (row) return row.value;
  const id = `dev-${newId()}`;
  await db.meta.put({ key: "deviceId", value: id });
  return id;
}

// The HTTP client is injectable so the engine can be tested without a server.
let fetcher: typeof fetch = (...args) => fetch(...args);
export function configureSync(opts: { fetch: typeof fetch }): void {
  fetcher = opts.fetch;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onSyncChange(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit() {
  listeners.forEach((l) => l());
}

export async function enqueue(type: MutationType, payload: unknown, label: string, id: string = newId()): Promise<string> {
  await localDb().mutations.put({ id, type, payload, status: "pending", attempts: 0, nextAttemptAt: 0, lastError: null, result: null, createdAt: Date.now(), label });
  emit();
  void processQueue();
  return id;
}

/** After a crash mid-sync, "syncing" items are safe to resend (idempotent). */
export async function recoverInterrupted(): Promise<void> {
  await localDb().mutations.where("status").equals("syncing").modify({ status: "pending" });
}

type PushResult =
  | { id: string; status: "APPLIED"; result: unknown }
  | { id: string; status: "CONFLICT" | "REJECTED"; error: { code: string; message: string } }
  | { id: string; status: "RETRY"; error: { message: string } };

let inFlight: Promise<{ sent: number; applied: number }> | null = null;

/** Push due records. Concurrent callers share the same run (never two pushes at once). */
export function processQueue(fetchImpl: typeof fetch = fetcher): Promise<{ sent: number; applied: number }> {
  if (inFlight) return inFlight;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve({ sent: 0, applied: 0 });
  inFlight = runQueue(fetchImpl).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runQueue(fetchImpl: typeof fetch): Promise<{ sent: number; applied: number }> {
  const db = localDb();
  let sent = 0;
  let applied = 0;
  try {
    for (;;) {
      const now = Date.now();
      const due = (await db.mutations.where("status").equals("pending").sortBy("createdAt")).filter((m) => m.nextAttemptAt <= now).slice(0, BATCH);
      if (due.length === 0) break;
      await db.mutations.bulkUpdate(due.map((m) => ({ key: m.id, changes: { status: "syncing" as const } })));
      emit();
      let results: PushResult[];
      try {
        const res = await fetchImpl("/api/sync/push", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ deviceId: await deviceId(), mutations: due.map((m) => ({ id: m.id, type: m.type, payload: m.payload, clientCreatedAt: new Date(m.createdAt).toISOString() })) }),
        });
        if (res.status === 401) {
          await requeue(due, "Sign in again to sync");
          break;
        }
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        results = ((await res.json()) as { results: PushResult[] }).results;
      } catch (e) {
        await requeue(due, e instanceof Error ? e.message : "Network error");
        break;
      }
      sent += due.length;
      for (const r of results) {
        const m = due.find((x) => x.id === r.id);
        if (!m) continue;
        if (r.status === "APPLIED") {
          applied++;
          await db.mutations.update(m.id, { status: "synced", result: r.result, lastError: null });
          if (m.type === "BILL_CREATE") await db.drafts.delete((m.payload as { id: string }).id);
        } else if (r.status === "RETRY") {
          await db.mutations.update(m.id, { status: "pending", attempts: m.attempts + 1, nextAttemptAt: Date.now() + backoffDelay(m.attempts + 1), lastError: r.error.message });
        } else {
          await db.mutations.update(m.id, { status: r.status === "CONFLICT" ? "conflict" : "error", lastError: r.error.message, result: r });
        }
      }
      emit();
    }
  } finally {
    emit();
  }
  if (applied > 0) await pull(fetchImpl).catch(() => undefined);
  return { sent, applied };
}

async function requeue(items: LocalMutation[], error: string) {
  const db = localDb();
  await db.mutations.bulkUpdate(
    items.map((m) => ({ key: m.id, changes: { status: "pending" as const, attempts: m.attempts + 1, nextAttemptAt: Date.now() + backoffDelay(m.attempts + 1), lastError: error } })),
  );
  emit();
}

interface PullResponse {
  full: boolean;
  cursor: string;
  hasMore?: boolean;
  stores: Array<{ id: string; type: "SUPPLIER" | "CUSTOMER"; shopName: string; city: string; label: string; phone: string | null; isActive: boolean }>;
  items: Array<{ id: string; name: string; unitType: "KG" | "BAG" | "BOX"; cooliePerBag: string; isActive: boolean }>;
  paymentModes: Array<{ id: string; name: string; isDigital: boolean }>;
  bills: Array<{ id: string; type: "PURCHASE" | "SALES"; status: string; billNumber: number | null; billDate: string; party: string; storeId: string; totalBalance: string; invoiceAmount: string; paymentStatus: string | null }>;
}

/** Download changes since the stored cursor into the local cache. */
export async function pull(fetchImpl: typeof fetch = fetcher): Promise<void> {
  const db = localDb();
  for (let i = 0; i < 10; i++) {
    const cursor = (await db.meta.get("cursor"))?.value ?? "0";
    const res = await fetchImpl(`/api/sync/pull?cursor=${encodeURIComponent(cursor)}`, { credentials: "same-origin" });
    if (!res.ok) return;
    const data = (await res.json()) as PullResponse;
    await db.transaction("rw", [db.stores, db.items, db.modes, db.bills, db.meta], async () => {
      if (data.full) {
        await Promise.all([db.stores.clear(), db.items.clear(), db.modes.clear(), db.bills.clear()]);
      }
      await db.stores.bulkPut(data.stores.map((s) => ({ id: s.id, type: s.type, shopName: s.shopName, city: s.city, label: s.label, phone: s.phone, isActive: s.isActive })));
      await db.items.bulkPut(data.items);
      if (data.paymentModes.length) {
        await db.modes.clear();
        await db.modes.bulkPut(data.paymentModes);
      }
      await db.bills.bulkPut(
        data.bills.map((b) => ({ id: b.id, type: b.type, status: b.status, billNumber: b.billNumber, billDate: b.billDate, party: b.party, storeId: b.storeId, totalBalance: b.totalBalance, invoiceAmount: b.invoiceAmount, paymentStatus: b.paymentStatus })),
      );
      await db.meta.put({ key: "cursor", value: data.cursor });
      await db.meta.put({ key: "lastPullAt", value: String(Date.now()) });
    });
    emit();
    if (!data.hasMore) return;
  }
}

export interface SyncSummary {
  pending: number;
  syncing: number;
  attention: number;
  lastPullAt: number | null;
}

export async function summary(): Promise<SyncSummary> {
  const db = localDb();
  const [pending, syncing, conflicts, errors, last] = await Promise.all([
    db.mutations.where("status").equals("pending").count(),
    db.mutations.where("status").equals("syncing").count(),
    db.mutations.where("status").equals("conflict").count(),
    db.mutations.where("status").equals("error").count(),
    db.meta.get("lastPullAt"),
  ]);
  return { pending, syncing, attention: conflicts + errors, lastPullAt: last ? Number(last.value) : null };
}

/** User decision on a conflicted / rejected record. Local data is only dropped on explicit request. */
export async function resolveLocal(id: string, action: "retry" | "discard"): Promise<void> {
  const db = localDb();
  const m = await db.mutations.get(id);
  if (!m) return;
  if (action === "retry") {
    // A NEW mutation id is required: the server remembers the outcome of the old one.
    await db.mutations.delete(id);
    await enqueue(m.type, m.payload, m.label);
    await fetcher(`/api/sync/conflicts/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolution: "RESUBMITTED" }) }).catch(() => undefined);
  } else {
    await db.mutations.delete(id);
    await fetcher(`/api/sync/conflicts/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolution: "DISCARDED_LOCAL" }) }).catch(() => undefined);
  }
  emit();
}
