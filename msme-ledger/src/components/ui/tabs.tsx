// src/components/ui/tabs.tsx — simple accessible segmented tabs.
"use client";
import { cn } from "@/lib/utils";

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex w-full gap-1 overflow-x-auto rounded-xl bg-paper p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold", value === o.value ? "bg-card text-leaf-800 shadow" : "text-muted")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
