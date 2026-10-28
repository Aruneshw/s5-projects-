// src/features/bills/components/picker.tsx — big-touch-target searchable picker (stores, items).
"use client";
import { forwardRef, useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  label: string;
  options: PickerOption[];
  value: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  id?: string;
}

export const Picker = forwardRef<HTMLInputElement, Props>(function Picker({ label, options, value, onChange, placeholder, autoFocus, id }, ref) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? null;
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? options.filter((o) => o.label.toLowerCase().includes(t) || o.hint?.toLowerCase().includes(t)) : options;
    return list.slice(0, 8);
  }, [q, options]);

  if (selected && !open) {
    return (
      <div>
        <span className="mb-1 block text-sm font-semibold text-muted">{label}</span>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setQ("");
          }}
          className="flex h-12 w-full items-center justify-between rounded-xl border-2 border-leaf-600 bg-leaf-50 px-3 text-left font-semibold"
          aria-label={`${label}: ${selected.label}. Tap to change`}
        >
          <span className="truncate">{selected.label}</span>
          <span className="text-xs text-leaf-700">change</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-muted">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
        <input
          id={id}
          ref={ref}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              onChange(matches[0].id);
              setOpen(false);
              setQ("");
            }
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder ?? "Type to search"}
          className="h-12 w-full rounded-xl border-2 border-line bg-card pl-10 pr-10 text-base focus:border-leaf-600 focus:outline-none"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          autoComplete="off"
        />
        {selected ? (
          <button type="button" aria-label="Keep current" onClick={() => setOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted">
            <X className="size-5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" className="mt-1 max-h-72 overflow-y-auto rounded-xl border-2 border-line bg-card shadow-lg">
          {matches.length === 0 ? <li className="p-3 text-sm text-muted">No match</li> : null}
          {matches.map((o) => (
            <li key={o.id} role="option" aria-selected={o.id === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQ("");
                }}
                className={cn("flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-leaf-50", o.id === value && "bg-leaf-50")}
              >
                <span>
                  <span className="block font-semibold">{o.label}</span>
                  {o.hint ? <span className="block text-xs text-muted">{o.hint}</span> : null}
                </span>
                {o.id === value ? <Check className="size-5 text-leaf-700" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
