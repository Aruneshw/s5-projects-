// src/server/pdf/documents.tsx
// Printable bill and report PDFs with @react-pdf/renderer.
// Note: the built-in Helvetica font has no "₹" glyph, so PDFs print amounts as "Rs. 12,345.00".
import "server-only";
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatINR, formatQty } from "@/lib/money";
import { formatDisplayDate } from "@/lib/dates";
import type { BillDto } from "../services/bills";
import type { Table } from "../services/exports";

const rs = (v: string) => `Rs. ${formatINR(v, { symbol: false })}`;

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#555" },
  row: { flexDirection: "row" },
  between: { flexDirection: "row", justifyContent: "space-between" },
  box: { borderWidth: 1, borderColor: "#999", padding: 6, marginTop: 8 },
  th: { fontFamily: "Helvetica-Bold", backgroundColor: "#eee", paddingVertical: 3, paddingHorizontal: 2 },
  td: { paddingVertical: 3, paddingHorizontal: 2, borderBottomWidth: 0.5, borderBottomColor: "#ccc" },
  right: { textAlign: "right" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  stamp: { marginTop: 8, padding: 4, borderWidth: 2, borderColor: "#b00", color: "#b00", fontFamily: "Helvetica-Bold", textAlign: "center" },
});

function SummaryRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.sumRow}>
      <Text style={bold ? s.bold : undefined}>{label}</Text>
      <Text style={bold ? s.bold : undefined}>{value}</Text>
    </View>
  );
}

