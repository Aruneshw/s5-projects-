// src/app/(app)/investments/page.tsx — investor's accepted deals; confirm the real transfer with a reference.
"use client";
import { useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { DateText, Money } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface Inv { id: string; status: string; buyerCity: string; invoiceAmount: string; dueDate: string; fundedAmount: string | null; fundingReference: string | null; settled: string; settlementRouting: string }

export default function InvestmentsPage() {
  const q = useApi<Inv[]>(["investments"], "/api/investments");
  return (
    <RequirePerm perm="investment:read">
      <PageHeader title="Active investments" />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data?.length === 0 ? <Empty title="No accepted bids yet" /> : null}
      <div className="space-y-3">{q.data?.map((i) => <Row key={i.id} i={i} />)}</div>
    </RequirePerm>
  );
}

function Row({ i }: { i: Inv }) {
  const [amt, setAmt] = useState("");
  const [ref, setRef] = useState("");
  const fund = useAction<{ fundedAmount: string; fundingReference: string }>("POST", `/api/investments/${i.id}/fund`);
  return (
    <Card className="space-y-2">
      <div className="flex justify-between"><span className="font-bold">Buyer in {i.buyerCity}</span><Badge tone="blue">{i.status.replace("_", " ").toLowerCase()}</Badge></div>
      <div className="num text-sm">Invoice <Money value={i.invoiceAmount} /> · due <DateText value={i.dueDate} /> · settled <Money value={i.settled} /> · buyer pays {i.settlementRouting === "TO_FINANCIER" ? "you" : "the business"}</div>
      {i.fundedAmount ? <p className="text-sm">Funded <Money value={i.fundedAmount} /> · ref {i.fundingReference}</p> : null}
      {i.status === "BID_ACCEPTED" ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); fund.mutate({ fundedAmount: amt, fundingReference: ref }); }}>
          <label className="text-xs">Amount sent ₹<Input className="h-10 w-36" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
          <label className="text-xs">Bank / UTR reference<Input className="h-10 w-44" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <Button size="sm" disabled={!amt || ref.length < 3}>Confirm transfer made</Button>
        </form>
      ) : null}
      {fund.errorText ? <p className="text-sm text-chilli-700">{fund.errorText}</p> : null}
    </Card>
  );
}
