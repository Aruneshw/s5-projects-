// src/server/services/exports.ts
// Turn reports into tables, then into CSV / XLSX. (PDF lives in src/server/pdf.)
import "server-only";
import ExcelJS from "exceljs";
import { balanceReport, billSummary, cashVsDigital, dailyReport, expenseReport, itemWiseReport, marginReport, taxSummary } from "./reports";
import { stockSummary } from "./inventory";
import type { SessionContext } from "../auth/session";

export interface Column {
  key: string;
  label: string;
  kind?: "text" | "money" | "qty" | "int";
}
export interface Table {
  title: string;
  subtitle?: string;
  columns: Column[];
  rows: Array<Record<string, string | number | null>>;
}

export const REPORT_KINDS = ["daily", "sales", "purchases", "customer-balances", "supplier-balances", "items", "cash-digital", "expenses", "margins", "tax", "stock"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/**
 * Spreadsheet formula-injection guard (OWASP "CSV injection"): a cell that begins with
 * = + - @ or a tab/CR could be executed by Excel. Prefix such TEXT cells with an apostrophe.
 * Numeric money values like "-120.00" are recognised as numbers and left untouched.
 */
export function safeCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(t: Table): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [t.columns.map((c) => esc(c.label)).join(",")];
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(safeCell(r[c.key]))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens ₹ / Tamil text correctly
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MSME Ledger";
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, " "));
  ws.addRow([t.title]).font = { bold: true, size: 13 };
  if (t.subtitle) ws.addRow([t.subtitle]);
  ws.addRow([]);
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.font = { bold: true };
  for (const r of t.rows) {
    ws.addRow(
      t.columns.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined) return "";
        if ((c.kind === "money" || c.kind === "qty" || c.kind === "int") && /^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
        return safeCell(v);
      }),
    );
  }
  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(10, c.label.length + 4));
    if (c.kind === "money") col.numFmt = "#,##,##0.00";
    if (c.kind === "qty") col.numFmt = "0.000";
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

type Ctx = Pick<SessionContext, "orgId" | "settings" | "orgName">;

