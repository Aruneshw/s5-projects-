// src/app/(app)/audit/page.tsx — who changed what, when (from database triggers and app events).
"use client";
import { useState } from "react";
import { useApi } from "@/lib/hooks";
import { Card, PageHeader, Badge } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { RequirePerm } from "@/components/auth/can";

interface Row { id: string; at: string; actor: string; action: string; entityType: string; entityId: string; source: string; oldData: unknown; newData: unknown }

export default function AuditPage() {
  const [type, setType] = useState("");
  const q = useApi<Row[]>(["audit", type], `/api/audit${type ? `?entityType=${type}` : ""}`);
  return (
    <RequirePerm perm="audit:read">
      <PageHeader title="Audit log" subtitle="Append-only. Nobody — including owners — can edit or delete these records." actions={
        <Select aria-label="Filter" value={type} onChange={(e) => setType(e.target.value)} className="w-48">
          <option value="">Everything</option>
          {["bills", "ledger_entries", "payments", "bill_adjustments", "stores", "items", "memberships", "discount_requests", "report", "users"].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      } />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : null}
      <ul className="space-y-2">
        {q.data?.map((r) => (
          <li key={r.id}>
            <Card className="p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{r.actor} · {r.action} · {r.entityType}</span><span className="text-xs text-muted">{new Date(r.at).toLocaleString("en-IN")} <Badge>{r.source === "APP" ? "app" : "db"}</Badge></span></div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-leaf-700">Details</summary><pre className="mt-1 max-h-64 overflow-auto rounded bg-paper p-2 text-xs">{JSON.stringify({ before: r.oldData, after: r.newData }, null, 2)}</pre></details>
            </Card>
          </li>
        ))}
      </ul>
    </RequirePerm>
  );
}
