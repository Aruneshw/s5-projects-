// src/app/offline/page.tsx — shown by the service worker when a page was never opened online.
import Link from "next/link";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">📶</div>
      <h1 className="text-2xl font-extrabold">You are offline</h1>
      <p className="text-muted">
        This screen has not been opened on this phone yet, so it is not saved for offline use. Bills you already started are safe on this phone and will sync when the
        internet returns.
      </p>
      <Link href="/bills/new?type=SALES" className="rounded-xl bg-leaf-700 px-5 py-3 font-semibold text-white">
        Open sales bill entry
      </Link>
    </main>
  );
}
