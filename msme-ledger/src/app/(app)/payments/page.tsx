// src/app/(app)/payments/page.tsx — record payments (partial, multiple per bill) and see history.
"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, useAction, idemKey } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorState, Loading, Empty } from "@/components/ui/states";
import { DateText, Money, today } from "@/components/common/format";
import { useCan } from "@/components/auth/me";
import { useMasters } from "@/features/bills/components/use-masters";
import { Picker } from "@/features/bills/components/picker";
import { enqueue } from "@/offline/sync-engine";
import { useOnline } from "@/offline/use-sync";
import { NetworkError } from "@/lib/api";

interface Payment { id: string; party: string; direction: string; amount: string; paymentDate: string; mode: string; billNumber: number | null; status: string; reference: string | null; createdBy: string }

function Payments() {
  const params = useSearchParams();
  const canHistory = useCan("payment:read");
  const canCancel = useCan("payment:cancel");
  const canSupplier = useCan("bill:create:purchase");
  const online = useOnline();
  const { stores, modes } = useMasters();
  const [f, setF] = useState({ storeId: params.get("storeId") ?? "", billId: params.get("billId") ?? "", paymentModeId: "", amount: "", paymentDate: today(), reference: "" });
  const [key, setKey] = useState(idemKey());
  const [msg, setMsg] = useState<string | null>(null);
  const add = useAction<Record<string, unknown>>("POST", "/api/payments");
  const cancel = useAction<{ id: string; reason: string }>("POST", (b) => `/api/payments/${b.id}/cancel`);
  const t = today();
  const list = useApi<Payment[]>(["payments", canHistory], canHistory ? "/api/payments" : `/api/payments?from=${t}&to=${t}`);
  const usable = stores.filter((s) => canSupplier || s.type === "CUSTOMER");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body = { storeId: f.storeId, billId: f.billId || null, paymentModeId: f.paymentModeId || modes[0]?.id, amount: f.amount, paymentDate: f.paymentDate, reference: f.reference || null, idempotencyKey: key };
    try {
      if (!online) throw new NetworkError();
      const r = (await add.mutateAsync(body)) as { duplicate: boolean };
      setMsg(r.duplicate ? "This payment was already recorded (duplicate tap ignored)." : "Payment recorded.");
    } catch (err) {
      if (!(err instanceof NetworkError)) return;
      const payload = body; // keeps the same idempotency key as the online attempt
      const label = `Payment ₹${f.amount} · ${stores.find((s) => s.id === f.storeId)?.label ?? ""}`;
      await enqueue("PAYMENT_CREATE", payload, label, key);
      setMsg("Offline: payment saved on this phone and will sync automatically.");
    }
    setF((x) => ({ ...x, amount: "", reference: "", billId: "" }));
    setKey(idemKey());
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Payments" subtitle="Cash, UPI, bank transfer and other modes. Partial payments are fine." />
      <Card>
        <form className="space-y-3" onSubmit={submit}>
          <Picker id="pay-store" label="Shop — city" options={usable.map((s) => ({ id: s.id, label: s.label, hint: s.type === "CUSTOMER" ? "customer · money received" : "supplier · money paid" }))} value={f.storeId || null} onChange={(id) => setF((x) => ({ ...x, storeId: id, billId: "" }))} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (₹)" htmlFor="pa"><Input id="pa" inputMode="decimal" className="text-xl font-bold" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} /></Field>
            <Field label="Mode" htmlFor="pm"><Select id="pm" value={f.paymentModeId} onChange={(e) => setF((x) => ({ ...x, paymentModeId: e.target.value }))}>{modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
            <Field label="Date" htmlFor="pd"><Input id="pd" type="date" value={f.paymentDate} onChange={(e) => setF((x) => ({ ...x, paymentDate: e.target.value }))} /></Field>
            <Field label="Reference (UPI / UTR)" htmlFor="pr"><Input id="pr" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} /></Field>
          </div>
          {f.billId ? <p className="text-sm text-muted">Linked to the bill you came from. <button type="button" className="text-leaf-700 underline" onClick={() => setF((x) => ({ ...x, billId: "" }))}>Unlink</button></p> : null}
          {add.errorText ? <p className="text-sm text-chilli-700">{add.errorText}</p> : null}
          {msg ? <p role="status" className="text-sm font-semibold text-leaf-800">{msg}</p> : null}
          <Button size="lg" className="w-full" disabled={!f.storeId || !f.amount || add.isPending}>Record payment</Button>
        </form>
      </Card>
      <Card>
        <CardTitle className="mb-2">{canHistory ? "Recent payments" : "Today's receipts"}</CardTitle>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : null}
        {list.data?.length === 0 ? <Empty title="No payments" /> : null}
        <ul className="divide-y divide-line text-sm">
          {list.data?.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <div className="font-semibold">{p.party}</div>
                <div className="text-xs text-muted"><DateText value={p.paymentDate} /> · {p.direction === "RECEIVED" ? "received" : "paid"} · {p.mode}{p.billNumber ? ` · bill #${p.billNumber}` : ""} · {p.createdBy}</div>
              </div>
              <div className="flex items-center gap-2">
                <Money value={p.amount} strong />
                {p.status === "CANCELLED" ? <Badge tone="red">cancelled</Badge> : canCancel ? (
                  <Button variant="ghost" size="sm" onClick={() => { const reason = prompt("Reason for cancelling this payment?"); if (reason && reason.length >= 5) cancel.mutate({ id: p.id, reason }); }}>Cancel</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function PaymentsPage() {
  return <Suspense fallback={<Loading />}><Payments /></Suspense>;
}
