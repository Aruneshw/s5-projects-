// tests/integration/security-routes.test.ts — authorisation enforced in the Route Handlers themselves.
// The session is replaced by a test double; everything after it (permission checks, org scoping,
// services, database) is the real code.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionContext } from "@/server/auth/session";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";
import { createBill } from "@/server/services/bills";
import { todayIST } from "@/lib/dates";

let current: SessionContext | null = null;

vi.mock("@/server/auth/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/auth/session")>();
  const { unauthenticated } = await import("@/server/errors");
  return {
    ...mod,
    getSessionContext: async () => current,
    requireSession: async () => {
      if (!current) throw unauthenticated();
      return current;
    },
    requireAuth: async (perm: Parameters<typeof mod.requirePermission>[1]) => {
      if (!current) throw unauthenticated();
      mod.requirePermission(current, perm);
      return current;
    },
  };
});

const reportsRoute = await import("@/app/api/reports/[kind]/route");
const exportsRoute = await import("@/app/api/exports/[kind]/route");
const discountRoute = await import("@/app/api/discounting/route");
const evaluateRoute = await import("@/app/api/discounting/evaluate/[billId]/route");
const creditRoute = await import("@/app/api/credit/offers/route");
const billRoute = await import("@/app/api/bills/[id]/route");
const billsRoute = await import("@/app/api/bills/route");
const paymentsRoute = await import("@/app/api/payments/route");
const teamRoute = await import("@/app/api/team/route");
const storesRoute = await import("@/app/api/stores/route");
const jobsRoute = await import("@/app/api/jobs/daily/route");

const url = (p: string) => `http://localhost:3000${p}`;
const get = (p: string) => new NextRequest(url(p));
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url(p), { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", ...headers } });
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

let f: Fixture;
let other: Fixture;
let billId: string;

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
  other = await makeFixture("Other Org");
  const b = await createBill(f.owner, { ...noFees, type: "SALES", storeId: f.customer.id, billDate: todayIST(), lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "10", rate: "1000" }] });
  billId = b.bill.id;
});

describe("authentication", () => {
  it("401 without a session, with a consistent JSON error", async () => {
    current = null;
    const res = await reportsRoute.GET(get("/api/reports/sales"), params({ kind: "sales" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHENTICATED", message: "Please sign in" } });
  });
});

describe("cashier is denied on the server", () => {
  it.each([
    ["reports", () => reportsRoute.GET(get("/api/reports/sales"), params({ kind: "sales" }))],
    ["tax report", () => reportsRoute.GET(get("/api/reports/tax"), params({ kind: "tax" }))],
    ["exports", () => exportsRoute.GET(get("/api/exports/sales?format=csv"), params({ kind: "sales" }))],
    ["discount list", () => discountRoute.GET(get("/api/discounting"), params({}))],
    ["discount evaluate", () => evaluateRoute.GET(get(`/api/discounting/evaluate/${billId}`), params({ billId }))],
    ["discount accept", () => discountRoute.POST(post("/api/discounting", { billId, expectedUpfrontPayout: "1", acceptTerms: true }), params({}))],
    ["credit offers", () => creditRoute.GET(get("/api/credit/offers"), params({}))],
    ["team management", () => teamRoute.GET(get("/api/team"), params({}))],
  ])("%s → 403", async (_name, call) => {
    current = f.cashier;
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("but can create sales bills and see only customers", async () => {
    current = f.cashier;
    const res = await billsRoute.POST(
      post("/api/bills", { ...noFees, type: "SALES", storeId: f.customer.id, billDate: todayIST(), lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "1", rate: "10" }] }),
      params({}),
    );
    expect(res.status).toBe(201);
    const stores = await (await storesRoute.GET(get("/api/stores?type=SUPPLIER"), params({}))).json();
    expect(stores.every((s: { type: string }) => s.type === "CUSTOMER")).toBe(true);
  });

  it("owner gets 200 on the same report", async () => {
    current = f.owner;
    const res = await reportsRoute.GET(get("/api/reports/sales"), params({ kind: "sales" }));
    expect(res.status).toBe(200);
  });
});

describe("organisation isolation", () => {
  it("another org's bill is a 404, not a 403 (existence is not revealed)", async () => {
    current = other.owner;
    const res = await billRoute.GET(get(`/api/bills/${billId}`), params({ id: billId }));
    expect(res.status).toBe(404);
  });

  it("cannot pay into another org's store", async () => {
    current = other.owner;
    const res = await paymentsRoute.POST(
      post("/api/payments", { storeId: f.customer.id, paymentModeId: other.modes.cash, amount: "10", paymentDate: todayIST(), idempotencyKey: "cross-org-1" }),
      params({}),
    );
    expect(res.status).toBe(404);
  });

  it("lists never include other organisations' data", async () => {
    current = other.owner;
    const res = await billsRoute.GET(get("/api/bills"), params({}));
    const rows = (await res.json()) as Array<{ id: string }>;
    expect(rows.find((r) => r.id === billId)).toBeUndefined();
  });
});

describe("request hygiene", () => {
  it("cross-site POSTs are blocked (CSRF defence)", async () => {
    current = f.owner;
    const res = await paymentsRoute.POST(
      post("/api/payments", { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "10", paymentDate: todayIST(), idempotencyKey: "csrf-1" }, { origin: "https://evil.example" }),
      params({}),
    );
    expect(res.status).toBe(403);
  });

  it("invalid input → 422 with field issues; malformed JSON → 400", async () => {
    current = f.owner;
    const bad = await paymentsRoute.POST(post("/api/payments", { storeId: "nope", amount: "-1" }), params({}));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.details.issues.length).toBeGreaterThan(0);
    const raw = new NextRequest(url("/api/payments"), { method: "POST", body: "{not json", headers: { origin: "http://localhost:3000", host: "localhost:3000" } });
    expect((await paymentsRoute.POST(raw, params({}))).status).toBe(400);
  });

  it("internal errors never leak stack traces", async () => {
    current = f.owner;
    const res = await billRoute.GET(get("/api/bills/not-a-uuid"), params({ id: "not-a-uuid" }));
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toMatch(/at \w+ \(|node_modules|prisma/i);
  });

  it("jobs endpoint requires the cron secret", async () => {
    const res = await jobsRoute.POST(new NextRequest(url("/api/jobs/daily"), { method: "POST" }));
    expect(res.status).toBe(401);
    const ok = await jobsRoute.POST(new NextRequest(url("/api/jobs/daily"), { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(ok.status).toBe(200);
  });
});
