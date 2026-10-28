// src/app/(app)/stores/page.tsx — store master: search shows "Shop Name — City"; opening balance only on create.
"use client";
import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useApi, useAction } from "@/lib/hooks";
import { Card, PageHeader, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { RequirePerm } from "@/components/auth/can";

interface StoreRow {
  id: string;
  type: "SUPPLIER" | "CUSTOMER";
  label: string;
  phone: string | null;
  storeMark: string | null;
  isActive: boolean;
}

export default function StoresPage() {
  const [type, setType] = useState<"CUSTOMER" | "SUPPLIER">("CUSTOMER");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useApi<StoreRow[]>(["stores", type, q], `/api/stores?type=${type}&includeInactive=1${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <RequirePerm perm="store:write">
      <PageHeader title="Stores" subtitle="Suppliers and customers" actions={<Button onClick={() => setOpen(true)}><Plus /> Add store</Button>} />
      <div className="space-y-3">
        <Segmented label="Store type" value={type} onChange={setType} options={[{ value: "CUSTOMER", label: "Customers" }, { value: "SUPPLIER", label: "Suppliers" }]} />
        <Input placeholder="Search shop, city or mark" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stores" />
        {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : null}
        {list.data?.length === 0 ? <Empty title="No stores yet" /> : null}
        <ul className="space-y-2">
          {list.data?.map((s) => (
            <li key={s.id}>
              <Link href={`/stores/${s.id}`}>
                <Card className="flex items-center justify-between p-3">
                  <div>
                    <div className="font-bold">{s.label}</div>
                    <div className="text-xs text-muted">{[s.storeMark && `Mark ${s.storeMark}`, s.phone].filter(Boolean).join(" · ")}</div>
                  </div>
                  {!s.isActive ? <Badge>inactive</Badge> : null}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <NewStoreDialog open={open} onOpenChange={setOpen} defaultType={type} />
    </RequirePerm>
  );
}

function NewStoreDialog({ open, onOpenChange, defaultType }: { open: boolean; onOpenChange: (o: boolean) => void; defaultType: "CUSTOMER" | "SUPPLIER" }) {
  const empty = { type: defaultType, shopName: "", city: "", location: "", ownerName: "", coOwnerName: "", contactName: "", phone: "", address: "", upiId: "", storeMark: "", openingBalance: "" };
  const [f, setF] = useState(empty);
  const save = useAction<typeof f>("POST", "/api/stores");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setF({ ...empty, type: defaultType }); }} title="Add store">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await save.mutateAsync({ ...f, openingBalance: f.openingBalance || "0" });
          onOpenChange(false);
        }}
      >
        <Segmented label="Type" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v }))} options={[{ value: "CUSTOMER", label: "Customer" }, { value: "SUPPLIER", label: "Supplier" }]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Shop name *" htmlFor="sn"><Input id="sn" value={f.shopName} onChange={set("shopName")} required /></Field>
          <Field label="City *" htmlFor="sc"><Input id="sc" value={f.city} onChange={set("city")} required /></Field>
          <Field label="Location" htmlFor="sl"><Input id="sl" value={f.location} onChange={set("location")} /></Field>
          <Field label="Store mark / code" htmlFor="sm"><Input id="sm" value={f.storeMark} onChange={set("storeMark")} /></Field>
          <Field label="Owner" htmlFor="so"><Input id="so" value={f.ownerName} onChange={set("ownerName")} /></Field>
          <Field label="Co-owner" htmlFor="sco"><Input id="sco" value={f.coOwnerName} onChange={set("coOwnerName")} /></Field>
          <Field label="Worker / contact" htmlFor="sw"><Input id="sw" value={f.contactName} onChange={set("contactName")} /></Field>
          <Field label="Phone" htmlFor="sp"><Input id="sp" inputMode="tel" value={f.phone} onChange={set("phone")} /></Field>
          <Field label="UPI ID" htmlFor="su"><Input id="su" value={f.upiId} onChange={set("upiId")} placeholder="name@bank" /></Field>
          <Field label="Opening balance (₹)" hint="Only now. + = they owe us / we owe them" htmlFor="sob"><Input id="sob" inputMode="decimal" value={f.openingBalance} onChange={set("openingBalance")} /></Field>
        </div>
        <Field label="Postal address" htmlFor="sa"><Input id="sa" value={f.address} onChange={set("address")} /></Field>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        <Button className="w-full" disabled={!f.shopName || !f.city || save.isPending}>Save store</Button>
      </form>
    </Dialog>
  );
}