export async function buildReportTable(ctx: Ctx, kind: ReportKind, r: { from: string; to: string }): Promise<Table> {
  const sub = `${ctx.orgName} · ${r.from} to ${r.to}`;
  switch (kind) {
    case "daily": {
      const d = await dailyReport(ctx, r.to);
      const rows = [
        ...d.purchases.map((p) => ({ section: "Purchase", ref: `#${p.billNumber}`, party: p.party, amount: p.charge, by: p.by })),
        ...d.sales.map((s) => ({ section: "Sale", ref: `#${s.billNumber}`, party: s.party, amount: s.charge, by: s.by })),
        ...d.payments.map((p) => ({ section: p.direction === "RECEIVED" ? "Received" : "Paid", ref: p.mode, party: p.party, amount: p.amount, by: p.by })),
        ...d.expenses.map((e) => ({ section: "Expense", ref: e.category, party: e.notes ?? "", amount: e.amount, by: "" })),
        ...d.salaries.map((s) => ({ section: "Salary", ref: "", party: s.worker, amount: s.amount, by: "" })),
      ];
      return {
        title: `Daily report ${d.date}`,
        subtitle: `${ctx.orgName} · Receivable ${d.totals.receivableOutstanding} · Payable ${d.totals.payableOutstanding}`,
        columns: [
          { key: "section", label: "Type" },
          { key: "ref", label: "Ref" },
          { key: "party", label: "Party / note" },
          { key: "amount", label: "Amount (₹)", kind: "money" },
          { key: "by", label: "Recorded by" },
        ],
        rows,
      };
    }
    case "sales":
    case "purchases": {
      const s = await billSummary(ctx, r, kind === "sales" ? "SALES" : "PURCHASE");
      return {
        title: kind === "sales" ? "Sales summary" : "Purchase summary",
        subtitle: `${sub} · ${s.count} bills · ₹${s.total}`,
        columns: [
          { key: "party", label: "Party" },
          { key: "count", label: "Bills", kind: "int" },
          { key: "value", label: "Value (₹)", kind: "money" },
        ],
        rows: s.byParty,
      };
    }
    case "customer-balances":
    case "supplier-balances": {
      const rows = await balanceReport(ctx, kind === "customer-balances" ? "CUSTOMER" : "SUPPLIER");
      return {
        title: kind === "customer-balances" ? "Customer balances (receivable)" : "Supplier balances (payable)",
        subtitle: ctx.orgName,
        columns: [
          { key: "shopName", label: "Shop" },
          { key: "city", label: "City" },
          { key: "balance", label: "Balance (₹)", kind: "money" },
          { key: "overdueAmount", label: "Overdue (₹)", kind: "money" },
          { key: "overdueDays", label: "Days overdue", kind: "int" },
          { key: "lastActivity", label: "Last activity" },
        ],
        rows: rows.map((x) => ({ ...x, alert: x.alert ? "yes" : "" })),
      };
    }
    case "items": {
      const rows = await itemWiseReport(ctx, r);
      return {
        title: "Item-wise quantity and value",
        subtitle: sub,
        columns: [
          { key: "name", label: "Item" },
          { key: "unitType", label: "Unit" },
          { key: "purchasedQty", label: "Bought qty", kind: "qty" },
          { key: "purchasedBags", label: "Bought bags", kind: "int" },
          { key: "purchasedValue", label: "Bought (₹)", kind: "money" },
          { key: "soldQty", label: "Sold qty", kind: "qty" },
          { key: "soldBags", label: "Sold bags", kind: "int" },
          { key: "soldValue", label: "Sold (₹)", kind: "money" },
          { key: "coolie", label: "Coolie (₹)", kind: "money" },
        ],
        rows,
      };
    }
    case "cash-digital": {
      const c = await cashVsDigital(ctx, r);
      return {
        title: "Cash vs digital payments",
        subtitle: `${sub} · Digital receipts ${c.digitalReceiptPercent}%`,
        columns: [
          { key: "mode", label: "Mode" },
          { key: "kind", label: "Type" },
          { key: "received", label: "Received (₹)", kind: "money" },
          { key: "paid", label: "Paid (₹)", kind: "money" },
        ],
        rows: c.byMode.map((m) => ({ mode: m.mode, kind: m.isDigital ? "Digital" : "Cash", received: m.received, paid: m.paid })),
      };
    }
    case "expenses": {
      const e = await expenseReport(ctx, r);
      return {
        title: "Expenses and worker salaries",
        subtitle: `${sub} · Expenses ₹${e.expenseTotal} · Salaries ₹${e.salaryTotal}`,
        columns: [
          { key: "group", label: "Group" },
          { key: "name", label: "Category / worker" },
          { key: "amount", label: "Amount (₹)", kind: "money" },
        ],
        rows: [
          ...e.byCategory.map((x) => ({ group: "Expense", name: x.category, amount: x.amount })),
          ...e.salaries.map((x) => ({ group: "Salary", name: x.worker, amount: x.amount })),
        ],
      };
    }
    case "margins": {
      const m = await marginReport(ctx, r);
      return {
        title: "Item margins (linked purchase sources)",
        subtitle: `${sub} · Gross margin ₹${m.totalGrossMargin}`,
        columns: [
          { key: "saleDate", label: "Date" },
          { key: "salesBillNumber", label: "Sale #", kind: "int" },
          { key: "customer", label: "Customer" },
          { key: "item", label: "Item" },
          { key: "lineMark", label: "Mark" },
          { key: "quantity", label: "Qty", kind: "qty" },
          { key: "salesRate", label: "Sale rate", kind: "money" },
          { key: "purchaseRate", label: "Buy rate", kind: "money" },
          { key: "supplier", label: "Supplier" },
          { key: "unitMargin", label: "Unit margin", kind: "money" },
          { key: "grossMargin", label: "Gross margin", kind: "money" },
        ],
        rows: m.lines,
      };
    }
    case "tax": {
      const t = await taxSummary(ctx, r);
      const row = (section: string, label: string, value: string) => ({ section, label, value });
      return {
        title: "Tax summary (for discussion with your CA)",
        subtitle: `${sub} · ${t.disclaimer}`,
        columns: [
          { key: "section", label: "Section" },
          { key: "label", label: "Figure" },
          { key: "value", label: "Value" },
        ],
        rows: [
          row("Actual", "Turnover (₹)", t.actual.turnover),
          row("Actual", "Purchases (₹)", t.actual.purchases),
          row("Actual", "Expenses (₹)", t.actual.expenses),
          row("Actual", "Worker salaries (₹)", t.actual.workerSalaries),
          row("Actual", "Digital receipts %", t.actual.digitalReceiptPercent),
          row("Estimate", "Trading result (₹)", t.estimates.tradingResult),
          row("Estimate", "Linked gross margin (₹)", t.estimates.linkedGrossMargin),
          row("Indicator", "Presumptive (indicative) (₹)", t.statutory.presumptiveIndicative),
          row("Indicator", "Turnover limit applied (₹)", t.statutory.turnoverLimitApplied),
          row("Indicator", "Within limit", t.statutory.turnoverWithinLimit ? "Yes" : "No"),
          ...t.partners.attribution.map((a) => row("Partner", `Sales recorded by ${a.name} (₹)`, a.salesRecorded)),
          ...t.partners.allocation.map((a) => row("Partner", `${a.name} share ${a.percent}% of trading result (₹)`, a.tradingResultShare)),
        ],
      };
    }
    case "stock": {
      const s = await stockSummary(ctx, r.to);
      return {
        title: `Stock as of ${r.to}`,
        subtitle: ctx.orgName,
        columns: [
          { key: "name", label: "Item" },
          { key: "quantity", label: "Quantity", kind: "qty" },
          { key: "unit", label: "Unit" },
          { key: "bagCount", label: "Bags", kind: "int" },
          { key: "lastPurchaseDate", label: "Last purchase" },
          { key: "flag", label: "Alert" },
        ],
        rows: s.map((x) => ({ name: x.name, quantity: x.quantity, unit: x.unit, bagCount: x.bagCount, lastPurchaseDate: x.lastPurchaseDate, flag: x.negative ? "NEGATIVE" : x.stale ? "STALE" : x.oversoldFlag ? "OVERSOLD" : "" })),
      };
    }
  }
}
