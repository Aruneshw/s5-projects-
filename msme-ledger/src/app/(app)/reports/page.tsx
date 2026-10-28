// src/app/(app)/reports/page.tsx — all reports with financial-year filter and CSV / XLSX / PDF export.
"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Card, CardTitle, PageHeader, Stat, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ErrorState, Loading, Empty } from "@/components/ui/states";
import { Money, today } from "@/components/common/format";
import { RequirePerm, Can } from "@/components/auth/can";
import { formatINR } from "@/lib/money";

const KINDS = [
  ["daily", "Daily"],
  ["sales", "Sales"],
  ["purchases", "Purchases"],
  ["customer-balances", "Customer balances"],
  ["supplier-balances", "Supplier balances"],
  ["items", "Item-wise"],
  ["cash-digital", "Cash vs digital"],
  ["expenses", "Expenses & salaries"],
  ["margins", "Item margins"],
  ["tax", "Tax summary"],
  ["stock", "Stock"],
] as const;
type Kind = (typeof KINDS)[number][0];

interface Table { title: string; subtitle?: string; columns: Array<{ key: string; label: string; kind?: string }>; rows: Array<Record<string, string | number | null>> }

function fyOptions(): string[] {
  const t = today();
  const y = Number(t.slice(0, 4)) - (Number(t.slice(5, 7)) < 4 ? 1 : 0);
  return [0, 1, 2].map((i) => `${y - i}-${String((y - i + 1) % 100).padStart(2, "0")}`);
}

