// src/app/(app)/bills/[id]/page.tsx — bill detail: lines & bag weights, traceability, margins (hidden by
// default), summary, payments, adjustments, PDF, WhatsApp share, cancel, instant cash.
"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Eye, EyeOff, FileDown, MessageCircle, Pencil, Printer, Send, Trash2, XCircle } from "lucide-react";
import { api, issuesOf } from "@/lib/api";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { BillStatusBadge, DateText, Money, PaymentStatusBadge, today } from "@/components/common/format";
import { Can } from "@/components/auth/can";
import { useCan, useMe } from "@/components/auth/me";
import { InstantCashDialog } from "@/features/discounting/components/instant-cash-dialog";
import { formatINR, formatQty } from "@/lib/money";
import type { BillDto } from "@/server/services/bills";

function waLink(bill: BillDto, orgName: string): string {
  const lines = [
    `*${orgName}* — ${bill.type === "SALES" ? "Sales" : "Purchase"} bill #${bill.billNumber}`,
    `Date: ${bill.billDate}${bill.dueDate ? ` · Due: ${bill.dueDate}` : ""}`,
    `To: ${bill.store.label}`,
    "",
    ...bill.lines.map((l) => `${l.item.name}${l.lineMark ? ` (${l.lineMark})` : ""}: ${formatQty(l.quantity, l.item.unitType === "KG" ? "kg" : l.item.unitType.toLowerCase())} × ${l.rate} = ${formatINR(l.amount)}`),
    "",
    ...(bill.type === "SALES" ? [`Coolie: ${formatINR(bill.coolieTotal)}`] : []),
    `Today's bill: ${formatINR(bill.todayBill)}`,
    `Previous balance: ${formatINR(bill.previousBalance)}`,
    `Total: ${formatINR(bill.total)}`,
    ...(Number(bill.lessAmount) ? [`Less: ${formatINR(bill.lessAmount)}`] : []),
    ...(Number(bill.bonusAmount) ? [`Bonus: ${formatINR(bill.bonusAmount)}`] : []),
    `${bill.type === "SALES" ? "Received" : "Settled"}: ${formatINR(bill.amountSettled)}`,
    `*Balance: ${formatINR(bill.totalBalance)}*`,
  ];
  const phone = (bill.store.phone ?? "").replace(/\D/g, "");
  const intl = phone.length === 10 ? `91${phone}` : phone;
  return `https://wa.me/${intl}?text=${encodeURIComponent(lines.join("\n"))}`;
}

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const canMargin = useCan("bill:margin:view");
  const [showMargins, setShowMargins] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  // Warnings handed over from the bill form (read once from sessionStorage, then cleared).
  const [warnings, setWarnings] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    const w = sessionStorage.getItem(`bill-warnings:${id}`);
    return w ? (JSON.parse(w) as string[]) : [];
  });
  const q = useQuery({ queryKey: ["bill", id, showMargins], queryFn: () => api<BillDto>(`/api/bills/${id}${showMargins ? "?margins=1" : ""}`) });

  useEffect(() => {
    sessionStorage.removeItem(`bill-warnings:${id}`);
  }, [id]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const b = q.data!;
  const isSales = b.type === "SALES";
  const unitOf = (u: string) => (u === "KG" ? "kg" : u === "BOX" ? "boxes" : "bags");

  async function postDraft() {
    try {
      const r = await api<{ warnings: string[] }>(`/api/bills/${id}/post`, { method: "POST", json: { version: b.version } });
      setWarnings(r.warnings);
      void qc.invalidateQueries();
    } catch (e) {
      alert([e instanceof Error ? e.message : "Failed", ...issuesOf(e)].join("\n"));
    }
  }
  async function deleteDraft() {
    if (!confirm("Delete this draft? Posted bills are never deleted; drafts can be.")) return;
    await api(`/api/bills/${id}?version=${b.version}`, { method: "DELETE" });
    void qc.invalidateQueries();
    router.push(`/bills?type=${b.type}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${isSales ? "Sales" : "Purchase"} bill ${b.billNumber ? `#${b.billNumber}` : "(draft)"}`}
        subtitle={
          <>
            <Link href={`/stores/${b.store.id}`} className="font-semibold text-leaf-700">
              {b.store.label}
            </Link>{" "}
            · <DateText value={b.billDate} />
            {b.dueDate ? (
              <>
                {" "}
                · due <DateText value={b.dueDate} />
              </>
            ) : null}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BillStatusBadge status={b.status} />
            {b.settlement ? <PaymentStatusBadge status={b.settlement.status} /> : null}
            {b.discount ? <Badge tone="blue">financing: {b.discount.status.toLowerCase()}</Badge> : null}
          </div>
        }
      />

      {warnings.length ? (
        <div role="alert" className="rounded-xl bg-turmeric-100 p-3 text-sm text-turmeric-700">
          {warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </div>
      ) : null}
      {b.status === "CANCELLED" ? (
        <div className="rounded-xl bg-chilli-100 p-3 text-sm font-semibold text-chilli-700">
          Cancelled: {b.cancelReason}. Ledger and stock effects were reversed; the record is kept for history.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {b.status === "DRAFT" ? (
          <>
            <Button onClick={postDraft}>
              <Send /> Post bill
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/bills/new?edit=${b.id}`}>
                <Pencil /> Edit
              </Link>
            </Button>
            <Button variant="ghost" onClick={deleteDraft}>
              <Trash2 /> Delete draft
            </Button>
          </>
        ) : null}
        <Can perm="bill:print">
          <Button variant="outline" asChild>
            <a href={`/api/bills/${b.id}/pdf`} target="_blank" rel="noopener">
              <Printer /> Print
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/bills/${b.id}/pdf?download=1`}>
              <FileDown /> PDF
            </a>
          </Button>
        </Can>
        {b.status === "POSTED" ? (
          <Button variant="outline" asChild>
            <a href={waLink(b, me?.orgName ?? "")} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Button>
        ) : null}
        {canMargin && isSales ? (
          <Button variant="ghost" onClick={() => setShowMargins((s) => !s)} aria-pressed={showMargins}>
            {showMargins ? <EyeOff /> : <Eye />} {showMargins ? "Hide margin" : "Show margin"}
          </Button>
        ) : null}
      </div>
      {b.status === "POSTED" ? (
        <p className="text-xs text-muted">WhatsApp opens a pre-filled message on your phone. The app cannot confirm it was delivered or read.</p>
      ) : null}

      <Card className="space-y-3">
        <CardTitle>Items</CardTitle>
        <ul className="divide-y divide-line">
          {b.lines.map((l) => (
            <li key={l.id} className="py-3">
              <div className="flex justify-between gap-3">
                <div>
                  <div className="font-bold">
                    {l.item.name} {l.lineMark ? <Badge tone="neutral">{l.lineMark}</Badge> : null}
                  </div>
                  <div className="num text-sm text-muted">
                    {l.bagCount} bag(s) · {formatQty(l.quantity, unitOf(l.item.unitType))} × {formatINR(l.rate)}
                    {l.entryMode === "COMBINED_LOT" ? " · combined lot" : ""}
                  </div>
                  {l.weights.length ? <div className="num text-xs text-muted">Weights: {l.weights.map((w) => Number(w)).join(" + ")} kg</div> : null}
                </div>
                <div className="text-right">
                  <Money value={l.amount} strong />
                  {isSales && Number(l.coolieAmount) ? (
                    <div className="text-xs text-muted">
                      coolie <Money value={l.coolieAmount} />
                    </div>
                  ) : null}
                </div>
              </div>
              {l.source ? (
                <div className="mt-2 rounded-lg bg-paper p-2 text-xs">
                  From purchase{" "}
                  <Link className="font-semibold text-leaf-700" href={`/bills/${l.source.purchaseBillId}`}>
                    #{l.source.purchaseBillNumber}
                  </Link>{" "}
                  · {l.source.supplier} · <DateText value={l.source.purchaseDate} /> · batch {formatQty(l.source.purchaseQuantity, unitOf(l.item.unitType))}
                  {"purchaseRate" in l.source && l.source.purchaseRate ? <> · bought at {formatINR(l.source.purchaseRate)}</> : null}
                  {l.source.oversold ? <Badge tone="red" className="ml-1">oversold</Badge> : null}
                </div>
              ) : null}
              {l.margin ? (
                <div className="mt-1 text-sm font-semibold">
                  Margin: <Money value={l.margin.unitMargin} /> per unit · <Money value={l.margin.grossMargin} strong />
                </div>
              ) : null}
              {l.soldLinks.length ? (
                <div className="mt-2 rounded-lg bg-paper p-2 text-xs">
                  <div className="font-semibold">Sold from this batch:</div>
                  {l.soldLinks.map((s) => (
                    <div key={s.salesLineId}>
                      <Link className="text-leaf-700" href={`/bills/${s.salesBillId}`}>
                        Sale #{s.salesBillNumber ?? "draft"}
                      </Link>{" "}
                      · {s.customer} · <DateText value={s.saleDate} /> · {formatQty(s.quantity, unitOf(l.item.unitType))}
                      {s.salesBillStatus === "CANCELLED" ? " (cancelled)" : ""}
                      {s.oversold ? " · oversold" : ""}
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle className="mb-2">Summary</CardTitle>
        <dl className="num text-base">
          {(
            [
              ...(isSales ? [["Coolie", b.coolieTotal]] : []),
              ["Today's Bill", b.todayBill],
              ["Previous Bill Balance", b.previousBalance],
              ["Total", b.total, true],
              ...(Number(b.lessAmount) ? [[`Less (${b.lessReason})`, `-${b.lessAmount}`]] : []),
              ...(Number(b.bonusAmount) ? [[`Bonus (${b.bonusReason})`, b.bonusAmount]] : []),
              ...(Number(b.commissionAmount) ? [[`Commission ${b.commissionPercent}%`, isSales ? b.commissionAmount : `-${b.commissionAmount}`]] : []),
              [isSales ? "Amount Received" : "Amount Settled", `-${b.amountSettled}`],
              ["Total Balance", b.totalBalance, true],
            ] as Array<[string, string, boolean?]>
          ).map(([k, v, strong]) => (
            <div key={k} className={`flex justify-between py-1.5 ${strong ? "border-t border-line font-extrabold" : ""}`}>
              <dt>{k}</dt>
              <dd>
                <Money value={v} />
              </dd>
            </div>
          ))}
        </dl>
        {b.settlement ? (
          <p className="mt-2 text-sm text-muted">
            This invoice (₹ by FIFO across the account): outstanding <Money value={b.settlement.outstanding} />
            {b.settlement.settledDate ? (
              <>
                {" "}
                · settled on <DateText value={b.settlement.settledDate} />
              </>
            ) : null}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Created by {b.createdBy.name}
          {b.lastEditedBy.id !== b.createdBy.id ? ` · last change by ${b.lastEditedBy.name}` : ""}
        </p>
      </Card>

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <CardTitle>Payments</CardTitle>
          {b.status === "POSTED" ? (
            <Button size="sm" asChild>
              <Link href={`/payments?storeId=${b.store.id}&billId=${b.id}`}>Record payment</Link>
            </Button>
          ) : null}
        </div>
        {b.payments.length === 0 ? <p className="text-sm text-muted">No payments linked to this bill.</p> : null}
        <ul className="divide-y divide-line text-sm">
          {b.payments.map((p) => (
            <li key={p.id} className="flex justify-between py-2">
              <span>
                <DateText value={p.paymentDate} /> · {p.mode} {p.status === "CANCELLED" ? <Badge tone="red">cancelled</Badge> : null}
              </span>
              <Money value={p.amount} />
            </li>
          ))}
        </ul>
      </Card>

      {b.adjustments.length ? (
        <Card>
          <CardTitle className="mb-2">Adjustments after billing</CardTitle>
          <ul className="divide-y divide-line text-sm">
            {b.adjustments.map((a) => (
              <li key={a.id} className="flex justify-between gap-2 py-2">
                <span>
                  {a.type.replace(/_/g, " ").toLowerCase()} — {a.reason}
                </span>
                <Money value={a.amount} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {b.status === "POSTED" ? (
        <div className="flex flex-wrap gap-2">
          {isSales && !b.discount ? (
            <Can perm="discount:request">
              <Button variant="outline" onClick={() => setCashOpen(true)}>
                <Banknote /> Get Instant Cash
              </Button>
            </Can>
          ) : null}
          <Can perm="bill:adjust">
            <Button variant="outline" onClick={() => setAdjOpen(true)}>
              <Pencil /> Adjustment
            </Button>
          </Can>
          <Can perm="bill:cancel">
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              <XCircle /> Cancel bill
            </Button>
          </Can>
        </div>
      ) : null}

      <CancelDialog bill={b} open={cancelOpen} onOpenChange={setCancelOpen} onDone={() => void qc.invalidateQueries()} />
      <AdjustDialog bill={b} open={adjOpen} onOpenChange={setAdjOpen} onDone={() => void qc.invalidateQueries()} />
      {cashOpen ? <InstantCashDialog billId={b.id} open onOpenChange={setCashOpen} /> : null}
    </div>
  );
}

function CancelDialog({ bill, open, onOpenChange, onDone }: { bill: BillDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    try {
      await api(`/api/bills/${bill.id}/cancel`, { method: "POST", json: { reason, version: bill.version } });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Cancel this bill?" description="Stock and money effects are reversed with new entries. The bill stays in history. Payments already received stay as a credit on the account.">
      <Field label="Reason (required)" htmlFor="cr">
        <Textarea id="cr" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err ? <p className="mt-2 text-sm text-chilli-700">{err}</p> : null}
      <Button variant="danger" className="mt-3 w-full" disabled={reason.trim().length < 5} onClick={go}>
        Cancel bill
      </Button>
    </Dialog>
  );
}

function AdjustDialog({ bill, open, onOpenChange, onDone }: { bill: BillDto; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [type, setType] = useState<"COOLIE_CORRECTION" | "LESS" | "BONUS">(bill.type === "SALES" ? "COOLIE_CORRECTION" : "LESS");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setErr(null);
    try {
      await api(`/api/bills/${bill.id}/adjustments`, { method: "POST", json: { type, amount, reason, entryDate: today() } });
      onOpenChange(false);
      onDone();
    } catch (e) {
      setErr([e instanceof Error ? e.message : "Failed", ...issuesOf(e)].join(" · "));
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Audited adjustment" description="Posted bills are never edited. An adjustment is added to the ledger with your name and reason.">
      <div className="space-y-3">
        <Field label="Type" htmlFor="at">
          <Select id="at" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            {bill.type === "SALES" ? <option value="COOLIE_CORRECTION">Coolie correction (+ or −)</option> : null}
            <option value="LESS">Extra less (reduces balance)</option>
            <option value="BONUS">Extra bonus (increases balance)</option>
          </Select>
        </Field>
        <Field label="Amount (₹)" hint={type === "COOLIE_CORRECTION" ? "Use a minus sign to reduce coolie, e.g. -24" : undefined} htmlFor="aa">
          <Input id="aa" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.-]/g, ""))} />
        </Field>
        <Field label="Reason (required)" htmlFor="ar">
          <Input id="ar" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {err ? <p className="text-sm text-chilli-700">{err}</p> : null}
        <Button className="w-full" disabled={!amount || reason.trim().length < 5} onClick={go}>
          Save adjustment
        </Button>
      </div>
    </Dialog>
  );
}
