// src/app/(app)/dashboard/page.tsx
"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, FileText, ReceiptIndianRupee, ShoppingCart, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/components/auth/me";
import { Can } from "@/components/auth/can";
import { Card, CardTitle, PageHeader, Stat } from "@/components/ui/card";
import { ErrorState, Loading, Empty } from "@/components/ui/states";
import { BillStatusBadge, DateText, Money, PaymentStatusBadge, TrustBadge } from "@/components/common/format";
import { useSyncStatus } from "@/offline/use-sync";

interface Dash {
  financials: null | {
    todayRevenue: string;
    monthRevenue: string;
    customerDues: string;
    supplierPayables: string;
    trustScore: number;
    riskFlag: string;
    topDues: Array<{ storeId: string; shopName: string; city: string; balance: string }>;
  };
  recent: Array<{ id: string; type: string; status: string; billNumber: number | null; billDate: string; party: string; invoiceAmount: string; paymentStatus: string | null }>;
  pending: { drafts: number; syncConflicts: number; staleStock?: string[]; negativeStock?: string[]; overdueCustomers?: Array<{ storeId: string; label: string; overdueAmount: string; overdueDays: number }> };
}

const quick = [
  { href: "/bills/new?type=SALES", label: "Sales bill", icon: ReceiptIndianRupee, perm: "bill:create:sales" as const },
  { href: "/bills/new?type=PURCHASE", label: "Purchase bill", icon: ShoppingCart, perm: "bill:create:purchase" as const },
  { href: "/reports?tab=daily", label: "Daily report", icon: FileText, perm: "report:read" as const },
  { href: "/ledger/daily", label: "Daily ledger", icon: BookOpen, perm: "ledger:daily" as const },
  { href: "/payments", label: "Payments", icon: Wallet, perm: "payment:create" as const },
];

export default function DashboardPage() {
  const me = useMe();
  const sync = useSyncStatus();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("/api/dashboard"), enabled: !!me?.permissions.includes("dashboard:view") });

  if (me && !me.permissions.includes("dashboard:view")) {
    return (
      <div>
        <PageHeader title={`Welcome, ${me.displayName}`} subtitle={me.orgName} />
        <Card>Use the menu to open your portal.</Card>
      </div>
    );
  }
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const f = d.financials;

  return (
    <div className="space-y-5">
      <PageHeader title={`Vanakkam, ${me?.displayName ?? ""}`} subtitle={me?.orgName} actions={f ? <TrustBadge score={f.trustScore} /> : null} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {quick.map((x) => (
          <Can key={x.href} perm={x.perm}>
            <Link href={x.href} className="flex h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-leaf-700 px-2 text-center text-sm font-bold text-white active:bg-leaf-800">
              <x.icon className="size-6" />
              {x.label}
            </Link>
          </Can>
        ))}
      </div>

      {f ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Today's sales" value={<Money value={f.todayRevenue} />} />
          <Stat label="This month" value={<Money value={f.monthRevenue} />} />
          <Stat label="Customer dues" value={<Money value={f.customerDues} />} tone="amber" />
          <Stat label="Supplier payables" value={<Money value={f.supplierPayables} />} tone="red" />
        </div>
      ) : null}

      <Card className="space-y-2">
        <CardTitle>Pending tasks</CardTitle>
        <ul className="space-y-2 text-sm">
          {!sync.online ? <li className="font-semibold text-turmeric-700">Offline — new bills are saved on this phone and will sync automatically.</li> : null}
          {sync.pending ? <li>{sync.pending} record(s) waiting to sync.</li> : null}
          {sync.attention || d.pending.syncConflicts ? (
            <li>
              <Link className="font-semibold text-chilli-700" href="/sync">
                {Math.max(sync.attention, d.pending.syncConflicts)} sync item(s) need your decision →
              </Link>
            </li>
          ) : null}
          {d.pending.drafts ? (
            <li>
              <Link className="font-semibold text-leaf-700" href="/bills?status=DRAFT">
                {d.pending.drafts} draft bill(s) not posted →
              </Link>
            </li>
          ) : null}
          {d.pending.overdueCustomers?.map((o) => (
            <li key={o.storeId} className="flex items-center gap-2 text-chilli-700">
              <AlertTriangle className="size-4" /> {o.label}: <Money value={o.overdueAmount} /> overdue {o.overdueDays} days
            </li>
          ))}
          {d.pending.staleStock?.length ? <li className="text-turmeric-700">Old stock: {d.pending.staleStock.join(", ")}</li> : null}
          {d.pending.negativeStock?.length ? <li className="text-chilli-700">Negative stock (check entries): {d.pending.negativeStock.join(", ")}</li> : null}
          {!d.pending.drafts && !d.pending.syncConflicts && !sync.pending && !d.pending.overdueCustomers?.length && !d.pending.staleStock?.length ? (
            <li className="text-muted">Nothing pending. 👍</li>
          ) : null}
        </ul>
      </Card>

      <Card>
        <CardTitle className="mb-2">Recent bills</CardTitle>
        {d.recent.length === 0 ? (
          <Empty title="No bills yet" />
        ) : (
          <ul className="divide-y divide-line">
            {d.recent.map((b) => (
              <li key={b.id}>
                <Link href={`/bills/${b.id}`} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{b.party}</div>
                    <div className="text-xs text-muted">
                      {b.type === "SALES" ? "Sale" : "Purchase"} #{b.billNumber ?? "draft"} · <DateText value={b.billDate} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Money value={b.invoiceAmount} strong />
                    {b.status === "POSTED" ? <PaymentStatusBadge status={b.paymentStatus} /> : <BillStatusBadge status={b.status} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {f?.topDues.length ? (
        <Card>
          <CardTitle className="mb-2">Largest customer dues</CardTitle>
          <ul className="divide-y divide-line text-sm">
            {f.topDues.map((t) => (
              <li key={t.storeId} className="flex justify-between py-2">
                <Link href={`/stores/${t.storeId}`} className="font-semibold">
                  {t.shopName} — {t.city}
                </Link>
                <Money value={t.balance} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
