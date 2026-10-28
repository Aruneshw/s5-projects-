// src/app/(app)/ledger/daily/page.tsx — the day's sales, receipts and expenses (cashier view; no margins/balances).
"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { BillStatusBadge, Money, today } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";
import { sum } from "@/lib/money";

interface Data {
  date: string;
  bills: Array<{ id: string; type: string; billNumber: number | null; party: string; invoiceAmount: string; status: string }>;
  payments: Array<{ id: string; party: string; amount: string; mode: string; status: string }>;
  expenses: Array<{ id: string; category: string; amount: string; notes: string | null; status: string }>;
}

export default function DailyLedgerPage() {
  const [date, setDate] = useState(today());
  const q = useApi<Data>(["daily-ledger", date], `/api/ledger/daily?date=${date}`);
  const d = q.data;
  return (
    <RequirePerm perm="ledger:daily">
      <PageHeader title="Daily ledger" actions={<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className="w-44" />} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {d ? (
        <div className="space-y-3">
          <Card>
            <CardTitle className="mb-2">Bills · <Money value={sum(d.bills.filter((b) => b.status === "POSTED").map((b) => b.invoiceAmount)).toFixed(2)} /></CardTitle>
            <ul className="divide-y divide-line text-sm">
              {d.bills.map((b) => (
                <li key={b.id} className="flex justify-between py-2"><Link href={`/bills/${b.id}`} className="font-semibold">{b.type === "SALES" ? "Sale" : "Purchase"} #{b.billNumber ?? "draft"} · {b.party}</Link><span className="flex items-center gap-2"><Money value={b.invoiceAmount} /><BillStatusBadge status={b.status} /></span></li>
              ))}
              {d.bills.length === 0 ? <li className="py-2 text-muted">No bills</li> : null}
            </ul>
          </Card>
          <Card>
            <CardTitle className="mb-2">Receipts · <Money value={sum(d.payments.filter((p) => p.status === "ACTIVE").map((p) => p.amount)).toFixed(2)} /></CardTitle>
            <ul className="divide-y divide-line text-sm">
              {d.payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{p.party} · {p.mode}</span><Money value={p.amount} /></li>)}
              {d.payments.length === 0 ? <li className="py-2 text-muted">No receipts</li> : null}
            </ul>
          </Card>
          <Card>
            <CardTitle className="mb-2">Expenses · <Money value={sum(d.expenses.filter((e) => e.status === "ACTIVE").map((e) => e.amount)).toFixed(2)} /></CardTitle>
            <ul className="divide-y divide-line text-sm">
              {d.expenses.map((e) => <li key={e.id} className="flex justify-between py-2"><span>{e.category.replace("_", " ").toLowerCase()} {e.notes ? `· ${e.notes}` : ""}</span><Money value={e.amount} /></li>)}
              {d.expenses.length === 0 ? <li className="py-2 text-muted">No expenses</li> : null}
            </ul>
          </Card>
        </div>
      ) : null}
    </RequirePerm>
  );
}
