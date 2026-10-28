// src/app/(app)/expenses/page.tsx — expenses (transport, lorry, fuel, tolls…) and worker salaries (kept separate).
"use client";
import { useState } from "react";
import { useApi, useAction, idemKey } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { ErrorState, Loading } from "@/components/ui/states";
import { DateText, Money, today } from "@/components/common/format";
import { useCan } from "@/components/auth/me";
import { useMasters } from "@/features/bills/components/use-masters";
import { enqueue } from "@/offline/sync-engine";
import { useOnline } from "@/offline/use-sync";

const CATS = ["TRANSPORT", "LORRY_HIRE", "FUEL", "TOLLS", "MARKET_FEES", "MISCELLANEOUS"] as const;

export default function ExpensesPage() {
  const canSalary = useCan("salary:manage");
  const [tab, setTab] = useState<"expenses" | "salaries">("expenses");
  return (
    <div className="space-y-4">
      <PageHeader title={tab === "expenses" ? "Expenses" : "Worker salaries"} subtitle="Salaries are stored separately from coolie and general expenses" />
      {canSalary ? <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "expenses", label: "Expenses" }, { value: "salaries", label: "Salaries" }]} /> : null}
      {tab === "expenses" ? <Expenses /> : <Salaries />}
    </div>
  );
}

