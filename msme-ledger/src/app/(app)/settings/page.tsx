// src/app/(app)/settings/page.tsx — business settings, payment modes, tax assumptions, year-end, backup, security.
"use client";
import { useState } from "react";
import { useApi, useAction } from "@/lib/hooks";
import { Card, CardTitle, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorState, Loading } from "@/components/ui/states";
import { Can, RequirePerm } from "@/components/auth/can";
import { useMe } from "@/components/auth/me";
import { logout } from "@/components/layout/app-shell";
import type { OrgSettings } from "@/lib/validation/settings";

interface S { orgName: string; shareCreditProfile: boolean; riskFlag: string; settings: OrgSettings }

export default function SettingsPage() {
  const q = useApi<S>(["settings"], "/api/settings");
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  return <SettingsForm data={q.data} />;
}

function SettingsForm({ data }: { data: S }) {
  const me = useMe();
  const team = useApi<Array<{ userId: string; displayName: string; role: string }>>(["team"], "/api/team");
  const years = useApi<Array<{ label: string; startDate: string; endDate: string; isClosed: boolean }>>(["fy"], "/api/financial-years");
  const modes = useApi<Array<{ id: string; name: string; isDigital: boolean }>>(["modes"], "/api/payment-modes");
  const save = useAction<Record<string, unknown>>("PATCH", "/api/settings");
  const addMode = useAction<{ name: string; isDigital: boolean }>("POST", "/api/payment-modes");
  const closeYear = useAction<{ label: string }>("POST", (b) => `/api/financial-years/${b.label}/close`);
  const changePw = useAction<{ currentPassword: string; newPassword: string }>("POST", "/api/auth/change-password");
  const everywhere = useAction<Record<string, never>>("POST", "/api/auth/logout-everywhere");
  const [f, setF] = useState<S["settings"]>(data.settings);
  const [orgName, setOrgName] = useState(data.orgName);
  const [mode, setMode] = useState({ name: "", isDigital: true });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const num = (k: keyof OrgSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: Number(e.target.value) }));
  const tax = (k: keyof OrgSettings["taxAssumptions"]) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, taxAssumptions: { ...x.taxAssumptions, [k]: k === "gstNote" ? e.target.value : Number(e.target.value) } }));
  return (
    <RequirePerm perm="settings:manage">
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <Card className="space-y-3">
          <CardTitle>Business</CardTitle>
          <Field label="Business name" htmlFor="on"><Input id="on" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Default credit days (sales)" htmlFor="cd"><Input id="cd" type="number" value={f.defaultCreditDays} onChange={num("defaultCreditDays")} /></Field>
            <Field label="Overdue alert after (days)" htmlFor="oa"><Input id="oa" type="number" value={f.overdueAlertDays} onChange={num("overdueAlertDays")} /></Field>
            <Field label="Old-stock alert after (days)" htmlFor="ss"><Input id="ss" type="number" value={f.staleStockDays} onChange={num("staleStockDays")} /></Field>
            <Field label="Default commission %" htmlFor="dc"><Input id="dc" type="number" step="0.01" value={f.defaultCommissionPercent} onChange={num("defaultCommissionPercent")} /></Field>
            <Field label="Auto sign-out after idle (min)" htmlFor="it"><Input id="it" type="number" value={f.inactivityTimeoutMinutes} onChange={num("inactivityTimeoutMinutes")} /></Field>
            <Field label="Min invoice for advance (₹)" htmlFor="md"><Input id="md" type="number" value={f.minDiscountInvoiceAmount} onChange={num("minDiscountInvoiceAmount")} /></Field>
          </div>
          <div>
            <div className="mb-1 text-sm font-semibold text-muted">Profit sharing between owners (for the tax view; must add up to 100)</div>
            <div className="grid grid-cols-2 gap-3">
              {team.data?.filter((t) => t.role === "MSME_OWNER").map((t) => (
                <Field key={t.userId} label={`${t.displayName} %`} htmlFor={`pa-${t.userId}`}><Input id={`pa-${t.userId}`} type="number" value={f.profitAllocation[t.userId] ?? ""} onChange={(e) => setF((x) => ({ ...x, profitAllocation: { ...x.profitAllocation, [t.userId]: Number(e.target.value) } }))} /></Field>
              ))}
            </div>
          </div>
        </Card>
        <Card className="space-y-3">
          <CardTitle>Tax assumptions (confirm with your CA)</CardTitle>
          <p className="text-xs text-muted">Defaults reflect the presumptive scheme in section 58 of the Income-tax Act, 2025 (formerly 44AD): 6% of digital receipts, 8% of other receipts, ₹2 crore limit (₹3 crore when cash receipts ≤ 5%). Persons earning commission/agency income may be excluded. These are indicators only.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Digital receipts %" htmlFor="t1"><Input id="t1" type="number" value={f.taxAssumptions.presumptiveDigitalPercent} onChange={tax("presumptiveDigitalPercent")} /></Field>
            <Field label="Other receipts %" htmlFor="t2"><Input id="t2" type="number" value={f.taxAssumptions.presumptiveCashPercent} onChange={tax("presumptiveCashPercent")} /></Field>
            <Field label="Turnover limit (₹)" htmlFor="t3"><Input id="t3" type="number" value={f.taxAssumptions.presumptiveTurnoverLimit} onChange={tax("presumptiveTurnoverLimit")} /></Field>
            <Field label="Enhanced limit (₹)" htmlFor="t4"><Input id="t4" type="number" value={f.taxAssumptions.presumptiveEnhancedLimit} onChange={tax("presumptiveEnhancedLimit")} /></Field>
            <Field label="Cash share for enhanced limit %" htmlFor="t5"><Input id="t5" type="number" value={f.taxAssumptions.enhancedLimitCashSharePercent} onChange={tax("enhancedLimitCashSharePercent")} /></Field>
          </div>
          <Field label="GST note" htmlFor="t6"><Input id="t6" value={f.taxAssumptions.gstNote} onChange={tax("gstNote")} /></Field>
        </Card>
        {save.errorText ? <p className="text-sm text-chilli-700">{save.errorText}</p> : null}
        {save.isSuccess ? <p className="text-sm font-semibold text-leaf-800">Saved.</p> : null}
        <Button size="lg" className="w-full" onClick={() => save.mutate({ ...f, orgName })}>Save settings</Button>

        <Card className="space-y-2">
          <CardTitle>Payment modes</CardTitle>
          <ul className="text-sm">{modes.data?.map((m) => <li key={m.id}>{m.name} · {m.isDigital ? "digital" : "cash"}</li>)}</ul>
          <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); await addMode.mutateAsync(mode); setMode({ name: "", isDigital: true }); }}>
            <Input className="flex-1" placeholder="e.g. Google Pay" value={mode.name} onChange={(e) => setMode((x) => ({ ...x, name: e.target.value }))} aria-label="Mode name" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={mode.isDigital} onChange={(e) => setMode((x) => ({ ...x, isDigital: e.target.checked }))} /> digital</label>
            <Button variant="outline" disabled={!mode.name}>Add</Button>
          </form>
        </Card>

        <Card className="space-y-2">
          <CardTitle>Financial years</CardTitle>
          <p className="text-xs text-muted">Closing a year saves a snapshot of every balance for reports. Balances simply continue into the next year — no duplicate opening entries are created.</p>
          <ul className="space-y-1 text-sm">{years.data?.map((y) => <li key={y.label} className="flex items-center justify-between"><span>FY {y.label} ({y.startDate} → {y.endDate})</span>{y.isClosed ? <span className="text-muted">closed</span> : <Button variant="ghost" size="sm" onClick={() => confirm(`Close FY ${y.label}?`) && closeYear.mutate({ label: y.label })}>Close year</Button>}</li>)}</ul>
          {closeYear.errorText ? <p className="text-sm text-chilli-700">{closeYear.errorText}</p> : null}
        </Card>

        <Can perm="backup:export">
          <Card className="space-y-2">
            <CardTitle>Backup</CardTitle>
            <p className="text-sm text-muted">Download a copy of all your business records (no passwords or bank account numbers). Full database backups are described in docs/OPERATIONS.md.</p>
            <Button variant="outline" asChild><a href="/api/backup/export">Download data export (JSON)</a></Button>
          </Card>
        </Can>

        <Card className="space-y-3">
          <CardTitle>My account — {me?.displayName}</CardTitle>
          <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); await changePw.mutateAsync(pw); await logout(); }}>
            <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw((x) => ({ ...x, currentPassword: e.target.value }))} /></Field>
            <Field label="New password" htmlFor="np"><Input id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw((x) => ({ ...x, newPassword: e.target.value }))} /></Field>
            {changePw.errorText ? <p className="col-span-2 text-sm text-chilli-700">{changePw.errorText}</p> : null}
            <Button className="col-span-2" variant="outline" disabled={!pw.currentPassword || !pw.newPassword}>Change password (signs out everywhere)</Button>
          </form>
          <Button variant="danger" onClick={async () => { await everywhere.mutateAsync({}); await logout(); }}>Sign out on all devices</Button>
        </Card>
      </div>
    </RequirePerm>
  );
}
