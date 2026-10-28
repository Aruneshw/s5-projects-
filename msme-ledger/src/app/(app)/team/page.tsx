// src/app/(app)/team/page.tsx — members, roles, deactivation and one-time reset links.
"use client";
import { useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { RequirePerm } from "@/components/auth/can";
import { useMe } from "@/components/auth/me";

interface Member { membershipId: string; userId: string; username: string; displayName: string; role: string; isActive: boolean }

export default function TeamPage() {
  const me = useMe();
  const q = useApi<Member[]>(["team"], "/api/team");
  const [f, setF] = useState({ username: "", displayName: "", password: "", role: "STAFF_CASHIER" });
  const add = useAction<typeof f>("POST", "/api/team");
  const upd = useAction<{ id: string; role?: string; isActive?: boolean }>("PATCH", (b) => `/api/team/${b.id}`);
  const reset = useAction<{ id: string }, { url: string; expiresInMinutes: number }>("POST", (b) => `/api/team/${b.id}/reset-link`);
  const [link, setLink] = useState<string | null>(null);
  return (
    <RequirePerm perm="team:manage">
      <PageHeader title="Team" subtitle="Me and Dad are owners with full access. Cashiers can enter sales and expenses only." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      <div className="space-y-2">
        {q.data?.map((m) => (
          <Card key={m.membershipId} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div><div className="font-bold">{m.displayName} {!m.isActive ? <Badge tone="red">inactive</Badge> : null}</div><div className="text-xs text-muted">@{m.username}</div></div>
            <div className="flex flex-wrap items-center gap-2">
              <Select aria-label={`Role of ${m.displayName}`} className="h-10 w-40" value={m.role} disabled={m.userId === me?.userId} onChange={(e) => upd.mutate({ id: m.membershipId, role: e.target.value })}>
                <option value="MSME_OWNER">Owner</option><option value="STAFF_CASHIER">Cashier</option>
              </Select>
              {m.userId !== me?.userId ? <Button variant="ghost" size="sm" onClick={() => upd.mutate({ id: m.membershipId, isActive: !m.isActive })}>{m.isActive ? "Deactivate" : "Activate"}</Button> : null}
              <Button variant="outline" size="sm" onClick={async () => { const r = await reset.mutateAsync({ id: m.membershipId }); setLink(r.url); }}>Reset link</Button>
            </div>
          </Card>
        ))}
      </div>
      {upd.errorText ? <p className="mt-2 text-sm text-chilli-700">{upd.errorText}</p> : null}
      {link ? (
        <Card className="mt-3 space-y-2 border-turmeric-100 bg-turmeric-100/40">
          <p className="text-sm font-semibold">One-time reset link (valid 30 minutes). Share it privately — it is shown only once:</p>
          <code className="block break-all rounded bg-card p-2 text-xs">{link}</code>
          <div className="flex gap-2"><Button size="sm" onClick={() => navigator.clipboard.writeText(link)}>Copy</Button><Button size="sm" variant="outline" asChild><a href={`https://wa.me/?text=${encodeURIComponent(`Your password reset link: ${link}`)}`} target="_blank" rel="noreferrer">WhatsApp</a></Button></div>
        </Card>
      ) : null}
      <Card className="mt-4">
        <CardTitle className="mb-2">Add member</CardTitle>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); await add.mutateAsync(f); setF({ username: "", displayName: "", password: "", role: "STAFF_CASHIER" }); }}>
          <Field label="Username" htmlFor="tu"><Input id="tu" autoCapitalize="none" value={f.username} onChange={(e) => setF((x) => ({ ...x, username: e.target.value }))} /></Field>
          <Field label="Display name" htmlFor="tn"><Input id="tn" value={f.displayName} onChange={(e) => setF((x) => ({ ...x, displayName: e.target.value }))} /></Field>
          <Field label="Temporary password" hint="8+ characters, a letter and a number" htmlFor="tp"><Input id="tp" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((x) => ({ ...x, password: e.target.value }))} /></Field>
          <Field label="Role" htmlFor="tr"><Select id="tr" value={f.role} onChange={(e) => setF((x) => ({ ...x, role: e.target.value }))}><option value="STAFF_CASHIER">Cashier</option><option value="MSME_OWNER">Owner</option></Select></Field>
          {add.errorText ? <p className="col-span-2 text-sm text-chilli-700">{add.errorText}</p> : null}
          <Button className="col-span-2" disabled={add.isPending}>Add member</Button>
        </form>
      </Card>
    </RequirePerm>
  );
}
