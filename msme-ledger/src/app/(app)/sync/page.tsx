// src/app/(app)/sync/page.tsx — what is waiting on this phone, and conflicts that need a person's decision.
"use client";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { localDb, type LocalMutation } from "@/offline/db";
import { onSyncChange, processQueue, pull, resolveLocal } from "@/offline/sync-engine";
import { useSyncStatus } from "@/offline/use-sync";
import { useApi } from "@/lib/hooks";

interface ServerConflict { id: string; type: string; status: string; deviceId: string; error: { message?: string } | null; createdAt: string }

export default function SyncPage() {
  const s = useSyncStatus();
  const [items, setItems] = useState<LocalMutation[]>([]);
  const server = useApi<ServerConflict[]>(["sync-conflicts"], "/api/sync/conflicts");
  useEffect(() => {
    const load = () => localDb().mutations.orderBy("createdAt").reverse().limit(100).toArray().then(setItems);
    void load();
    return onSyncChange(() => void load());
  }, []);
  const tone = (st: string) => (st === "synced" ? "green" : st === "conflict" || st === "error" ? "red" : st === "syncing" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sync"
        subtitle={s.online ? "Online" : "Offline — records are kept on this phone"}
        actions={<Button variant="outline" disabled={!s.online} onClick={async () => { await processQueue(); await pull(); void server.refetch(); }}><RefreshCw /> Sync now</Button>}
      />
      <p className="text-sm text-muted">Each phone keeps its own copy and syncs through the server. Nothing waiting here is ever deleted automatically. The server re-checks every bill and decides the final totals.</p>
      <Card>
        <CardTitle className="mb-2">On this phone</CardTitle>
        {items.length === 0 ? <p className="text-sm text-muted">Nothing queued.</p> : null}
        <ul className="divide-y divide-line">
          {items.map((m) => (
            <li key={m.id} className="space-y-1 py-3">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{m.label}</span><Badge tone={tone(m.status)}>{m.status}</Badge></div>
              <div className="text-xs text-muted">{new Date(m.createdAt).toLocaleString("en-IN")} · attempts {m.attempts}{m.status === "pending" && m.attempts > 0 ? ` · next try ${new Date(m.nextAttemptAt).toLocaleTimeString("en-IN")}` : ""}</div>
              {m.lastError ? <div className="text-sm text-chilli-700">{m.lastError}</div> : null}
              {m.status === "conflict" || m.status === "error" ? (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => resolveLocal(m.id, "retry")}>Send again</Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm("Remove this record from the phone? The server copy (if any) is untouched.") && resolveLocal(m.id, "discard")}>Discard my copy</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardTitle className="mb-2">Server conflicts (all devices)</CardTitle>
        {server.data?.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
        <ul className="divide-y divide-line text-sm">
          {server.data?.map((c) => <li key={c.id} className="py-2"><Badge tone="red">{c.status.toLowerCase()}</Badge> {c.type} from {c.deviceId} — {c.error?.message ?? ""}</li>)}
        </ul>
      </Card>
    </div>
  );
}
