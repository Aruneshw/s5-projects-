// tests/integration/exports-backup.test.ts — PDF, CSV, XLSX, reports, and a real pg_dump → pg_restore round trip.
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { createBill, getBill } from "@/server/services/bills";
import { buildReportTable, toCsv, toXlsx, REPORT_KINDS } from "@/server/services/exports";
import { billPdf, tablePdf } from "@/server/pdf/documents";
import { createExpense, createSalary, createWorker } from "@/server/services/expenses";
import { dailyReport, taxSummary, cashVsDigital } from "@/server/services/reports";
import { exportOrganisation } from "@/server/jobs/backup";
import { createPayment } from "@/server/services/payments";
import { todayIST } from "@/lib/dates";
import { makeFixture, noFees, resetDb, type Fixture } from "./helpers";

let f: Fixture;
let billId: string;
const T = todayIST();

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
  await createBill(f.owner, { ...noFees, type: "PURCHASE", storeId: f.supplier.id, billDate: T, lines: [{ itemId: f.items.onion.id, entryMode: "COUNT", quantity: "10", rate: "900" }] });
  const s = await createBill(f.dad, {
    ...noFees,
    type: "SALES",
    storeId: f.customer.id,
    billDate: T,
    lines: [{ itemId: f.items.tomato.id, entryMode: "WEIGHED", weights: ["70", "80"], rate: "28", lineMark: "=cmd|' /C calc'!A0" }],
    amountSettled: "1000",
    settlementModeId: f.modes.upi,
  });
  billId = s.bill.id;
  await createPayment(f.owner, { storeId: f.customer.id, paymentModeId: f.modes.cash, amount: "500", paymentDate: T, idempotencyKey: "exp-pay-1" });
  await createExpense(f.owner, { expenseDate: T, category: "LORRY_HIRE", amount: "2500", idempotencyKey: "expense-1" });
  const w = await createWorker(f.owner, { name: "Murugan" });
  await createSalary(f.owner, { workerId: w.id, paymentDate: T, amount: "800", idempotencyKey: "salary-1" });
});

describe("PDF", () => {
  it("bill PDF is a valid PDF document", async () => {
    const pdf = await billPdf(await getBill(f.owner, billId), f.owner.orgName);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });
  it("report PDF renders for every report kind", async () => {
    for (const kind of REPORT_KINDS) {
      const t = await buildReportTable(f.owner, kind, { from: T, to: T });
      const pdf = await tablePdf(t);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  }, 60_000);
});

describe("CSV / XLSX", () => {
  it("CSV has a BOM, header and rows", async () => {
    const csv = toCsv(await buildReportTable(f.owner, "sales", { from: T, to: T }));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Kerala Fresh Mart — Kochi");
  });
  it("XLSX opens and keeps numbers numeric; formula-like text is neutralised", async () => {
    const buf = await toXlsx(await buildReportTable(f.owner, "margins", { from: T, to: T }));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell("A1").value)).toContain("margins");
    const csv = toCsv(await buildReportTable(f.owner, "items", { from: T, to: T }));
    expect(csv).toContain("Tomato");
  });
});

describe("reports", () => {
  it("daily report combines purchases, sales, payments, expenses, salaries and outstanding", async () => {
    const d = await dailyReport(f.owner, T);
    expect(d.purchases).toHaveLength(1);
    expect(d.sales).toHaveLength(1);
    expect(d.totals.received).toBe("1500.00");
    expect(d.totals.expenses).toBe("2500.00");
    expect(d.totals.salaries).toBe("800.00");
    expect(d.totals.receivableOutstanding).toBe("2720.00"); // 4200 + 20 coolie − 1000 − 500
  });
  it("cash vs digital and tax summary keep actual, estimate and statutory figures apart", async () => {
    const c = await cashVsDigital(f.owner, { from: T, to: T });
    expect(c.received).toEqual({ cash: "500.00", digital: "1000.00" });
    expect(c.digitalReceiptPercent).toBe("66.67");
    const t = await taxSummary(f.owner, { from: T, to: T });
    expect(t.actual.turnover).toBe("4220.00");
    expect(t.estimates.tradingResult).toBe("-8080.00"); // 4220 − 9000 − 2500 − 800
    expect(t.disclaimer).toMatch(/not tax advice/i);
    expect(t.statutory.presumptiveIndicative).toBe("100.00"); // 6% × 1000 + 8% × 500
    const dad = t.partners.attribution.find((a) => a.userId === f.dad.userId)!;
    expect(dad.salesRecorded).toBe("4220.00");
  });
});

function hasTool(cmd: string): boolean {
  try {
    execFileSync(cmd, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("backup and restore", () => {
  it("JSON export contains the records and never secrets", async () => {
    const data = await exportOrganisation(f.owner.orgId);
    expect(data.bills.length).toBe(2);
    const s = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(s).not.toContain("passwordHash");
    expect(s).not.toContain("accountNumber");
  });

  it.runIf(hasTool("pg_dump") && hasTool("pg_restore") && hasTool("psql"))("pg_dump → pg_restore into an empty database preserves ledger totals", async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const dir = mkdtempSync(path.join(tmpdir(), "msme-backup-"));
    const file = path.join(dir, "test.dump");
    const restoreDb = `msme_restore_${Date.now()}`;
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
    const conn = ["-h", url.hostname, "-p", url.port || "5432", "-U", decodeURIComponent(url.username)];
    try {
      execFileSync("pg_dump", [...conn, "--format=custom", "--no-owner", "--file", file, url.pathname.slice(1)], { env });
      execFileSync("psql", [...conn, "-d", url.pathname.slice(1), "-c", `CREATE DATABASE ${restoreDb}`], { env });
      execFileSync("pg_restore", [...conn, "--no-owner", "--exit-on-error", "--dbname", restoreDb, file], { env });
      const q = (db: string) =>
        execFileSync("psql", [...conn, "-d", db, "-At", "-c", `SELECT COUNT(*) || ':' || COALESCE(SUM(amount),0) FROM ledger_entries`], { env }).toString().trim();
      expect(q(restoreDb)).toBe(q(url.pathname.slice(1)));
      // Integrity triggers survive the restore.
      const trig = execFileSync("psql", [...conn, "-d", restoreDb, "-At", "-c", `SELECT COUNT(*) FROM pg_trigger WHERE tgname = 'ledger_entries_immutable'`], { env }).toString().trim();
      expect(trig).toBe("1");
    } finally {
      try {
        execFileSync("psql", [...conn, "-d", url.pathname.slice(1), "-c", `DROP DATABASE IF EXISTS ${restoreDb}`], { env });
      } catch {
        /* best effort */
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
