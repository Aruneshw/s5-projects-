// src/components/common/format.tsx — display helpers (Indian formatting, statuses).
import { formatINR } from "@/lib/money";
import { formatDisplayDate } from "@/lib/dates";
import { Badge } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { trustBadgeColor } from "@/features/credit/trust-score";

export function Money({ value, className, strong }: { value: string | null | undefined; className?: string; strong?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const neg = value.trim().startsWith("-");
  return <span className={cn("num whitespace-nowrap", strong && "font-bold", neg && "text-chilli-700", className)}>{formatINR(value)}</span>;
}

export function DateText({ value }: { value: string | null | undefined }) {
  return <span className="num">{value ? formatDisplayDate(value) : "—"}</span>;
}

export function PaymentStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = status === "PAID" ? "green" : status === "OVERDUE" ? "red" : status === "PARTIAL" ? "amber" : "neutral";
  return <Badge tone={tone}>{status.toLowerCase()}</Badge>;
}

export function BillStatusBadge({ status }: { status: string }) {
  const tone = status === "POSTED" ? "green" : status === "CANCELLED" ? "red" : "amber";
  return <Badge tone={tone}>{status.toLowerCase()}</Badge>;
}

export function TrustBadge({ score }: { score: number }) {
  const c = trustBadgeColor(score);
  const tone = c === "green" ? "green" : c === "yellow" ? "amber" : "red";
  return (
    <Badge tone={tone} className="text-sm">
      Trust {score}
    </Badge>
  );
}

export function today(): string {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  return d.toISOString().slice(0, 10);
}
