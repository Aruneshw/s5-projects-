// src/app/(app)/bills/page.tsx — invoices: party, amount, due date, payment status; phone drafts; Get Instant Cash.
"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Plus, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { BillStatusBadge, DateText, Money, PaymentStatusBadge } from "@/components/common/format";
import { useCan } from "@/components/auth/me";
import { InstantCashDialog } from "@/features/discounting/components/instant-cash-dialog";
import { localDb, type LocalDraft } from "@/offline/db";
import { Badge } from "@/components/ui/card";

interface Row {
  id: string;
  type: "SALES" | "PURCHASE";
  status: string;
  billNumber: number | null;
  billDate: string;
  dueDate: string | null;
  party: string;
  invoiceAmount: string;
  outstanding: string | null;
  paymentStatus: string | null;
  createdBy: string;
  financing: string | null;
}

function BillsList() {
  const router = useRouter();
  const params = useSearchParams();
  const canPurchase = useCan("bill:create:purchase");
  const canFinance = useCan("discount:request");
  const type = (params.get("type") === "PURCHASE" && canPurchase ? "PURCHASE" : "SALES") as "SALES" | "PURCHASE";
  const status = params.get("status") ?? "";
  const [q, setQ] = useState("");
  const [cashFor, setCashFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<LocalDraft[]>([]);

  useEffect(() => {
    void localDb()
      .drafts.where("type")
      .equals(type)
      .toArray()
      .then(setDrafts);
  }, [type]);

  const list = useQuery({
    queryKey: ["bills", type, status, q],
    queryFn: () => api<Row[]>(`/api/bills?type=${type}${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  });

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/bills?${p.toString()}`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={type === "SALES" ? "Sales bills" : "Purchase bills"}
        actions={
          <Button asChild>
            <Link href={`/bills/new?type=${type}`}>
              <Plus /> New
            </Link>
          </Button>
        }
      />
      {canPurchase ? (
        <Segmented label="Bill type" value={type} onChange={(v) => setParam("type", v)} options={[{ value: "SALES", label: "Sales" }, { value: "PURCHASE", label: "Purchases" }]} />
      ) : null}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input placeholder="Search shop or bill number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search bills" />
        <Select aria-label="Status" value={status} onChange={(e) => setParam("status", e.target.value)} className="w-36">
          <option value="">All</option>
          <option value="POSTED">Posted</option>
          <option value="DRAFT">Drafts</option>
          <option value="CANCELLED">Cancelled</option>
        </Select>
      </div>

      {drafts.length ? (
        <Card className="space-y-2 border-turmeric-100 bg-turmeric-100/30">
          <div className="flex items-center gap-2 text-sm font-bold text-turmeric-700">
            <Smartphone className="size-4" /> Saved on this phone (not posted)
          </div>
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2">
              <Link href={`/bills/new?draft=${d.id}`} className="font-semibold text-leaf-700">
                Continue draft · {new Date(d.updatedAt).toLocaleString("en-IN")}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (!confirm("Delete this unsaved draft from the phone?")) return;
                  await localDb().drafts.delete(d.id);
                  setDrafts((x) => x.filter((y) => y.id !== d.id));
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </Card>
      ) : null}

      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? <Empty title="No bills found" hint="Create the first one with New." /> : null}
      {list.data?.length ? (
        <ul className="space-y-2">
          {list.data.map((b) => {
            const eligibleLook = canFinance && b.type === "SALES" && b.status === "POSTED" && !b.financing && (b.paymentStatus === "UNPAID" || b.paymentStatus === "PARTIAL");
            return (
              <li key={b.id}>
                <Card className="p-3">
                  <Link href={`/bills/${b.id}`} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{b.party}</div>
                      <div className="text-xs text-muted">
                        #{b.billNumber ?? "draft"} · <DateText value={b.billDate} /> · due <DateText value={b.dueDate} /> · by {b.createdBy}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Money value={b.invoiceAmount} strong />
                      {b.status === "POSTED" ? <PaymentStatusBadge status={b.paymentStatus} /> : <BillStatusBadge status={b.status} />}
                      {b.financing ? <Badge tone="blue">{b.financing.toLowerCase().replace("_", " ")}</Badge> : null}
                    </div>
                  </Link>
                  {eligibleLook ? (
                    <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setCashFor(b.id)}>
                      <Banknote /> Get Instant Cash
                    </Button>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
      {cashFor ? <InstantCashDialog billId={cashFor} open onOpenChange={(o) => !o && setCashFor(null)} /> : null}
    </div>
  );
}

export default function BillsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <BillsList />
    </Suspense>
  );
}