export function BillDocument({ bill, orgName }: { bill: BillDto; orgName: string }) {
  const isSales = bill.type === "SALES";
  const cols = [
    { label: "#", w: "5%" },
    { label: "Item", w: "24%" },
    { label: "Mark", w: "9%" },
    { label: "Bags", w: "8%" },
    { label: "Qty", w: "14%" },
    { label: "Rate", w: "12%" },
    { label: "Amount", w: isSales ? "15%" : "28%" },
    ...(isSales ? [{ label: "Coolie", w: "13%" }] : []),
  ];
  return (
    <Document title={`${isSales ? "Sales" : "Purchase"} bill ${bill.billNumber ?? "draft"}`} author={orgName}>
      <Page size="A5" style={s.page}>
        <View style={s.between}>
          <View>
            <Text style={s.h1}>{orgName}</Text>
            <Text style={s.muted}>{isSales ? "SALES BILL" : "PURCHASE BILL"}</Text>
          </View>
          <View>
            <Text style={s.bold}>No. {bill.billNumber ?? "DRAFT"}</Text>
            <Text>Date: {formatDisplayDate(bill.billDate)}</Text>
            {bill.dueDate ? <Text>Due: {formatDisplayDate(bill.dueDate)}</Text> : null}
          </View>
        </View>
        <View style={s.box}>
          <Text style={s.bold}>{bill.store.label}</Text>
          {bill.store.storeMark ? <Text>Mark: {bill.store.storeMark}</Text> : null}
          {bill.store.phone ? <Text>Phone: {bill.store.phone}</Text> : null}
        </View>
        {bill.status === "CANCELLED" ? <Text style={s.stamp}>CANCELLED — {bill.cancelReason}</Text> : null}
        <View style={{ marginTop: 8 }}>
          <View style={s.row}>
            {cols.map((c) => (
              <Text key={c.label} style={[s.th, { width: c.w }]}>
                {c.label}
              </Text>
            ))}
          </View>
          {bill.lines.map((l) => (
            <View key={l.id} style={s.row} wrap={false}>
              <Text style={[s.td, { width: "5%" }]}>{l.lineNo}</Text>
              <View style={[s.td, { width: "24%" }]}>
                <Text>{l.item.name}</Text>
                {l.weights.length ? <Text style={s.muted}>{l.weights.join(" + ")}</Text> : null}
              </View>
              <Text style={[s.td, { width: "9%" }]}>{l.lineMark ?? ""}</Text>
              <Text style={[s.td, s.right, { width: "8%" }]}>{l.bagCount}</Text>
              <Text style={[s.td, s.right, { width: "14%" }]}>{formatQty(l.quantity, l.item.unitType === "KG" ? "kg" : l.item.unitType.toLowerCase())}</Text>
              <Text style={[s.td, s.right, { width: "12%" }]}>{formatINR(l.rate, { symbol: false })}</Text>
              <Text style={[s.td, s.right, { width: isSales ? "15%" : "28%" }]}>{formatINR(l.amount, { symbol: false })}</Text>
              {isSales ? <Text style={[s.td, s.right, { width: "13%" }]}>{formatINR(l.coolieAmount, { symbol: false })}</Text> : null}
            </View>
          ))}
        </View>
        <View style={[s.box, { marginLeft: "40%" }]}>
          {isSales ? <SummaryRow label="Coolie" value={rs(bill.coolieTotal)} /> : null}
          <SummaryRow label="Today's Bill" value={rs(bill.todayBill)} />
          <SummaryRow label="Previous Bill Balance" value={rs(bill.previousBalance)} />
          <SummaryRow label="Total" value={rs(bill.total)} bold />
          {Number(bill.lessAmount) > 0 ? <SummaryRow label={`Less (${bill.lessReason ?? ""})`} value={`- ${rs(bill.lessAmount)}`} /> : null}
          {Number(bill.bonusAmount) > 0 ? <SummaryRow label={`Bonus (${bill.bonusReason ?? ""})`} value={`+ ${rs(bill.bonusAmount)}`} /> : null}
          {Number(bill.commissionAmount) > 0 ? (
            <SummaryRow label={`Commission ${bill.commissionPercent}%`} value={`${isSales ? "+" : "-"} ${rs(bill.commissionAmount)}`} />
          ) : null}
          <SummaryRow label={isSales ? "Amount Received" : "Amount Settled"} value={`- ${rs(bill.amountSettled)}`} />
          <SummaryRow label="Total Balance" value={rs(bill.totalBalance)} bold />
        </View>
        {bill.adjustments.length ? (
          <View style={{ marginTop: 6 }}>
            <Text style={s.bold}>Adjustments after billing</Text>
            {bill.adjustments.map((a) => (
              <Text key={a.id}>
                {a.type}: {rs(a.amount)} — {a.reason}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={[s.muted, { marginTop: 10 }]}>
          Prepared by {bill.createdBy.name}. Computer-generated bill.
        </Text>
      </Page>
    </Document>
  );
}

export function TableDocument({ table }: { table: Table }) {
  const w = `${(100 / Math.max(1, table.columns.length)).toFixed(2)}%`;
  return (
    <Document title={table.title}>
      <Page size="A4" orientation={table.columns.length > 6 ? "landscape" : "portrait"} style={s.page}>
        <Text style={s.h1}>{table.title}</Text>
        {table.subtitle ? <Text style={[s.muted, { marginBottom: 8 }]}>{table.subtitle}</Text> : null}
        <View style={s.row} fixed>
          {table.columns.map((c) => (
            <Text key={c.key} style={[s.th, { width: w }, c.kind && c.kind !== "text" ? s.right : {}]}>
              {c.label.replace("₹", "Rs.")}
            </Text>
          ))}
        </View>
        {table.rows.length === 0 ? <Text style={{ marginTop: 6 }}>No records for this period.</Text> : null}
        {table.rows.map((r, i) => (
          <View key={i} style={s.row} wrap={false}>
            {table.columns.map((c) => {
              const v = r[c.key];
              const text = v === null || v === undefined ? "" : c.kind === "money" ? formatINR(String(v), { symbol: false }) : String(v).replace("₹", "Rs.");
              return (
                <Text key={c.key} style={[s.td, { width: w }, c.kind && c.kind !== "text" ? s.right : {}]}>
                  {text}
                </Text>
              );
            })}
          </View>
        ))}
        <Text style={[s.muted, { marginTop: 10 }]} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}

export async function billPdf(bill: BillDto, orgName: string): Promise<Buffer> {
  return renderToBuffer(<BillDocument bill={bill} orgName={orgName} />);
}

export async function tablePdf(table: Table): Promise<Buffer> {
  return renderToBuffer(<TableDocument table={table} />);
}
