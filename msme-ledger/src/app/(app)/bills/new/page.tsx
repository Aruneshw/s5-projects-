// src/app/(app)/bills/new/page.tsx — new bill, resume a phone draft (?draft=) or edit a server draft (?edit=).
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillForm } from "@/features/bills/components/bill-form";
import { emptyForm, emptyLine, newKey, type BillFormState } from "@/features/bills/form";
import { PageHeader } from "@/components/ui/card";
import { Loading, ErrorState } from "@/components/ui/states";
import { RequirePerm } from "@/components/auth/can";
import { localDb } from "@/offline/db";
import { api } from "@/lib/api";
import { today } from "@/components/common/format";
import type { BillDto } from "@/server/services/bills";

function fromServerDraft(b: BillDto): BillFormState {
  return {
    ...emptyForm(b.type as "SALES" | "PURCHASE", b.billDate, b.id),
    serverVersion: b.version,
    storeId: b.store.id,
    dueDate: b.dueDate ?? "",
    lessAmount: Number(b.lessAmount) ? b.lessAmount : "",
    lessReason: b.lessReason ?? "",
    bonusAmount: Number(b.bonusAmount) ? b.bonusAmount : "",
    bonusReason: b.bonusReason ?? "",
    commissionOn: Number(b.commissionPercent) > 0,
    commissionPercent: Number(b.commissionPercent) > 0 ? b.commissionPercent : "1",
    amountSettled: Number(b.amountSettled) ? b.amountSettled : "",
    notes: b.notes ?? "",
    lines: b.lines.map((l) => ({
      ...emptyLine(),
      key: newKey(),
      itemId: l.item.id,
      entryMode: l.entryMode,
      lineMark: l.lineMark ?? "",
      weights: l.entryMode === "WEIGHED" ? l.weights : [],
      quantity: l.entryMode === "WEIGHED" ? "" : l.entryMode === "COUNT" ? String(Number(l.quantity)) : l.quantity,
      bagCount: l.entryMode === "COMBINED_LOT" ? String(l.bagCount) : "",
      rate: l.rate,
      sourcePurchaseLineId: l.source?.purchaseLineId ?? null,
    })),
  };
}

function NewBill() {
  const params = useSearchParams();
  const type = params.get("type") === "PURCHASE" ? "PURCHASE" : "SALES";
  const draftId = params.get("draft");
  const editId = params.get("edit");
  const [initial, setInitial] = useState<BillFormState | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (editId) {
        const b = await api<BillDto>(`/api/bills/${editId}`);
        if (b.status !== "DRAFT") throw new Error("Only draft bills can be edited");
        return fromServerDraft(b);
      }
      if (draftId) {
        const d = await localDb().drafts.get(draftId);
        if (d) return d.form as BillFormState;
      }
      return emptyForm(type, today());
    })()
      .then((f) => alive && setInitial(f))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [type, draftId, editId]);

  const perm = (initial?.type ?? type) === "SALES" ? "bill:create:sales" : "bill:create:purchase";
  return (
    <RequirePerm perm={perm}>
      <PageHeader title={(initial?.type ?? type) === "SALES" ? "New sales bill" : "New purchase bill"} subtitle={editId ? "Editing a draft" : draftId ? "Resumed from this phone" : "Bag weights: type each weight and press Enter; blank Enter finishes"} />
      {error ? <ErrorState error={error} /> : initial ? <BillForm key={initial.id} initial={initial} /> : <Loading />}
    </RequirePerm>
  );
}

export default function NewBillPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewBill />
    </Suspense>
  );
}
