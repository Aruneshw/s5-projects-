// src/features/discounting/components/instant-cash-dialog.tsx — eligibility, price breakdown, explicit acceptance.
"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/common/format";
import { Loading, ErrorState } from "@/components/ui/states";
import { api, ApiError, issuesOf } from "@/lib/api";

interface Eligibility {
  eligible: boolean;
  reasons: string[];
  invoiceAmount: string | null;
  dueDate: string | null;
  tenureDays: number | null;
  trustScore: number | null;
  quote: null | { invoiceAmount: string; tenureDays: number; annualRatePercent: string; discountFee: string; reserveHoldback: string; upfrontPayout: string };
}

export function InstantCashDialog({ billId, open, onOpenChange }: { billId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [agree, setAgree] = useState(false);
  const [routing, setRouting] = useState<"TO_FINANCIER" | "TO_BUSINESS">("TO_FINANCIER");
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string[]>([]);
  const q = useQuery({ queryKey: ["discount-eval", billId], queryFn: () => api<Eligibility>(`/api/discounting/evaluate/${billId}`), enabled: open, staleTime: 0 });

  async function accept() {
    if (!q.data?.quote) return;
    setErr([]);
    try {
      await api("/api/discounting", { method: "POST", json: { billId, expectedUpfrontPayout: q.data.quote.upfrontPayout, acceptTerms: true, settlementRouting: routing } });
      setResult("Listed as Available for Advance. Registered financiers can now bid; nothing is funded until a financier confirms a real transfer.");
      void qc.invalidateQueries();
    } catch (e) {
      setErr([e instanceof Error ? e.message : "Failed", ...issuesOf(e)]);
      if (e instanceof ApiError && e.status === 409) void q.refetch();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Get instant cash" description="Advance against this unpaid sales invoice via a financing partner">
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      {q.data && !q.data.eligible ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-semibold text-chilli-700">
            <XCircle className="size-5" /> Not eligible
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {q.data.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.data?.eligible && q.data.quote && !result ? (
        <div className="space-y-3">
          <dl className="divide-y divide-line rounded-xl border border-line text-base">
            {[
              ["Invoice amount", <Money key="a" value={q.data.quote.invoiceAmount} />],
              ["Rate (yearly)", `${q.data.quote.annualRatePercent}% · trust score ${q.data.trustScore}`],
              ["Tenure", `${q.data.quote.tenureDays} days (due ${q.data.dueDate})`],
              ["Discount fee", <Money key="f" value={q.data.quote.discountFee} />],
              ["Reserve held back (15%)", <Money key="r" value={q.data.quote.reserveHoldback} />],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3 p-3">
                <dt className="text-muted">{k}</dt>
                <dd className="num text-right font-semibold">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 bg-leaf-50 p-3 text-lg font-extrabold text-leaf-800">
              <dt>Upfront cash</dt>
              <dd className="num">
                <Money value={q.data.quote.upfrontPayout} />
              </dd>
            </div>
          </dl>
          <fieldset className="space-y-1 text-sm">
            <legend className="font-semibold">When the buyer pays, the money goes to</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="routing" className="size-5" checked={routing === "TO_FINANCIER"} onChange={() => setRouting("TO_FINANCIER")} /> the financier directly
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="routing" className="size-5" checked={routing === "TO_BUSINESS"} onChange={() => setRouting("TO_BUSINESS")} /> my business (I pass it on)
            </label>
          </fieldset>
          <p className="rounded-lg bg-paper p-3 text-xs text-muted">
            This app is a workflow tool, not a lender. Indicative terms. A financing partner provides the funds only after its own checks. Once you accept, this invoice&apos;s
            terms are frozen and it cannot be cancelled while financing is active.
          </p>
          <label className="flex items-start gap-2 text-sm font-semibold">
            <input type="checkbox" className="mt-0.5 size-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I have read the terms and want to list this invoice.
          </label>
          {err.length ? <p className="text-sm text-chilli-700">{err.join(" · ")}</p> : null}
          <Button className="w-full" size="lg" disabled={!agree} onClick={accept}>
            Accept cash terms
          </Button>
        </div>
      ) : null}
      {result ? (
        <p className="flex items-start gap-2 rounded-xl bg-leaf-50 p-3 text-leaf-800">
          <CheckCircle2 className="size-5 shrink-0" /> {result}
        </p>
      ) : null}
    </Dialog>
  );
}
