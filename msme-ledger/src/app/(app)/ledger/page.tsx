// src/app/(app)/ledger/page.tsx — receivables and payables, largest first, with overdue alerts.
"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Card, PageHeader, Stat } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";
import { ErrorState, Loading, Empty } from "@/components/ui/states";
import { DateText, Money } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface Row { storeId: string; shopName: string; city: string; balance: string; overdueAmount: string; overdueDays: number; alert: boolean; lastActivity: string | null }
interface Data { totals: { receivable: string; payable: string }; customers: Row[]; suppliers: Row[] }

export default function LedgerPage() {
  const [tab, setTab] = useState<"customers" | "suppliers">("customers");
  const q = useApi<Data>(["balances"], "/api/ledger/balances");
  const rows = q.data?.[tab].filter((r) => Number(r.balance) !== 0) ?? [];
  return (
    <RequirePerm perm="ledger:read">
      <PageHeader title="Ledger" subtitle="Balances come only from posted ledger entries" />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Customers owe us" value={<Money value={q.data.totals.receivable} />} tone="amber" />
            <Stat label="We owe suppliers" value={<Money value={q.data.totals.payable} />} tone="red" />
          </div>
          <Segmented label="Side" value={tab} onChange={setTab} options={[{ value: "customers", label: "Receivables" }, { value: "suppliers", label: "Payables" }]} />
          {rows.length === 0 ? <Empty title="All settled" /> : null}
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.storeId}>
                <Link href={`/stores/${r.storeId}`}>
                  <Card className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{r.shopName} — {r.city}</div>
                      <div className="text-xs text-muted">Last activity <DateText value={r.lastActivity} /></div>
                      {Number(r.overdueAmount) > 0 ? (
                        <div className={`mt-1 flex items-center gap-1 text-xs font-semibold ${r.alert ? "text-chilli-700" : "text-turmeric-700"}`}>
                          <AlertTriangle className="size-3.5" /> <Money value={r.overdueAmount} /> overdue · {r.overdueDays} days
                        </div>
                      ) : null}
                    </div>
                    <Money value={r.balance} strong className="text-lg" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </RequirePerm>
  );
}