function Reports() {
  const params = useSearchParams();
  const [kind, setKind] = useState<Kind>((params.get("tab") as Kind) ?? "daily");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [fy, setFy] = useState("");
  const qs = fy ? `fy=${fy}` : `from=${from}&to=${to}`;
  const table = useApi<Table>(["report", kind, qs], kind === "tax" ? null : `/api/exports/${kind}?format=json&${qs}`);
  return (
    <RequirePerm perm="report:read">
      <PageHeader title="Reports" subtitle="Actual figures from your ledger. Not a substitute for a Chartered Accountant." />
      <Card className="mb-3 grid gap-2 sm:grid-cols-4">
        <Select aria-label="Report" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="sm:col-span-4">
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select aria-label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
          <option value="">Custom dates</option>
          {fyOptions().map((f) => <option key={f} value={f}>FY {f}</option>)}
        </Select>
        <Input type="date" aria-label="From" value={from} disabled={!!fy} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" aria-label="To" value={to} disabled={!!fy} onChange={(e) => setTo(e.target.value)} />
        <Can perm="report:export">
          <div className="flex gap-1">
            {(["csv", "xlsx", "pdf"] as const).map((f) => (
              <Button key={f} variant="outline" size="sm" asChild className="flex-1">
                <a href={`/api/exports/${kind}?format=${f}&${qs}`}>{f === "csv" ? <FileText /> : f === "xlsx" ? <FileSpreadsheet /> : <FileDown />}{f.toUpperCase()}</a>
              </Button>
            ))}
          </div>
        </Can>
      </Card>
      {kind === "tax" ? <TaxView qs={qs} /> : null}
      {kind !== "tax" ? (
        table.isLoading ? <Loading /> : table.error ? <ErrorState error={table.error} /> : table.data ? (
          <Card>
            <CardTitle>{table.data.title}</CardTitle>
            {table.data.subtitle ? <p className="mb-2 text-sm text-muted">{table.data.subtitle}</p> : null}
            {table.data.rows.length === 0 ? <Empty title="Nothing in this period" /> : (
              <div className="overflow-x-auto">
                <table className="num w-full min-w-[520px] text-sm">
                  <thead><tr className="border-b border-line text-left text-xs text-muted">{table.data.columns.map((c) => <th key={c.key} className={`py-2 pr-2 ${c.kind && c.kind !== "text" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
                  <tbody className="divide-y divide-line">
                    {table.data.rows.map((r, i) => (
                      <tr key={i}>{table.data!.columns.map((c) => <td key={c.key} className={`py-2 pr-2 ${c.kind && c.kind !== "text" ? "text-right" : ""}`}>{c.kind === "money" && r[c.key] !== null ? formatINR(String(r[c.key])) : String(r[c.key] ?? "")}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null
      ) : null}
    </RequirePerm>
  );
}

interface Tax {
  disclaimer: string;
  actual: Record<string, string>;
  estimates: { tradingResult: string; tradingResultNote: string; linkedGrossMargin: string; linkedGrossMarginNote: string };
  statutory: { presumptiveIndicative: string; presumptiveNote: string; turnoverLimitApplied: string; cashReceiptSharePercent: string; turnoverWithinLimit: boolean; commissionWarning: string | null; gstNote: string };
  partners: { attribution: Array<{ userId: string; name: string; salesRecorded: string; billsRecorded: number }>; allocation: Array<{ userId: string; name: string; percent: number; tradingResultShare: string }>; allocationConfigured: boolean };
}

function TaxView({ qs }: { qs: string }) {
  const q = useApi<Tax>(["tax", qs], `/api/reports/tax?${qs}`);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const t = q.data!;
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-turmeric-100 p-3 text-sm text-turmeric-700">{t.disclaimer}</p>
      <Card>
        <CardTitle className="mb-2">1 · Actual figures <Badge tone="green">from ledger</Badge></CardTitle>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Turnover" value={<Money value={t.actual.turnover} />} />
          <Stat label="Purchases" value={<Money value={t.actual.purchases} />} />
          <Stat label="Expenses" value={<Money value={t.actual.expenses} />} />
          <Stat label="Worker salaries" value={<Money value={t.actual.workerSalaries} />} />
          <Stat label="Cash receipts" value={<Money value={t.actual.receiptsCash} />} />
          <Stat label="Digital receipts" value={<Money value={t.actual.receiptsDigital} />} />
          <Stat label="Digital %" value={`${t.actual.digitalReceiptPercent}%`} />
          <Stat label="Commission recorded" value={<Money value={t.actual.commissionRecorded} />} />
        </div>
      </Card>
      <Card>
        <CardTitle className="mb-2">2 · Calculated estimates <Badge tone="amber">not accounting profit</Badge></CardTitle>
        <p><strong><Money value={t.estimates.tradingResult} /></strong> trading result — {t.estimates.tradingResultNote}</p>
        <p className="mt-2"><strong><Money value={t.estimates.linkedGrossMargin} /></strong> linked gross margin — {t.estimates.linkedGrossMarginNote}</p>
      </Card>
      <Card>
        <CardTitle className="mb-2">3 · Statutory indicators <Badge tone="blue">configurable assumptions</Badge></CardTitle>
        <ul className="space-y-1 text-sm">
          <li>Presumptive (indicative): <Money value={t.statutory.presumptiveIndicative} /> — {t.statutory.presumptiveNote}</li>
          <li>Turnover limit indicator applied: <Money value={t.statutory.turnoverLimitApplied} /> (cash share {t.statutory.cashReceiptSharePercent}%) · {t.statutory.turnoverWithinLimit ? "within" : "above"} limit</li>
          {t.statutory.commissionWarning ? <li className="font-semibold text-turmeric-700">{t.statutory.commissionWarning}</li> : null}
          <li>GST: {t.statutory.gstNote}</li>
        </ul>
      </Card>
      <Card>
        <CardTitle className="mb-2">Partners (Me / Dad)</CardTitle>
        <ul className="divide-y divide-line text-sm">
          {t.partners.attribution.map((a) => <li key={a.userId} className="flex justify-between py-2"><span>Sales recorded by {a.name} ({a.billsRecorded} bills)</span><Money value={a.salesRecorded} /></li>)}
          {t.partners.allocation.map((a) => <li key={`al-${a.userId}`} className="flex justify-between py-2"><span>{a.name}: {a.percent}% share of trading result</span><Money value={a.tradingResultShare} /></li>)}
        </ul>
        {!t.partners.allocationConfigured ? <p className="mt-2 text-xs text-muted">Set the profit-sharing percentages in Settings.</p> : null}
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  return <Suspense fallback={<Loading />}><Reports /></Suspense>;
}
