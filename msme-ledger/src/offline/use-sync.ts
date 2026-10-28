// src/offline/use-sync.ts — React hook exposing online / queue status and running background sync.
"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { onSyncChange, processQueue, pull, recoverInterrupted, summary, type SyncSummary } from "./sync-engine";

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Browser connectivity (server render assumes online). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export function useSyncStatus(): SyncSummary & { online: boolean } {
  const online = useOnline();
  const [s, setS] = useState<SyncSummary>({ pending: 0, syncing: 0, attention: 0, lastPullAt: null });
  useEffect(() => {
    let alive = true;
    const refresh = () => summary().then((x) => alive && setS(x)).catch(() => undefined);
    refresh();
    const off = onSyncChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { ...s, online };
}

/** Mount once (in the app shell): runs sync on start, on reconnect, on focus and every 30 s. */
export function useBackgroundSync(enabled: boolean): void {
  const online = useOnline();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const run = async () => {
      if (stopped || !navigator.onLine) return;
      await processQueue().catch(() => undefined);
      await pull().catch(() => undefined);
    };
    void recoverInterrupted().then(run);
    const t = setInterval(run, 30_000);
    const vis = () => document.visibilityState === "visible" && run();
    document.addEventListener("visibilitychange", vis);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [enabled]);
  useEffect(() => {
    if (enabled && online) void processQueue().catch(() => undefined);
  }, [enabled, online]);
}
