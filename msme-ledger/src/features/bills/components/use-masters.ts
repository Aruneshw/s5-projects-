// src/features/bills/components/use-masters.ts — stores / items / payment modes for bill entry.
// Reads the device cache (IndexedDB) first so bill entry works offline; refreshes from the
// server when online.
"use client";
import { useEffect, useState } from "react";
import { localDb, type CachedItem, type CachedMode, type CachedStore } from "@/offline/db";
import { onSyncChange, pull } from "@/offline/sync-engine";

export function useMasters() {
  const [stores, setStores] = useState<CachedStore[]>([]);
  const [items, setItems] = useState<CachedItem[]>([]);
  const [modes, setModes] = useState<CachedMode[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const db = localDb();
      const [s, i, m] = await Promise.all([db.stores.toArray(), db.items.toArray(), db.modes.toArray()]);
      if (!alive) return;
      setStores(s.filter((x) => x.isActive).sort((a, b) => a.shopName.localeCompare(b.shopName)));
      setItems(i.filter((x) => x.isActive).sort((a, b) => a.name.localeCompare(b.name)));
      setModes(m);
      setReady(true);
    };
    void load();
    const off = onSyncChange(() => void load());
    if (navigator.onLine) void pull().then(load).catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return { stores, items, modes, ready };
}
