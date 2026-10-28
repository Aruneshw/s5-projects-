// src/app/(app)/marketplace/page.tsx — investors see masked listings and place real bids.
"use client";
import { useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { DateText, Money } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface Listing { id: string; seller: string; buyerCity: string; invoiceAmount: string; dueDate: string; tenureDays: number; trustScore: number; platformRatePercent: string; myBid: null | { status: string; annualRatePercent: string; advanceAmount: string } }

export default function MarketplacePage() {
  const q = useApi<Listing[]>(["marketplace"], "/api/marketplace");
  return (
    <RequirePerm perm="marketplace:read">
      <PageHeader title="Marketplace" subtitle="Invoices offered for advance. Business and buyer identities are masked." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data?.length === 0 ? <Empty title="No open listings" /> : null}
      <div className="space-y-3">{q.data?.map((l) => <ListingCard key={l.id} l={l} />)}</div>
    </RequirePerm>
  );
}

function ListingCard({ l }: { l: Listing }) {
  const [rate, setRate] = useState(l.platformRatePercent);
  const [adv, setAdv] = useState((Number(l.invoiceAmount) * 0.8).toFixed(2));
  const bid = useAction<{ annualRatePercent: string; advanceAmount: string }>("POST", `/api/marketplace/${l.id}/bids`);
  return (
    <Card className="space-y-2">
      <div className="flex justify-between"><span className="font-bold">{l.seller} → buyer in {l.buyerCity}</span><Badge tone="blue">trust {l.trustScore}</Badge></div>
      <div className="num text-sm">Invoice <Money value={l.invoiceAmount} strong /> · due <DateText value={l.dueDate} /> ({l.tenureDays} days) · reference rate {l.platformRatePercent}%</div>
      {l.myBid ? <p className="text-sm">Your bid: {l.myBid.annualRatePercent}% · <Money value={l.myBid.advanceAmount} /> · {l.myBid.status.toLowerCase()}</p> : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); bid.mutate({ annualRatePercent: rate, advanceAmount: adv }); }}>
          <label className="text-xs">Rate % p.a.<Input className="h-10 w-24" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="text-xs">Advance ₹<Input className="h-10 w-36" value={adv} onChange={(e) => setAdv(e.target.value)} /></label>
          <Button size="sm">Place bid</Button>
        </form>
      )}
      {bid.errorText ? <p className="text-sm text-chilli-700">{bid.errorText}</p> : null}
    </Card>
  );
}
