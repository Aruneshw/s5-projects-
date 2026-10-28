// src/components/layout/app-shell.tsx — sidebar (desktop), bottom bar (phone), sync status, idle logout.
"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { getSession, signOut } from "next-auth/react";
import { CloudOff, CloudUpload, LogOut, Menu, RefreshCw, TriangleAlert, Wifi } from "lucide-react";
import { navFor } from "./nav";
import { MeProvider, type Me } from "@/components/auth/me";
import { useBackgroundSync, useSyncStatus } from "@/offline/use-sync";
import { wipeLocal } from "@/offline/db";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export async function logout(reason?: "idle") {
  try {
    navigator.serviceWorker?.controller?.postMessage("clear-pages");
    await wipeLocal();
  } catch {
    /* ignore */
  }
  await signOut({ callbackUrl: reason ? `/login?reason=${reason}` : "/login" });
}

function SyncPill() {
  const s = useSyncStatus();
  let tone = "bg-leaf-100 text-leaf-800";
  let icon = <Wifi className="size-4" />;
  let text = "Online · synced";
  if (!s.online) {
    tone = "bg-turmeric-100 text-turmeric-700";
    icon = <CloudOff className="size-4" />;
    text = s.pending ? `Offline · ${s.pending} saved on phone` : "Offline · saving on phone";
  } else if (s.syncing || s.pending) {
    tone = "bg-sky-600/10 text-sky-600";
    icon = <RefreshCw className="size-4 animate-spin" />;
    text = `Syncing ${s.pending + s.syncing}…`;
  }
  if (s.attention) {
    tone = "bg-chilli-100 text-chilli-700";
    icon = <TriangleAlert className="size-4" />;
    text = `${s.attention} need attention`;
  }
  return (
    <Link href="/sync" aria-live="polite" className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold", tone)}>
      {icon}
      <span>{text}</span>
      {s.online && s.pending > 0 ? <CloudUpload className="size-4" /> : null}
    </Link>
  );
}

/** Signs out after N minutes without interaction; keeps the session cookie fresh while active. */
function useIdleLogout(minutes: number) {
  const last = useRef(0);
  const lastPing = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    lastPing.current = Date.now();
    const bump = () => {
      last.current = Date.now();
      if (Date.now() - lastPing.current > 4 * 60_000) {
        lastPing.current = Date.now();
        void getSession(); // re-issues the JWT cookie, extending the inactivity window
      }
    };
    const evs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - last.current > minutes * 60_000) void logout("idle");
    }, 30_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [minutes]);
}

export function AppShell({ me, children }: { me: Me; children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [more, setMore] = useState(false);
  const items = navFor(me.permissions);
  const primary = items.filter((i) => i.primary).slice(0, 4);
  useBackgroundSync(me.permissions.includes("sync:use"));
  useIdleLogout(me.inactivityTimeoutMinutes);

  const isActive = (href: string) => {
    const [p, q] = href.split("?");
    if (pathname !== p) return false;
    if (!q) return true;
    const want = new URLSearchParams(q);
    return [...want.entries()].every(([k, v]) => search.get(k) === v);
  };

  return (
    <MeProvider me={me}>
      <div className="min-h-dvh md:grid md:grid-cols-[250px_1fr]">
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-card md:flex">
          <div className="border-b border-line p-4">
            <div className="text-lg font-extrabold">{me.orgName}</div>
            <div className="text-xs text-muted">
              {me.displayName} · {me.role.replace("_", " ").toLowerCase()}
            </div>
          </div>
          <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
            {items.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn("flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold", isActive(n.href) ? "bg-leaf-100 text-leaf-800" : "text-ink hover:bg-paper")}
              >
                <n.icon className="size-5" /> {n.label}
              </Link>
            ))}
          </nav>
          <button onClick={() => logout()} className="m-2 flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-chilli-700 hover:bg-chilli-100">
            <LogOut className="size-5" /> Sign out
          </button>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line bg-paper/95 px-4 py-2 backdrop-blur">
            <div className="truncate font-extrabold md:hidden">{me.orgName}</div>
            <div className="ml-auto">
              <SyncPill />
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:pb-10">{children}</main>
        </div>

        <nav aria-label="Quick" className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card md:hidden">
          {primary.map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", isActive(n.href) ? "text-leaf-700" : "text-muted")}>
              <n.icon className="size-6" />
              <span className="truncate">{n.label}</span>
            </Link>
          ))}
          <button onClick={() => setMore(true)} className="flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted" style={{ gridColumnStart: 5 }}>
            <Menu className="size-6" /> More
          </button>
        </nav>

        <Dialog open={more} onOpenChange={setMore} title="Menu">
          <div className="grid grid-cols-2 gap-2">
            {items.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex h-14 items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold">
                <n.icon className="size-5 text-leaf-700" /> {n.label}
              </Link>
            ))}
            <button onClick={() => logout()} className="flex h-14 items-center gap-2 rounded-xl border border-chilli-100 px-3 text-sm font-semibold text-chilli-700">
              <LogOut className="size-5" /> Sign out
            </button>
          </div>
        </Dialog>
      </div>
    </MeProvider>
  );
}