function Expenses() {
  const { modes } = useMasters();
  const online = useOnline();
  const canCancel = useCan("expense:cancel");
  const [f, setF] = useState({ expenseDate: today(), category: "TRANSPORT", amount: "", notes: "", paymentModeId: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const list = useApi<Array<{ id: string; expenseDate: string; category: string; amount: string; notes: string | null; status: string; mode: string | null }>>(["expenses"], "/api/expenses");
  const add = useAction<Record<string, unknown>>("POST", "/api/expenses");
  const cancel = useAction<{ id: string }>("POST", (b) => `/api/expenses/${b.id}/cancel`);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { ...f, paymentModeId: f.paymentModeId || null, notes: f.notes || null, idempotencyKey: idemKey() };
    if (!online) {
      await enqueue("EXPENSE_CREATE", body, `Expense ₹${f.amount} · ${f.category}`);
      setMsg("Saved on this phone; will sync.");
    } else {
      await add.mutateAsync(body);
      setMsg("Expense saved.");
    }
    setF((x) => ({ ...x, amount: "", notes: "" }));
  }
  return (
    <>
      <Card>
        <form className="grid grid-cols-2 gap-3" onSubmit={submit}>
          <Field label="Date" htmlFor="ed"><Input id="ed" type="date" value={f.expenseDate} onChange={(e) => setF((x) => ({ ...x, expenseDate: e.target.value }))} /></Field>
          <Field label="Category" htmlFor="ec"><Select id="ec" value={f.category} onChange={(e) => setF((x) => ({ ...x, category: e.target.value }))}>{CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ").toLowerCase()}</option>)}</Select></Field>
          <Field label="Amount (₹)" htmlFor="ea"><Input id="ea" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} /></Field>
          <Field label="Paid by" htmlFor="em"><Select id="em" value={f.paymentModeId} onChange={(e) => setF((x) => ({ ...x, paymentModeId: e.target.value }))}><option value="">—</option>{modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <div className="col-span-2"><Field label="Notes" htmlFor="en"><Input id="en" value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} placeholder="e.g. Oddanchatram → Kochi lorry" /></Field></div>
          {add.errorText ? <p className="col-span-2 text-sm text-chilli-700">{add.errorText}</p> : null}
          {msg ? <p className="col-span-2 text-sm font-semibold text-leaf-800">{msg}</p> : null}
          <Button className="col-span-2" disabled={!f.amount}>Save expense</Button>
        </form>
      </Card>
      <Card>
        <CardTitle className="mb-2">Recent expenses</CardTitle>
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : null}
        <ul className="divide-y divide-line text-sm">
          {list.data?.map((x) => (
            <li key={x.id} className="flex items-center justify-between py-2">
              <span><DateText value={x.expenseDate} /> · {x.category.replace("_", " ").toLowerCase()} {x.notes ? `· ${x.notes}` : ""} {x.mode ? `· ${x.mode}` : ""}</span>
              <span className="flex items-center gap-2"><Money value={x.amount} />{x.status === "CANCELLED" ? <Badge tone="red">cancelled</Badge> : canCancel ? <Button variant="ghost" size="sm" onClick={() => confirm("Cancel this expense? It stays in history.") && cancel.mutate({ id: x.id })}>Cancel</Button> : null}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Salaries() {
  const { modes } = useMasters();
  const workers = useApi<Array<{ id: string; name: string; isActive: boolean }>>(["workers"], "/api/workers");
  const list = useApi<Array<{ id: string; worker: string; paymentDate: string; amount: string; status: string; mode: string | null; periodFrom: string | null; periodTo: string | null }>>(["salaries"], "/api/salaries");
  const [f, setF] = useState({ workerId: "", paymentDate: today(), periodFrom: "", periodTo: "", amount: "", paymentModeId: "", notes: "" });
  const [w, setW] = useState("");
  const add = useAction<Record<string, unknown>>("POST", "/api/salaries");
  const addW = useAction<{ name: string }>("POST", "/api/workers");
  const cancel = useAction<{ id: string }>("POST", (b) => `/api/salaries/${b.id}/cancel`);
  return (
    <>
      <Card className="space-y-3">
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await addW.mutateAsync({ name: w }); setW(""); }}>
          <Input placeholder="New worker name" value={w} onChange={(e) => setW(e.target.value)} aria-label="New worker" />
          <Button variant="outline" disabled={!w}>Add worker</Button>
        </form>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); await add.mutateAsync({ ...f, periodFrom: f.periodFrom || null, periodTo: f.periodTo || null, paymentModeId: f.paymentModeId || null, notes: f.notes || null, idempotencyKey: idemKey() }); setF((x) => ({ ...x, amount: "" })); }}>
          <Field label="Worker" htmlFor="sw"><Select id="sw" value={f.workerId} onChange={(e) => setF((x) => ({ ...x, workerId: e.target.value }))}><option value="">Choose…</option>{workers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Amount (₹)" htmlFor="sa"><Input id="sa" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.]/g, "") }))} /></Field>
          <Field label="Paid on" htmlFor="sd"><Input id="sd" type="date" value={f.paymentDate} onChange={(e) => setF((x) => ({ ...x, paymentDate: e.target.value }))} /></Field>
          <Field label="Paid by" htmlFor="sm"><Select id="sm" value={f.paymentModeId} onChange={(e) => setF((x) => ({ ...x, paymentModeId: e.target.value }))}><option value="">—</option>{modes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
          <Field label="Period from" htmlFor="pf"><Input id="pf" type="date" value={f.periodFrom} onChange={(e) => setF((x) => ({ ...x, periodFrom: e.target.value }))} /></Field>
          <Field label="Period to" htmlFor="pt"><Input id="pt" type="date" value={f.periodTo} onChange={(e) => setF((x) => ({ ...x, periodTo: e.target.value }))} /></Field>
          {add.errorText ? <p className="col-span-2 text-sm text-chilli-700">{add.errorText}</p> : null}
          <Button className="col-span-2" disabled={!f.workerId || !f.amount}>Save salary payment</Button>
        </form>
      </Card>
      <Card>
        <CardTitle className="mb-2">Salary payments</CardTitle>
        <ul className="divide-y divide-line text-sm">
          {list.data?.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <span><DateText value={s.paymentDate} /> · {s.worker} {s.periodFrom ? `· ${s.periodFrom} → ${s.periodTo ?? ""}` : ""}</span>
              <span className="flex items-center gap-2"><Money value={s.amount} />{s.status === "CANCELLED" ? <Badge tone="red">cancelled</Badge> : <Button variant="ghost" size="sm" onClick={() => confirm("Cancel this salary payment?") && cancel.mutate({ id: s.id })}>Cancel</Button>}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
