// src/components/ui/card.tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] border border-line bg-card p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-bold text-ink", className)} {...p} />;
}
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "green" | "amber" | "red" | "blue" }) {
  const tones = {
    neutral: "bg-paper text-muted border-line",
    green: "bg-leaf-100 text-leaf-800 border-leaf-100",
    amber: "bg-turmeric-100 text-turmeric-700 border-turmeric-100",
    red: "bg-chilli-100 text-chilli-700 border-chilli-100",
    blue: "bg-sky-600/10 text-sky-600 border-sky-600/10",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide", tones[tone], className)} {...p} />;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "green" | "amber" | "red" }) {
  const color = tone === "red" ? "text-chilli-700" : tone === "amber" ? "text-turmeric-700" : tone === "green" ? "text-leaf-700" : "text-ink";
  return (
    <Card className="p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("num mt-1 text-xl font-extrabold", color)}>{value}</div>
    </Card>
  );
}
