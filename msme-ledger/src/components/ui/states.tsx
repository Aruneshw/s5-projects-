// src/components/ui/states.tsx — consistent loading / error / empty states.
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { Button } from "./button";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 p-6 text-muted">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border-2 border-chilli-100 bg-chilli-100/40 p-4 text-chilli-700">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5" /> {msg}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-8 text-center text-muted">
      <Inbox className="size-8" />
      <div className="font-semibold text-ink">{title}</div>
      {hint ? <div className="text-sm">{hint}</div> : null}
      {action}
    </div>
  );
}
