// src/features/bills/components/line-editor.tsx — one item row with the bag-by-bag weight prompt.
"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Scale, Trash2, X } from "lucide-react";
import { Picker } from "./picker";
import { Input, Label, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/common/format";
import { allowedModes, type BillTypeT } from "../calc";
import { previewLine, submitWeight, type LineState } from "../form";
import { api } from "@/lib/api";
import { useCan } from "@/components/auth/me";
import type { CachedItem } from "@/offline/db";
import { cn } from "@/lib/utils";
import { useOnline } from "@/offline/use-sync";

interface Props {
  index: number;
  type: BillTypeT;
  line: LineState;
  items: CachedItem[];
  onChange: (l: LineState) => void;
  onRemove: () => void;
  onComplete: () => void; // rate confirmed → auto-advance
  autoFocus?: boolean;
}

interface Linkable {
  purchaseLineId: string;
  purchaseBillNumber: number;
  purchaseDate: string;
  supplier: string;
  lineMark: string | null;
  quantity: string;
  remaining: string;
  rate?: string;
}

export function LineEditor({ index, type, line, items, onChange, onRemove, onComplete, autoFocus }: Props) {
  const item = items.find((i) => i.id === line.itemId);
  const preview = previewLine(type, line, item);
  const weightRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const [weightError, setWeightError] = useState<string | null>(null);
  const canApproveOversell = useCan("bill:oversell:approve");
  const online = useOnline();
  const unit = item?.unitType === "KG" ? "kg" : item?.unitType === "BOX" ? "boxes" : "bags";

  const linkable = useQuery({
    queryKey: ["linkable", line.itemId],
    queryFn: () => api<Linkable[]>(`/api/bills/linkable?itemId=${line.itemId}`),
    enabled: type === "SALES" && !!line.itemId && online,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!item) return;
    const modes = allowedModes(item.unitType);
    if (!modes.includes(line.entryMode)) onChange({ ...line, entryMode: modes[0]! });
  }, [item?.unitType]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusFirstInput = (mode = line.entryMode) =>
    setTimeout(() => (mode === "WEIGHED" ? weightRef : qtyRef).current?.focus(), 30);

  function onWeightKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addWeight();
  }

  function addWeight() {
    const r = submitWeight(line);
    setWeightError(r.error);
    if (r.finished) {
      rateRef.current?.focus();
      return;
    }
    if (!r.error) onChange(r.line);
    weightRef.current?.focus();
  }

  return (
    <div className="rounded-2xl border-2 border-line bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-bold text-muted">Item {index + 1}</span>
        <button type="button" onClick={onRemove} className="rounded-lg p-2 text-muted hover:bg-chilli-100 hover:text-chilli-700" aria-label={`Remove item ${index + 1}`}>
          <Trash2 className="size-5" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Picker
          id={`item-${line.key}`}
          label="Item"
          autoFocus={autoFocus}
          options={items.map((i) => ({ id: i.id, label: i.name, hint: i.unitType === "KG" ? "weighed in kg" : i.unitType === "BOX" ? "counted in boxes" : "counted in bags" }))}
          value={line.itemId}
          onChange={(id) => {
            const it = items.find((x) => x.id === id);
            const mode = it ? allowedModes(it.unitType)[0]! : "WEIGHED";
            onChange({ ...line, itemId: id, entryMode: mode, sourcePurchaseLineId: null });
            focusFirstInput(mode);
          }}
        />
        <div>
          <Label htmlFor={`mark-${line.key}`}>Line mark / grade</Label>
          <Input id={`mark-${line.key}`} value={line.lineMark} maxLength={30} onChange={(e) => onChange({ ...line, lineMark: e.target.value })} placeholder="e.g. A, Big, Ooty" />
        </div>
      </div>

      {item?.unitType === "KG" ? (
        <div className="mt-3 flex gap-2" role="radiogroup" aria-label="How is this weighed?">
          {(["WEIGHED", "COMBINED_LOT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={line.entryMode === m}
              onClick={() => {
                onChange({ ...line, entryMode: m });
                focusFirstInput(m);
              }}
              className={cn("h-10 flex-1 rounded-xl border-2 text-sm font-semibold", line.entryMode === m ? "border-leaf-600 bg-leaf-50 text-leaf-800" : "border-line text-muted")}
            >
              {m === "WEIGHED" ? "Weigh each bag" : "One combined lot"}
            </button>
          ))}
        </div>
      ) : null}

      {item && line.entryMode === "WEIGHED" ? (
        <div className="mt-3">
          <Label htmlFor={`w-${line.key}`}>{line.weights.length === 0 ? "First bag weight (kg)" : `Bag ${line.weights.length + 1} weight — leave blank and press Enter when done`}</Label>
          <div className="flex gap-2">
            <Input
              id={`w-${line.key}`}
              ref={weightRef}
              inputMode="decimal"
              enterKeyHint={line.weightInput.trim() ? "next" : "done"}
              value={line.weightInput}
              onChange={(e) => {
                setWeightError(null);
                onChange({ ...line, weightInput: e.target.value.replace(/[^\d.]/g, "") });
              }}
              onKeyDown={onWeightKey}
              placeholder="kg"
              aria-invalid={!!weightError}
              aria-describedby={`wh-${line.key}`}
              className="text-xl font-bold"
            />
            <Button type="button" variant="outline" onClick={addWeight} aria-label={line.weightInput.trim() ? "Add this bag" : "Finish weighing"} className="shrink-0">
              <Scale /> {line.weightInput.trim() ? "Add" : "Done"}
            </Button>
          </div>
          {weightError ? (
            <p id={`wh-${line.key}`} role="alert" className="mt-1 text-sm text-chilli-700">
              {weightError}
            </p>
          ) : null}
          {line.weights.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Entered bag weights">
              {line.weights.map((w, i) => (
                <span key={`${w}-${i}`} className="num inline-flex items-center gap-1 rounded-full bg-paper px-3 py-1 text-sm font-semibold">
                  {w}
                  <button
                    type="button"
                    aria-label={`Remove bag ${i + 1} (${w} kg)`}
                    onClick={() => onChange({ ...line, weights: line.weights.filter((_, j) => j !== i) })}
                    className="text-muted hover:text-chilli-700"
                  >
                    <X className="size-4" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <p className="num mt-1 text-sm font-semibold text-leaf-800">
            {preview.bagCount} bag{preview.bagCount === 1 ? "" : "s"} · {Number(preview.quantity).toLocaleString("en-IN")} kg
          </p>
        </div>
      ) : null}

      {item && line.entryMode !== "WEIGHED" ? (
        <div className={cn("mt-3 grid gap-3", line.entryMode === "COMBINED_LOT" && "grid-cols-2")}>
          <div>
            <Label htmlFor={`q-${line.key}`}>{line.entryMode === "COMBINED_LOT" ? "Total weight (kg)" : `Quantity (${unit})`}</Label>
            <Input
              id={`q-${line.key}`}
              ref={qtyRef}
              inputMode={line.entryMode === "COUNT" ? "numeric" : "decimal"}
              value={line.quantity}
              onChange={(e) => onChange({ ...line, quantity: e.target.value.replace(/[^\d.]/g, "") })}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), rateRef.current?.focus())}
              className="text-xl font-bold"
            />
          </div>
          {line.entryMode === "COMBINED_LOT" ? (
            <div>
              <Label htmlFor={`b-${line.key}`}>Number of bags</Label>
              <Input
                id={`b-${line.key}`}
                inputMode="numeric"
                value={line.bagCount}
                onChange={(e) => onChange({ ...line, bagCount: e.target.value.replace(/\D/g, "") })}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), rateRef.current?.focus())}
                className="text-xl font-bold"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {item ? (
        <div className="mt-3 grid grid-cols-2 items-end gap-3">
          <div>
            <Label htmlFor={`r-${line.key}`}>Rate (₹ per {item.unitType === "KG" ? "kg" : unit.replace(/s$/, "").replace(/e$/, "")})</Label>
            <Input
              id={`r-${line.key}`}
              ref={rateRef}
              inputMode="decimal"
              enterKeyHint="next"
              value={line.rate}
              onChange={(e) => onChange({ ...line, rate: e.target.value.replace(/[^\d.]/g, "") })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (preview.ok) onComplete();
                }
              }}
              className="text-xl font-bold"
            />
          </div>
          <div className="text-right">
            <div className="text-xs text-muted">Amount</div>
            <div className="text-xl font-extrabold">
              <Money value={preview.amount} />
            </div>
            {type === "SALES" && Number(preview.coolieAmount) > 0 ? (
              <div className="text-xs text-muted">
                + coolie <Money value={preview.coolieAmount} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview.error && item && (line.weights.length || line.quantity || line.rate) ? <p className="mt-2 text-sm text-turmeric-700">{preview.error}</p> : null}

      {type === "SALES" && item ? (
        <details className="mt-3 rounded-xl bg-paper p-2" open={!!line.sourcePurchaseLineId}>
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-leaf-700">
            <Link2 className="size-4" /> Link to purchase batch (for real margin)
          </summary>
          <div className="mt-2 space-y-2">
            {linkable.isLoading ? <p className="text-sm text-muted">Loading batches…</p> : null}
            {!online ? <p className="text-sm text-muted">Batch linking needs internet. You can still save the bill.</p> : null}
            <Select
              aria-label="Purchase batch"
              value={line.sourcePurchaseLineId ?? ""}
              onChange={(e) => onChange({ ...line, sourcePurchaseLineId: e.target.value || null })}
            >
              <option value="">No link</option>
              {line.sourcePurchaseLineId && !linkable.data?.some((x) => x.purchaseLineId === line.sourcePurchaseLineId) ? (
                <option value={line.sourcePurchaseLineId}>Previously linked batch</option>
              ) : null}
              {linkable.data?.map((b) => (
                <option key={b.purchaseLineId} value={b.purchaseLineId}>
                  #{b.purchaseBillNumber} {b.supplier} · {b.purchaseDate} · {b.lineMark ? `${b.lineMark} · ` : ""}left {b.remaining}
                  {b.rate ? ` · ₹${b.rate}` : ""}
                </option>
              ))}
            </Select>
            {line.sourcePurchaseLineId && canApproveOversell ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-5" checked={line.allowOversell} onChange={(e) => onChange({ ...line, allowOversell: e.target.checked })} />
                Allow selling more than the batch has left (flagged for reconciliation)
              </label>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
