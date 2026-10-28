// src/app/(app)/discounting/page.tsx — financing requests: bids from real financiers, settlement, defaults.
"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { DateText, Money, today } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface Req {
  id: string; billId: string; billNumber: number; party: string; status: string; invoiceAmount: string; tenureDays: number; annualRatePercent: string; discountFee: string; reserveHoldback: string; upfrontPayout: string; dueDate: string; fundedAmount: string | null; fundingReference: string | null; settlementRouting: string; settled: string;
  bids: Array<{ id: string; annualRatePercent: string; advanceAmount: string; status: string; createdAt: string }>;
  defaulted: null | { detectedAt: string; daysOverdue: number; resolvedAt: string | null };
}

export default function DiscountingPage() {
  const q = useApi<Req[]>(["discount-requests"], "/api/discounting");
  const acceptBid = useAction<{ id: string; bidId: string }>("POST", (b) => `/api/discounting/${b.id}/bids/${b.bidId}/accept`);
  const withdraw = useAction<{ id: string }>("POST", (b) => `/api/discounting/${b.id}/withdraw`);
  const [settle, setSettle] = useState<Req | null>(null);
  return (
    <RequirePerm perm="discount:read">
      <PageHeader title="Invoice discounting" subtitle="Get cash early against unpaid sales invoices through a financing partner. This app tracks the workflow; it is not a lender." />
      <p className="mb-3 text-sm">Pick an unpaid sales invoice and tap <strong>Get Instant Cash</strong> on the <Link href="/bills?type=SALES" className="font-semibold text-leaf-700">Sales bills</Link> screen.</p>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data?.length === 0 ? <Empty title="No financing requests yet" /> : null}
      <div className="space-y-3">
        {q.data?.map((r) => (
          <Card key={r.id} className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Link href={`/bills/${r.billId}`} className="font-bold text-leaf-700">Sale #{r.billNumber} · {r.party}</Link>
                <div className="text-xs text-muted">Due <DateText value={r.dueDate} /> · {r.tenureDays} days · {r.annualRatePercent}% p.a.</div>
              </div>
              <Badge tone={r.status === "SETTLED" ? "green" : r.status === "DEFAULTED" ? "red" : r.status === "WITHDRAWN" ? "neutral" : "blue"}>{r.status.replace("_", " ").toLowerCase()}</Badge>
            </div>
            <div className="num grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
              <span>Invoice <Money value={r.invoiceAmount} /></span><span>Fee <Money value={r.discountFee} /></span><span>Reserve <Money value={r.reserveHoldback} /></span><span className="font-bold">Payout <Money value={r.upfrontPayout} /></span>
            </div>
            {r.fundedAmount ? <p className="text-sm">Funded <Money value={r.fundedAmount} /> · ref {r.fundingReference} · settled so far <Money value={r.settled} /></p> : null}
            {r.defaulted ? <p className="text-sm font-semibold text-chilli-700">Default recorded ({r.defaulted.daysOverdue} days overdue){r.defaulted.resolvedAt ? " · resolved" : ""}</p> : null}
            {r.status === "LISTED" ? (
              <div className="space-y-1">
                <div className="text-sm font-semibold">Bids from registered financiers</div>
                {r.bids.length === 0 ? <p className="text-sm text-muted">No bids yet. Bids appear only when a real financier places one.</p> : null}
                {r.bids.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-lg bg-paper p-2 text-sm">
                    <span>{b.annualRatePercent}% p.a. · advance <Money value={b.advanceAmount} /> · {b.status.toLowerCase()}</span>
                    {b.status === "OPEN" ? <Button size="sm" onClick={() => confirm("Accept this financier's bid?") && acceptBid.mutate({ id: r.id, bidId: b.id })}>Accept</Button> : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {["LISTED", "BID_ACCEPTED"].includes(r.status) ? <Button variant="ghost" size="sm" onClick={() => confirm("Withdraw this request?") && withdraw.mutate({ id: r.id })}>Withdraw</Button> : null}
              {["FUNDED", "DEFAULTED"].includes(r.status) ? <Button size="sm" onClick={() => setSettle(r)}>Record buyer payment</Button> : null}
            </div>
          </Card>
        ))}
      </div>
      {settle ? <SettleDialog r={settle} onClose={() => setSettle(null)} /> : null}
    </RequirePerm>
  );
}

function SettleDialog({ r, onClose }: { r: Req; onClose: () => void }) {
  const [f, setF] = useState({ amount: (Number(r.invoiceAmount) - Number(r.settled)).toFixed(2), routing: r.settlementRouting, settledOn: today(), reserveReleased: "0", reference: "" });
  const save = useAction<typeof f>("POST", `/api/discounting/${r.id}/settlements`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Record buyer payment" description="If the buyer paid the financier directly, the customer's balance is cleared automatically. If the buyer paid you, also record that customer payment.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync({ ...f, reference: f.reference || "" }); onClose(); }}>
        <Field label="Amount (₹)" htmlFor="sa"><Input id="sa" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} /></Field>
        <Field label="Buyer paid" htmlFor="sr"><Select id="sr" value={f.routing} onChange={(e) => setF((x) => ({ ...x, routing: e.target.value }))}><option value="TO_FINANCIER">the financier directly</option><option value="TO_BUSINESS">my business</option></Select></Field>
        <Field label="Date" htmlFor="sd"><Input id="sd" type="date" value={f.settledOn} onChange={(e) => setF((x) => ({ ...x, settledOn: e.target.value }))} /></Field>
        <Field label="Reserve released to me (₹)" htmlFor="rr"><Input id="rr" inputMode="decimal" value={f.reserveReleased} onChange={(e) => setF((x) => ({ ...x, reserveReleased: e.target.value }))} /></Field>
        <Field label="Reference" htmlFor="rf"><Input id="rf" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} /></Field>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Button className="w-full">Save</Button>
      </form>
    </Dialog>
  );
}
