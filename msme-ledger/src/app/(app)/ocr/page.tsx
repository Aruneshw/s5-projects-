// src/app/(app)/ocr/page.tsx — scan a supplier bill; the result is only a suggestion to review.
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import { RequirePerm } from "@/components/auth/can";
import { localDb } from "@/offline/db";
import { emptyForm, emptyLine, newKey } from "@/features/bills/form";
import { today } from "@/components/common/format";
import type { OcrCandidates } from "@/features/ocr/parse";

interface Upload { id: string; status: string; error: string | null; candidates: OcrCandidates | null; rawText?: string | null }

export default function OcrPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<Upload | null>(null);
  const list = useApi<Array<{ id: string; fileName: string; status: string; createdAt: string; billId: string | null }>>(["ocr"], "/api/ocr");

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/ocr", { method: "POST", body: fd });
      const body = (await res.json()) as Upload & { error?: { message: string } };
      if (!res.ok) throw new Error((body.error as unknown as { message: string })?.message ?? "Upload failed");
      setResult(body);
      void list.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }

  /** Open the normal purchase form pre-filled with the candidates. The user reviews and posts it. */
  async function review(c: OcrCandidates) {
    const f = emptyForm("PURCHASE", c.date ?? today());
    f.storeId = c.storeId;
    f.notes = `From scanned bill ${result?.id ?? ""}`;
    f.lines = c.lines.length
      ? c.lines.map((l) => ({ ...emptyLine(), key: newKey(), itemId: l.itemId, entryMode: "COMBINED_LOT" as const, quantity: l.quantity ?? "", bagCount: "1", rate: l.rate ?? "" }))
      : [emptyLine()];
    await localDb().drafts.put({ id: f.id, type: "PURCHASE", form: f, updatedAt: Date.now() });
    router.push(`/bills/new?type=PURCHASE&draft=${f.id}`);
  }

  return (
    <RequirePerm perm="ocr:use">
      <PageHeader title="Scan purchase bill" subtitle="Reading a photo is never 100% accurate — everything is checked by you before saving." />
      <Card className="space-y-3">
        <label className="flex h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-leaf-600 bg-leaf-50 font-semibold text-leaf-800">
          <Camera className="size-8" /> {busy ? "Reading the bill…" : "Take photo or choose image / PDF (max 5 MB)"}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        {err ? <ErrorState error={err} /> : null}
      </Card>
      {result ? (
        <Card className="mt-3 space-y-2">
          <CardTitle>Suggested fields <Badge tone="amber">unverified</Badge></CardTitle>
          {result.status === "FAILED" ? <p className="text-chilli-700">{result.error}</p> : null}
          {result.candidates ? (
            <>
              <p className="text-sm">Supplier text: {result.candidates.supplierText ?? "—"} · Date: {result.candidates.date ?? "—"} · Total read: {result.candidates.total ?? "—"} · Lines add up to: {result.candidates.linesSum}</p>
              <ul className="list-disc pl-5 text-sm">{result.candidates.lines.map((l, i) => <li key={i}>{l.itemText} · qty {l.quantity} · rate {l.rate} · amount {l.amount} {l.issues.length ? <span className="text-chilli-700">({l.issues.join("; ")})</span> : null}</li>)}</ul>
              {result.candidates.issues.length ? <ul className="list-disc pl-5 text-sm text-turmeric-700">{result.candidates.issues.map((x) => <li key={x}>{x}</li>)}</ul> : null}
              <Button className="w-full" onClick={() => review(result.candidates!)}>Review in purchase bill form</Button>
            </>
          ) : null}
        </Card>
      ) : null}
      <Card className="mt-3">
        <CardTitle className="mb-2">Recent scans</CardTitle>
        <ul className="divide-y divide-line text-sm">{list.data?.map((u) => <li key={u.id} className="flex justify-between py-2"><span>{u.fileName}</span><Badge>{u.status.toLowerCase()}</Badge></li>)}</ul>
        <p className="mt-2 text-xs text-muted">Original files are kept for 90 days, then deleted automatically. The link to the confirmed bill is kept.</p>
      </Card>
    </RequirePerm>
  );
}
