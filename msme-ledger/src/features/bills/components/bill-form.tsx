// src/features/bills/components/bill-form.tsx — purchase / sales bill entry.
// Totals shown here are PREVIEWS; the server recalculates everything when the bill is posted.
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, Plus, Save, Send } from "lucide-react";
import { LineEditor } from "./line-editor";
import { Picker } from "./picker";
import { useMasters } from "./use-masters";
import { emptyLine, formToPayload, lineIsBlank, previewLine, previewSummary, validateForm, type BillFormState } from "../form";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Money } from "@/components/common/format";
import { api, ApiError, issuesOf, NetworkError } from "@/lib/api";
import { localDb } from "@/offline/db";
import { enqueue } from "@/offline/sync-engine";
import { useOnline } from "@/offline/use-sync";
import { useCan, useMe } from "@/components/auth/me";
import { cn } from "@/lib/utils";

function Row({ label, value, strong, sign, muted }: { label: React.ReactNode; value: string; strong?: boolean; sign?: "+" | "−"; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between py-1.5", strong && "border-t border-line pt-2 text-lg font-extrabold", muted && "text-muted")}>
      <span>{label}</span>
      <span className="num">
        {sign ? `${sign} ` : ""}
        <Money value={value} />
      </span>
    </div>
  );
}

export function BillForm({ initial }: { initial: BillFormState }) {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const online = useOnline();
  const { stores, items, modes, ready } = useMasters();
  const [form, setForm] = useState<BillFormState>(initial);
  const [focusKey, setFocusKey] = useState<string | null>(initial.lines[0]?.key ?? null);
  const [prevFetch, setPrevFetch] = useState<{ storeId: string; balance: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canCommission = useCan("settings:manage");
  const isSales = form.type === "SALES";
  const storeType = isSales ? "CUSTOMER" : "SUPPLIER";

  // Autosave every change to this phone, so nothing typed at the market is lost.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (form.serverVersion !== null) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const meaningful = form.storeId || form.lines.some((l) => !lineIsBlank(l));
      if (meaningful) void localDb().drafts.put({ id: form.id, type: form.type, form, updatedAt: Date.now() });
    }, 400);
  }, [form]);

  // Default payment mode for the at-bill settlement: cash (derived, not stored until changed).
  const settlementModeId = form.settlementModeId ?? modes.find((m) => !m.isDigital)?.id ?? modes[0]?.id ?? null;

  const previews = useMemo(() => form.lines.map((l) => previewLine(form.type, l, items.find((i) => i.id === l.itemId))), [form.lines, form.type, items]);

  // Previous balance comes from the server ledger when online (the server re-reads it at posting).
  useEffect(() => {
    if (!online || !form.storeId || form.serverVersion !== null) return;
    const storeId = form.storeId;
    let alive = true;
    api<{ balance: string }>(`/api/stores/${storeId}/balance`)
      .then((r) => alive && setPrevFetch({ storeId, balance: r.balance }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [online, form.storeId, form.serverVersion]);
  const serverPrev = online && prevFetch && prevFetch.storeId === form.storeId ? prevFetch.balance : null;

  const summary = previewSummary(form, previews, serverPrev ?? "0");

  const setLine = (key: string, next: BillFormState["lines"][number]) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? next : l)) }));
  const addLine = () => {
    const l = emptyLine();
    setForm((f) => ({ ...f, lines: [...f.lines, l] }));
    setFocusKey(l.key);
  };
  const completeLine = (key: string) => {
    const idx = form.lines.findIndex((l) => l.key === key);
    if (idx === form.lines.length - 1) addLine(); // auto-advance to a new row
  };

  async function submit(post: boolean) {
    const errs = validateForm(form, previews);
    setErrors(errs);
    setNotice(null);
    if (errs.length) return;
    const payload = formToPayload({ ...form, settlementModeId }, { post, clientPreviousBalance: serverPrev ?? undefined });
    setBusy(true);
    try {
      if (form.serverVersion !== null) {
        const { id: _id, type: _t, ...rest } = payload;
        const r = await api<{ bill: { id: string }; warnings: string[] }>(`/api/bills/${form.id}`, { method: "PUT", json: { ...rest, version: form.serverVersion } });
        afterSave(r.bill.id, r.warnings);
        return;
      }
      if (!post) {
        const r = await api<{ bill: { id: string } }>("/api/bills", { method: "POST", json: payload });
        await localDb().drafts.delete(form.id);
        afterSave(r.bill.id, []);
        return;
      }
      if (!online) throw new NetworkError();
      const r = await api<{ bill: { id: string }; warnings: string[] }>("/api/bills", { method: "POST", json: payload });
      await localDb().drafts.delete(form.id);
      afterSave(r.bill.id, r.warnings);
    } catch (e) {
      if (e instanceof NetworkError && post && form.serverVersion === null) {
        // Offline: queue it. The bill id is fixed, so a later retry can never create a duplicate.
        const store = stores.find((s) => s.id === form.storeId);
        await enqueue("BILL_CREATE", payload, `${isSales ? "Sales" : "Purchase"} bill · ${store?.label ?? ""} · ${form.billDate}`);
        setNotice("Saved on this phone. It will be posted automatically when the internet is back — the server will confirm the final totals.");
        setTimeout(() => router.push("/sync"), 1500);
      } else if (e instanceof ApiError) {
        setErrors([e.message, ...issuesOf(e)]);
      } else {
        setErrors([e instanceof Error ? e.message : "Could not save"]);
      }
    } finally {
      setBusy(false);
    }
  }

  function afterSave(id: string, warnings: string[]) {
    void qc.invalidateQueries();
    if (warnings.length) sessionStorage.setItem(`bill-warnings:${id}`, JSON.stringify(warnings));
    router.push(`/bills/${id}`);
  }

  if (!ready) return <p className="p-4 text-muted">Loading…</p>;
  const storeOptions = stores.filter((s) => s.type === storeType).map((s) => ({ id: s.id, label: s.label }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
      className="space-y-4"
      noValidate
    >
      {!online ? (
        <div role="status" className="flex items-center gap-2 rounded-xl bg-turmeric-100 p-3 text-sm font-semibold text-turmeric-700">
          <CloudOff className="size-5" /> Offline — this bill is saved on your phone as you type and will post when you are back online.
        </div>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-3">
          {storeOptions.length === 0 ? (
            <p className="text-sm text-chilli-700">No {storeType.toLowerCase()}s on this phone yet. {online ? "Add one under Stores." : "Connect once to download your stores."}</p>
          ) : (
            <Picker id="store" label={isSales ? "Customer (shop — city)" : "Supplier (shop — city)"} options={storeOptions} value={form.storeId} onChange={(id) => setForm((f) => ({ ...f, storeId: id }))} autoFocus={!form.storeId} />
          )}
        </div>
        <Field label="Bill date" htmlFor="billDate">
          <Input id="billDate" type="date" value={form.billDate} onChange={(e) => setForm((f) => ({ ...f, billDate: e.target.value }))} />
        </Field>
        {isSales ? (
          <Field label="Due date" hint="Blank = bill date + your default credit days" htmlFor="dueDate">
            <Input id="dueDate" type="date" value={form.dueDate} min={form.billDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </Field>
        ) : null}
      </Card>

      <div className="space-y-3">
        {form.lines.map((l, i) => (
          <LineEditor
            key={l.key}
            index={i}
            type={form.type}
            line={l}
            items={items}
            autoFocus={focusKey === l.key && !!form.storeId}
            onChange={(n) => setLine(l.key, n)}
            onRemove={() => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((x) => x.key !== l.key) : [emptyLine()] }))}
            onComplete={() => completeLine(l.key)}
          />
        ))}
        <Button type="button" variant="outline" className="w-full" onClick={addLine}>
          <Plus /> Add item
        </Button>
      </div>

      <Card className="space-y-3">
        <CardTitle>Bill summary</CardTitle>
        <div className="text-base">
          {isSales ? <Row label="Coolie" value={summary?.coolieTotal.toFixed(2) ?? "0"} /> : null}
          <Row label="Today's Bill" value={summary?.todayBill.toFixed(2) ?? "0"} />
          <Row label={<>Previous Bill Balance {serverPrev === null ? <span className="text-xs text-muted">(set by the server when posted)</span> : null}</>} value={serverPrev ?? "0"} muted={serverPrev === null} />
          <Row label="Total" value={summary?.total.toFixed(2) ?? "0"} strong />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Less (₹)" htmlFor="less">
            <Input id="less" inputMode="decimal" value={form.lessAmount} onChange={(e) => setForm((f) => ({ ...f, lessAmount: e.target.value.replace(/[^\d.]/g, "") }))} />
          </Field>
          <Field label="Reason for less" htmlFor="lessReason">
            <Input id="lessReason" value={form.lessReason} disabled={!Number(form.lessAmount)} onChange={(e) => setForm((f) => ({ ...f, lessReason: e.target.value }))} placeholder="Required if less > 0" />
          </Field>
          <Field label="Bonus (₹)" htmlFor="bonus">
            <Input id="bonus" inputMode="decimal" value={form.bonusAmount} onChange={(e) => setForm((f) => ({ ...f, bonusAmount: e.target.value.replace(/[^\d.]/g, "") }))} />
          </Field>
          <Field label="Reason for bonus" htmlFor="bonusReason">
            <Input id="bonusReason" value={form.bonusReason} disabled={!Number(form.bonusAmount)} onChange={(e) => setForm((f) => ({ ...f, bonusReason: e.target.value }))} placeholder="Required if bonus > 0" />
          </Field>
        </div>

        {canCommission || form.commissionOn ? (
          <label className="flex items-center gap-3 rounded-xl bg-paper p-3 text-sm">
            <input type="checkbox" className="size-5" checked={form.commissionOn} onChange={(e) => setForm((f) => ({ ...f, commissionOn: e.target.checked }))} />
            <span className="flex-1">
              Apply commission
              <span className="block text-xs text-muted">{isSales ? "Added to the customer's bill" : "Deducted from the supplier's payable"} — only when agreed</span>
            </span>
            <Input aria-label="Commission %" className="h-10 w-20" inputMode="decimal" value={form.commissionPercent} disabled={!form.commissionOn} onChange={(e) => setForm((f) => ({ ...f, commissionPercent: e.target.value.replace(/[^\d.]/g, "") }))} />
            %
          </label>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={isSales ? "Amount received now (₹)" : "Amount settled now (₹)"} htmlFor="settled">
            <Input id="settled" inputMode="decimal" value={form.amountSettled} onChange={(e) => setForm((f) => ({ ...f, amountSettled: e.target.value.replace(/[^\d.]/g, "") }))} />
          </Field>
          <Field label="Paid by" htmlFor="mode">
            <Select id="mode" value={settlementModeId ?? ""} onChange={(e) => setForm((f) => ({ ...f, settlementModeId: e.target.value }))}>
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="text-base">
          {Number(form.lessAmount) > 0 ? <Row label="Less" value={summary?.lessAmount.toFixed(2) ?? "0"} sign="−" /> : null}
          {Number(form.bonusAmount) > 0 ? <Row label="Bonus" value={summary?.bonusAmount.toFixed(2) ?? "0"} sign="+" /> : null}
          {form.commissionOn ? <Row label={`Commission ${form.commissionPercent}%`} value={summary?.commissionAmount.toFixed(2) ?? "0"} sign={isSales ? "+" : "−"} /> : null}
          <Row label={isSales ? "Amount Received" : "Amount Settled"} value={summary?.amountSettled.toFixed(2) ?? "0"} sign="−" />
          <Row label="Total Balance" value={summary?.totalBalance.toFixed(2) ?? "0"} strong />
        </div>
      </Card>

      {errors.length ? (
        <div role="alert" className="rounded-xl border-2 border-chilli-100 bg-chilli-100/50 p-3 text-sm text-chilli-700">
          <ul className="list-disc pl-5">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-xl bg-leaf-50 p-3 text-sm font-semibold text-leaf-800">
          {notice}
        </p>
      ) : null}

      <div className="safe-bottom sticky bottom-16 z-20 -mx-4 flex gap-2 border-t border-line bg-paper/95 px-4 pt-2 backdrop-blur md:bottom-0">
        {online ? (
          <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => submit(false)} className="flex-1">
            <Save /> Save draft
          </Button>
        ) : null}
        <Button type="submit" size="lg" disabled={busy} className="flex-[2]">
          <Send /> {busy ? "Saving…" : online ? "Post bill" : "Save on phone"}
        </Button>
      </div>
      <p className="text-center text-xs text-muted">Signed in as {me?.displayName}. Posted bills cannot be edited — use an adjustment or cancel.</p>
    </form>
  );
}
