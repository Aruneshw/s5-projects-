// src/app/(app)/inventory/page.tsx — stock today / for a date range, alerts, movement history, reconciliation.
"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { ErrorState, Loading } from "@/components/ui/states";
import { DateText, today } from "@/components/common/format";
import { RequirePerm, Can } from "@/components/auth/can";
import { formatQty } from "@/lib/money";

interface StockRow { itemId: string; name: string; unit: string; quantity: string; bagCount: number; lastPurchaseDate: string | null; ageDays: number | null; stale: boolean; negative: boolean; oversoldFlag: boolean }
interface RangeRow { itemId: string; name: string; unit: string; opening: string; inQty: string; outQty: string; closing: string }
interface Moves { item: { name: string; unit: string }; movements: Array<{ id: string; date: string; type: string; quantity: string; bagCount: number; note: string | null; billId: string | null; billNumber: number | null; billType: string | null }> }
interface Recon { adjustments: Array<{ id: string; date: string; item: string; unit: string; quantity: string; reason: string | null }>; oversold: Array<{ id: string; item: string; quantity: string; salesBillId: string; salesBillNumber: number | null; salesBillStatus: string; purchaseBillId: string; purchaseBillNumber: number | null }> }

export default function InventoryPage() {
  const [mode, setMode] = useState<"today" | "range" | "recon">("today");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [item, setItem] = useState<string | null>(null);
  const [adj, setAdj] = useState(false);
  const stock = useApi<{ rows: StockRow[] }>(["stock"], mode === "today" ? "/api/inventory" : null);
  const range = useApi<{ rows: RangeRow[] }>(["stock-range", from, to], mode === "range" ? `/api/inventory?from=${from}&to=${to}` : null);
  const recon = useApi<Recon>(["recon"], mode === "recon" ? "/api/inventory/reconciliation" : null);
  return (
    <RequirePerm perm="inventory:read">
      <PageHeader title="Inventory" subtitle="Purchases add stock (+), sales remove it (−)" actions={<Can perm="inventory:adjust"><Button variant="outline" onClick={() => setAdj(true)}>Stock correction</Button></Can>} />
      <Segmented label="View" value={mode} onChange={setMode} options={[{ value: "today", label: "Today" }, { value: "range", label: "Date range" }, { value: "recon", label: "Reconciliation" }]} />
      <div className="mt-3 space-y-2">
        {mode === "today" ? (
          stock.isLoading ? <Loading /> : stock.error ? <ErrorState error={stock.error} /> : stock.data?.rows.map((r) => (
            <Card key={r.itemId} className="flex items-center justify-between p-3">
              <button className="text-left" onClick={() => setItem(r.itemId)}>
                <div className="font-bold">{r.name}</div>
                <div className="text-xs text-muted">Last bought <DateText value={r.lastPurchaseDate} />{r.ageDays !== null ? ` · ${r.ageDays} day(s) ago` : ""}</div>
                <div className="mt-1 flex gap-1">{r.negative ? <Badge tone="red">negative</Badge> : null}{r.stale ? <Badge tone="amber">old stock</Badge> : null}{r.oversoldFlag ? <Badge tone="red">oversold batch</Badge> : null}</div>
              </button>
              <div className="num text-right"><div className="text-lg font-extrabold">{formatQty(r.quantity, r.unit)}</div><div className="text-xs text-muted">{r.bagCount} bag(s)</div></div>
            </Card>
          ))
        ) : null}
        {mode === "range" ? (
          <>
            <div className="grid grid-cols-2 gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></div>
            {range.isLoading ? <Loading /> : range.error ? <ErrorState error={range.error} /> : null}
            <div className="overflow-x-auto"><table className="num w-full min-w-[480px] text-sm"><thead><tr className="text-left text-xs text-muted"><th className="py-2">Item</th><th className="text-right">Opening</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Closing</th></tr></thead>
              <tbody className="divide-y divide-line">{range.data?.rows.map((r) => <tr key={r.itemId}><td className="py-2 font-semibold">{r.name}</td><td className="text-right">{formatQty(r.opening, r.unit)}</td><td className="text-right text-leaf-700">+{formatQty(r.inQty, r.unit)}</td><td className="text-right text-chilli-700">−{formatQty(r.outQty, r.unit)}</td><td className="text-right font-bold">{formatQty(r.closing, r.unit)}</td></tr>)}</tbody></table></div>
          </>
        ) : null}
        {mode === "recon" ? (
          recon.isLoading ? <Loading /> : recon.data ? (
            <>
              <Card><CardTitle className="mb-2">Oversold batches to review</CardTitle>{recon.data.oversold.length === 0 ? <p className="text-sm text-muted">None</p> : null}
                <ul className="divide-y divide-line text-sm">{recon.data.oversold.map((o) => <li key={o.id} className="py-2">{o.item}: {o.quantity} sold via <Link className="text-leaf-700" href={`/bills/${o.salesBillId}`}>sale #{o.salesBillNumber}</Link> from <Link className="text-leaf-700" href={`/bills/${o.purchaseBillId}`}>purchase #{o.purchaseBillNumber}</Link> {o.salesBillStatus === "CANCELLED" ? "(sale cancelled)" : ""}</li>)}</ul></Card>
              <Card><CardTitle className="mb-2">Manual stock corrections</CardTitle>{recon.data.adjustments.length === 0 ? <p className="text-sm text-muted">None</p> : null}
                <ul className="divide-y divide-line text-sm">{recon.data.adjustments.map((a) => <li key={a.id} className="py-2"><DateText value={a.date} /> · {a.item} {formatQty(a.quantity, a.unit)} — {a.reason}</li>)}</ul></Card>
            </>
          ) : null
        ) : null}
      </div>
      {item ? <MovesDialog itemId={item} onClose={() => setItem(null)} /> : null}
      {adj ? <AdjustDialog onClose={() => setAdj(false)} /> : null}
    </RequirePerm>
  );
}

function MovesDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const q = useApi<Moves>(["moves", itemId], `/api/inventory/items/${itemId}`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={q.data ? `${q.data.item.name} movements` : "Movements"}>
      {q.isLoading ? <Loading /> : null}
      <ul className="num divide-y divide-line text-sm">
        {q.data?.movements.map((m) => (
          <li key={m.id} className="flex justify-between gap-2 py-2">
            <span><DateText value={m.date} /> · {m.type.replace("_", " ").toLowerCase()} {m.billId ? <Link className="text-leaf-700" href={`/bills/${m.billId}`}>#{m.billNumber}</Link> : null} {m.note ? `· ${m.note}` : ""}</span>
            <span className={Number(m.quantity) < 0 ? "text-chilli-700" : "text-leaf-700"}>{Number(m.quantity) > 0 ? "+" : ""}{formatQty(m.quantity, q.data!.item.unit)}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function AdjustDialog({ onClose }: { onClose: () => void }) {
  const items = useApi<Array<{ id: string; name: string }>>(["items"], "/api/items");
  const [f, setF] = useState({ itemId: "", quantity: "", bagCount: 0, movementDate: today(), reason: "" });
  const save = useAction<typeof f>("POST", "/api/inventory/adjustments");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Stock correction" description="Adds a correction movement with your reason. History is never edited.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync(f); onClose(); }}>
        <Field label="Item" htmlFor="si"><Select id="si" value={f.itemId} onChange={(e) => setF((x) => ({ ...x, itemId: e.target.value }))}><option value="">Choose…</option>{items.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
        <Field label="Quantity (+ add / − remove)" htmlFor="sq"><Input id="sq" inputMode="decimal" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value.replace(/[^\d.-]/g, "") }))} /></Field>
        <Field label="Reason" htmlFor="sr"><Input id="sr" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} placeholder="e.g. spoilage, recount" /></Field>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Button className="w-full" disabled={!f.itemId || !f.quantity || f.reason.length < 5}>Save correction</Button>
      </form>
    </Dialog>
  );
}
