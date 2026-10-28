// tests/unit/offline-sync.test.ts — persistent queue, retries with backoff, conflicts kept, no data loss.
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { localDb } from "@/offline/db";
import { backoffDelay, configureSync, enqueue, processQueue, recoverInterrupted, summary } from "@/offline/sync-engine";

type Handler = (body: { mutations: Array<{ id: string; type: string }> }) => Response | Promise<Response>;
function fakeFetch(handler: Handler): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("/api/sync/pull")) return new Response(JSON.stringify({ full: false, cursor: "1", stores: [], items: [], paymentModes: [], bills: [] }), { status: 200 });
    return handler(JSON.parse(String(init?.body)));
  }) as typeof fetch;
}

beforeEach(async () => {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  await localDb().mutations.clear();
  await localDb().drafts.clear();
});

describe("offline queue", () => {
  it("queued records survive until the server confirms them", async () => {
    await enqueue("BILL_CREATE", { id: "b1" }, "bill 1");
    await enqueue("PAYMENT_CREATE", { amount: "10" }, "pay 1");
    expect((await summary()).pending).toBe(2); // offline: nothing sent, nothing lost

    (globalThis.navigator as { onLine: boolean }).onLine = true;
    await expect(processQueue(fakeFetch(() => { throw new TypeError("Failed to fetch"); }))).resolves.toMatchObject({ applied: 0 });
    const afterFail = await localDb().mutations.toArray();
    expect(afterFail.every((m) => m.status === "pending" && m.attempts === 1 && m.nextAttemptAt > Date.now())).toBe(true);

    await localDb().mutations.toCollection().modify({ nextAttemptAt: 0 });
    const r = await processQueue(fakeFetch(({ mutations }) => new Response(JSON.stringify({ results: mutations.map((m) => ({ id: m.id, status: "APPLIED", result: {} })) }))));
    expect(r.applied).toBe(2);
    expect((await summary()).pending).toBe(0);
  });

  it("conflicts are kept on the phone for a decision, never silently dropped", async () => {
    (globalThis.navigator as { onLine: boolean }).onLine = true;
    configureSync({ fetch: fakeFetch(({ mutations }) => new Response(JSON.stringify({ results: mutations.map((m) => ({ id: m.id, status: "CONFLICT", error: { code: "CONFLICT", message: "changed elsewhere" } })) }))) });
    await enqueue("BILL_DRAFT_UPDATE", { billId: "x" }, "edit"); // online → pushes immediately
    await processQueue();
    const [m] = await localDb().mutations.toArray();
    expect(m).toMatchObject({ status: "conflict", lastError: "changed elsewhere" });
    expect((await summary()).attention).toBe(1);
  });

  it("items stuck in 'syncing' after a crash are resent (safe: idempotent ids)", async () => {
    await enqueue("PAYMENT_CREATE", {}, "p");
    await localDb().mutations.toCollection().modify({ status: "syncing" });
    await recoverInterrupted();
    expect((await summary()).pending).toBe(1);
  });

  it("backoff grows exponentially and is capped", () => {
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(2)).toBe(4000);
    expect(backoffDelay(20)).toBe(300000);
  });
});
