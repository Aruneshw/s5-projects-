// src/app/(app)/stores/[id]/page.tsx — store details (edit), running-balance ledger, bank details, corrections.
"use client";
import { use, useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { DateText, Money, today } from "@/components/common/format";
import { Can } from "@/components/auth/can";
import Link from "next/link";

interface Store { id: string; type: string; shopName: string; city: string; location: string | null; ownerName: string | null; coOwnerName: string | null; contactName: string | null; phone: string | null; address: string | null; upiId: string | null; storeMark: string | null; isActive: boolean; version: number; label: string }
interface Ledger { broughtForward: string; closing: string; rows: Array<{ id: string; entryDate: string; entryType: string; description: string; amount: string; runningBalance: string; billId: string | null; isReversal: boolean }> }
interface Bank { accountName: string; accountNumberMasked: string; ifsc: string; bankName: string | null }

export default function StorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const store = useApi<Store>(["store", id], `/api/stores/${id}`);
  const ledger = useApi<Ledger>(["store-ledger", id], `/api/stores/${id}/ledger`);
  const [edit, setEdit] = useState(false);
  const [adj, setAdj] = useState(false);
  const [bank, setBank] = useState(false);
  if (store.isLoading) return <Loading />;
  if (store.error) return <ErrorState error={store.error} />;
  const s = store.data!;
  return (
    <div className="space-y-4">
      <PageHeader title={s.label} subtitle={s.type === "CUSTOMER" ? "Customer · balance = they owe us" : "Supplier · balance = we owe them"} actions={<>{!s.isActive ? <Badge>inactive</Badge> : null}<Button variant="outline" onClick={() => setEdit(true)}>Edit</Button></>} />
      <Card className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {[["Mark", s.storeMark], ["Owner", s.ownerName], ["Co-owner", s.coOwnerName], ["Contact", s.contactName], ["Phone", s.phone], ["UPI", s.upiId], ["Location", s.location], ["Address", s.address]].map(([k, v]) => (
          <div key={k}><div className="text-xs text-muted">{k}</div><div className="font-semibold">{v || "—"}</div></div>
        ))}
      </Card>
      <div className="flex flex-wrap gap-2">
        <Can perm="store:bank:read"><Button variant="outline" onClick={() => setBank(true)}>Bank details</Button></Can>
        <Can perm="store:adjust"><Button variant="outline" onClick={() => setAdj(true)}>Balance correction</Button></Can>
        <Button variant="outline" asChild><Link href={`/payments?storeId=${s.id}`}>Record payment</Link></Button>
      </div>
      <Can perm="ledger:read">
        <Card>
          <div className="mb-2 flex items-center justify-between"><CardTitle>Ledger</CardTitle><div className="text-right"><div className="text-xs text-muted">Balance</div><Money value={ledger.data?.closing} strong className="text-lg" /></div></div>
          {ledger.isLoading ? <Loading /> : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2">Date</th><th>Details</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ledger.data?.rows.map((r) => (
                  <tr key={r.id} className={r.isReversal ? "text-muted line-through decoration-chilli-600/40" : ""}>
                    <td className="py-2"><DateText value={r.entryDate} /></td>
                    <td>{r.billId ? <Link className="text-leaf-700" href={`/bills/${r.billId}`}>{r.description}</Link> : r.description}</td>
                    <td className="text-right"><Money value={r.amount} /></td>
                    <td className="text-right font-semibold"><Money value={r.runningBalance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Can>
      {edit ? <EditDialog s={s} onClose={() => setEdit(false)} /> : null}
      {adj ? <AdjDialog storeId={s.id} onClose={() => setAdj(false)} /> : null}
      {bank ? <BankDialog storeId={s.id} onClose={() => setBank(false)} /> : null}
    </div>
  );
}

function EditDialog({ s, onClose }: { s: Store; onClose: () => void }) {
  const [f, setF] = useState({ shopName: s.shopName, city: s.city, location: s.location ?? "", ownerName: s.ownerName ?? "", coOwnerName: s.coOwnerName ?? "", contactName: s.contactName ?? "", phone: s.phone ?? "", address: s.address ?? "", upiId: s.upiId ?? "", storeMark: s.storeMark ?? "", isActive: s.isActive });
  const save = useAction<typeof f & { version: number }>("PATCH", `/api/stores/${s.id}`);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit store" description="The opening balance cannot be edited here; use a balance correction.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync({ ...f, version: s.version }); onClose(); }}>
        <div className="grid grid-cols-2 gap-3">
          {(["shopName", "city", "location", "storeMark", "ownerName", "coOwnerName", "contactName", "phone", "upiId", "address"] as const).map((k) => (
            <Field key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()} htmlFor={`e-${k}`}><Input id={`e-${k}`} value={f[k]} onChange={set(k)} /></Field>
          ))}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={f.isActive} onChange={(e) => setF((x) => ({ ...x, isActive: e.target.checked }))} /> Active</label>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Button className="w-full" disabled={save.isPending}>Save</Button>
      </form>
    </Dialog>
  );
}

function AdjDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const [f, setF] = useState({ type: "BALANCE_CORRECTION", amount: "", reason: "", entryDate: today() });
  const save = useAction<typeof f>("POST", `/api/stores/${storeId}/adjustments`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Balance correction" description="Recorded in the ledger with your name and reason. Nothing is overwritten.">
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync(f); onClose(); }}>
        <Field label="Type" htmlFor="at"><Select id="at" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))}><option value="BALANCE_CORRECTION">Balance correction</option><option value="OPENING_BALANCE_CORRECTION">Opening balance correction</option></Select></Field>
        <Field label="Amount (₹, use − to reduce)" htmlFor="aa"><Input id="aa" inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value.replace(/[^\d.-]/g, "") }))} /></Field>
        <Field label="Reason" htmlFor="ar"><Input id="ar" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} /></Field>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Button className="w-full" disabled={!f.amount || f.reason.length < 5}>Save correction</Button>
      </form>
    </Dialog>
  );
}

function BankDialog({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const bank = useApi<Bank | null>(["bank", storeId], `/api/stores/${storeId}/bank`);
  if (bank.isLoading) return null;
  return <BankForm storeId={storeId} saved={bank.data ?? null} onClose={onClose} />;
}

function BankForm({ storeId, saved, onClose }: { storeId: string; saved: Bank | null; onClose: () => void }) {
  const bank = { data: saved };
  const [f, setF] = useState({ accountName: saved?.accountName ?? "", accountNumber: "", ifsc: saved?.ifsc ?? "", bankName: saved?.bankName ?? "" });
  const save = useAction<typeof f>("PUT", `/api/stores/${storeId}/bank`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Bank details" description="Visible to owners only. The full account number is never shown again after saving.">
      {bank.data ? <p className="mb-2 text-sm">Saved: {bank.data.accountName} · {bank.data.accountNumberMasked} · {bank.data.ifsc}</p> : null}
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); await save.mutateAsync(f); onClose(); }}>
        <Field label="Account name" htmlFor="bn"><Input id="bn" value={f.accountName} onChange={(e) => setF((x) => ({ ...x, accountName: e.target.value }))} /></Field>
        <Field label="Account number" htmlFor="bno"><Input id="bno" inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={(e) => setF((x) => ({ ...x, accountNumber: e.target.value.replace(/\D/g, "") }))} /></Field>
        <Field label="IFSC" htmlFor="bi"><Input id="bi" value={f.ifsc} onChange={(e) => setF((x) => ({ ...x, ifsc: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Bank" htmlFor="bb"><Input id="bb" value={f.bankName} onChange={(e) => setF((x) => ({ ...x, bankName: e.target.value }))} /></Field>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Can perm="store:bank:write"><Button className="w-full" disabled={!f.accountNumber}>Save bank details</Button></Can>
      </form>
    </Dialog>
  );
}
