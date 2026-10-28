// src/app/(app)/lender/page.tsx — lender portal: anonymised profiles of consenting MSMEs that expressed interest.
"use client";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { Money } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface P { offerId: string; applicant: string; product: string; status: string; indicativeAmount: string; indicativeRatePercent: string; trustScore: number; riskFlag: string; metrics: { annualTurnover?: string; avgCollectionDays?: number | null; avgSupplierPaymentDays?: number | null; digitalReceiptPercent?: string; profitConsistencyPercent?: number; activeMonths?: number; riskIndicators?: string[] } }

export default function LenderPage() {
  const q = useApi<P[]>(["lender"], "/api/lender/profiles");
  const decline = useAction<{ id: string; note: string }>("POST", (b) => `/api/lender/offers/${b.id}/decline`);
  return (
    <RequirePerm perm="lender:profiles:read">
      <PageHeader title="Lender portal" subtitle="Anonymised profiles. Indicative figures from the business's own records — do your own checks." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data?.length === 0 ? <Empty title="No applicants yet" /> : null}
      <div className="space-y-3">
        {q.data?.map((p) => (
          <Card key={p.offerId} className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="font-bold">{p.applicant} · {p.product}</span><Badge tone={p.riskFlag === "HIGH_RISK" ? "red" : "green"}>trust {p.trustScore}</Badge></div>
            <div>Indicative <Money value={p.indicativeAmount} /> up to {p.indicativeRatePercent}% · {p.status.replace("_", " ").toLowerCase()}</div>
            <div className="text-muted">Turnover <Money value={p.metrics.annualTurnover ?? "0"} /> · collection {p.metrics.avgCollectionDays ?? "—"} d · supplier payment {p.metrics.avgSupplierPaymentDays ?? "—"} d · digital {p.metrics.digitalReceiptPercent}% · profitable months {p.metrics.profitConsistencyPercent}% · {p.metrics.activeMonths} active months</div>
            {p.status === "INTEREST_EXPRESSED" ? <Button variant="ghost" size="sm" onClick={() => { const note = prompt("Reason for declining?"); if (note) decline.mutate({ id: p.offerId, note }); }}>Decline</Button> : null}
          </Card>
        ))}
      </div>
    </RequirePerm>
  );
}
