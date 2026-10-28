// src/app/(app)/credit/page.tsx — trust score (with explanations), credit profile, indicative loan matches.
"use client";
import { useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader, Stat } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorState, Loading } from "@/components/ui/states";
import { Money, TrustBadge } from "@/components/common/format";
import { RequirePerm, Can } from "@/components/auth/can";

interface Match {
  disclaimer: string;
  profile: { trustScore: number; riskFlag: string; metrics: { annualTurnover: string; avgCollectionDays: number | null; avgSupplierPaymentDays: number | null; receivables: string; payables: string; digitalReceiptPercent: string; profitConsistencyPercent: number; activeMonths: number; riskIndicators: string[]; monthly: Array<{ month: string; turnover: string; tradingResult: string }> } };
  products: Array<{ productId: string; productName: string; partner: string; isDemoPartner: boolean; eligible: boolean; reasons: string[]; offerId: string | null; indicativeAmount: string | null; indicativeMaxRatePercent: string }>;
}
interface Trust { score: number; factors: { repayment: number; cashflow: number; bookkeeping: number; weighted: number }; explanations: string[]; formulaVersion: string }

export default function CreditPage() {
  const trust = useApi<Trust>(["trust"], "/api/credit/trust");
  const [load, setLoad] = useState(false);
  const match = useApi<Match>(["credit-match"], load ? "/api/credit/offers" : null);
  const interest = useAction<{ id: string }>("POST", (b) => `/api/credit/offers/${b.id}/interest`);
  const sharing = useAction<{ share: boolean }>("PUT", "/api/credit/sharing");
  const recompute = useAction<Record<string, never>>("POST", "/api/credit/trust");
  return (
    <RequirePerm perm="credit:read">
      <PageHeader title="Credit matchmaker" subtitle="Indicative pre-qualification from your own records. Not a loan approval." />
      {trust.isLoading ? <Loading /> : trust.error ? <ErrorState error={trust.error} /> : trust.data ? (
        <Card className="mb-3 space-y-2">
          <div className="flex items-center justify-between"><CardTitle>Trust score</CardTitle><TrustBadge score={trust.data.score} /></div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Repayment (40%)" value={trust.data.factors.repayment} />
            <Stat label="Cash flow (35%)" value={trust.data.factors.cashflow} />
            <Stat label="Bookkeeping (25%)" value={trust.data.factors.bookkeeping} />
          </div>
          <ul className="list-disc pl-5 text-sm text-muted">{trust.data.explanations.map((e) => <li key={e}>{e}</li>)}</ul>
          <p className="text-xs text-muted">Formula {trust.data.formulaVersion} · range 300–900 · see docs/FINANCIAL_RULES.md</p>
          <Button variant="outline" size="sm" onClick={() => recompute.mutate({})}>Recalculate now</Button>
        </Card>
      ) : null}
      {!load ? <Can perm="credit:apply"><Button size="lg" className="w-full" onClick={() => setLoad(true)}>Build credit profile & check loan matches</Button></Can> : null}
      {match.isLoading ? <Loading label="Building profile…" /> : match.error ? <ErrorState error={match.error} /> : match.data ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-turmeric-100 p-3 text-sm text-turmeric-700">{match.data.disclaimer}</p>
          <Card>
            <CardTitle className="mb-2">Credit profile</CardTitle>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="12-month turnover" value={<Money value={match.data.profile.metrics.annualTurnover} />} />
              <Stat label="Avg collection days" value={match.data.profile.metrics.avgCollectionDays ?? "—"} />
              <Stat label="Avg supplier payment days" value={match.data.profile.metrics.avgSupplierPaymentDays ?? "—"} />
              <Stat label="Digital receipts" value={`${match.data.profile.metrics.digitalReceiptPercent}%`} />
              <Stat label="Receivables" value={<Money value={match.data.profile.metrics.receivables} />} />
              <Stat label="Payables" value={<Money value={match.data.profile.metrics.payables} />} />
              <Stat label="Profitable months" value={`${match.data.profile.metrics.profitConsistencyPercent}%`} />
              <Stat label="Risk" value={match.data.profile.riskFlag === "HIGH_RISK" ? "HIGH" : "Normal"} tone={match.data.profile.riskFlag === "HIGH_RISK" ? "red" : "green"} />
            </div>
            {match.data.profile.metrics.riskIndicators.length ? <ul className="mt-2 list-disc pl-5 text-sm text-chilli-700">{match.data.profile.metrics.riskIndicators.map((r) => <li key={r}>{r}</li>)}</ul> : null}
            <div className="mt-3 overflow-x-auto"><table className="num w-full min-w-[420px] text-sm"><thead><tr className="text-left text-xs text-muted"><th>Month</th><th className="text-right">Turnover</th><th className="text-right">Trading result</th></tr></thead><tbody className="divide-y divide-line">{match.data.profile.metrics.monthly.map((m) => <tr key={m.month}><td className="py-1">{m.month}</td><td className="text-right"><Money value={m.turnover} /></td><td className="text-right"><Money value={m.tradingResult} /></td></tr>)}</tbody></table></div>
          </Card>
          <label className="flex items-center gap-2 rounded-xl bg-paper p-3 text-sm">
            <input type="checkbox" className="size-5" onChange={(e) => sharing.mutate({ share: e.target.checked })} />
            Share my anonymised credit profile (no names, customers or suppliers) with lenders I express interest in
          </label>
          {match.data.products.map((p) => (
            <Card key={p.productId} className="space-y-1">
              <div className="flex items-center justify-between"><div className="font-bold">{p.productName}</div>{p.isDemoPartner ? <Badge tone="amber">demo partner</Badge> : null}</div>
              <div className="text-sm text-muted">{p.partner} · up to {p.indicativeMaxRatePercent}% p.a.</div>
              {p.eligible ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Pre-qualified, indicative: <Money value={p.indicativeAmount} strong /></span>
                  <Button size="sm" onClick={() => p.offerId && interest.mutate({ id: p.offerId })}>Express interest</Button>
                </div>
              ) : <ul className="list-disc pl-5 text-sm text-turmeric-700">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
            </Card>
          ))}
          {interest.errorText ? <p className="text-sm text-chilli-700">{interest.errorText}</p> : null}
          {interest.isSuccess ? <p className="text-sm font-semibold text-leaf-800">Interest recorded. No live lender integration exists yet; the lender sees your anonymised profile in its portal.</p> : null}
        </div>
      ) : null}
    </RequirePerm>
  );
}
