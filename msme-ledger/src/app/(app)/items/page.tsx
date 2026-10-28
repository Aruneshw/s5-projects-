// src/app/(app)/items/page.tsx — item master. Grades of the same item stay ONE item (use the line mark).
"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Empty, ErrorState, Loading } from "@/components/ui/states";
import { Money } from "@/components/common/format";
import { RequirePerm } from "@/components/auth/can";

interface Item { id: string; name: string; unitType: "KG" | "BAG" | "BOX"; cooliePerBag: string; isActive: boolean }

export default function ItemsPage() {
  const list = useApi<Item[]>(["items-all"], "/api/items?includeInactive=1");
  const [f, setF] = useState({ name: "", unitType: "KG", cooliePerBag: "" });
  const add = useAction<typeof f>("POST", "/api/items");
  const upd = useAction<{ id: string; isActive?: boolean; cooliePerBag?: string }>("PATCH", (b) => `/api/items/${b.id}`);
  return (
    <RequirePerm perm="item:write">
      <PageHeader title="Items" subtitle="Two grades of the same vegetable stay one item — use the line mark on the bill for grade" />
      <Card className="mb-4">
        <form className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); await add.mutateAsync({ ...f, cooliePerBag: f.cooliePerBag || "0" }); setF({ name: "", unitType: "KG", cooliePerBag: "" }); }}>
          <Field label="Item name" htmlFor="in"><Input id="in" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
          <Field label="Unit" htmlFor="iu"><Select id="iu" value={f.unitType} onChange={(e) => setF((x) => ({ ...x, unitType: e.target.value }))}><option value="KG">kg (weighed)</option><option value="BAG">bag</option><option value="BOX">box</option></Select></Field>
          <Field label="Coolie per bag (₹)" htmlFor="ic"><Input id="ic" inputMode="decimal" value={f.cooliePerBag} onChange={(e) => setF((x) => ({ ...x, cooliePerBag: e.target.value }))} /></Field>
          <Button disabled={!f.name || add.isPending}><Plus /> Add</Button>
        </form>
        {add.errorText ? <p className="mt-2 text-sm text-chilli-700">{add.errorText}</p> : null}
      </Card>
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={list.error} /> : null}
      {list.data?.length === 0 ? <Empty title="No items yet" /> : null}
      <ul className="space-y-2">
        {list.data?.map((i) => (
          <li key={i.id}>
            <Card className="flex items-center justify-between gap-3 p-3">
              <div>
                <div className="font-bold">{i.name} {!i.isActive ? <Badge>inactive</Badge> : null}</div>
                <div className="text-xs text-muted">{i.unitType === "KG" ? "Weighed bag by bag (kg)" : `Counted in ${i.unitType.toLowerCase()}es`.replace("bages", "bags")} · coolie <Money value={i.cooliePerBag} /> per bag</div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: i.id, isActive: !i.isActive })}>{i.isActive ? "Deactivate" : "Activate"}</Button>
            </Card>
          </li>
        ))}
      </ul>
    </RequirePerm>
  );
}
