// src/app/(auth)/reset-password/page.tsx
"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, issuesOf } from "@/lib/api";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw !== pw2) return setErr("Passwords do not match");
    try {
      await api("/api/auth/reset", { method: "POST", json: { token, password: pw } });
      setDone(true);
    } catch (x) {
      setErr([x instanceof Error ? x.message : "Failed", ...issuesOf(x)].join(" · "));
    }
  }
  if (!token) return <Card>This link is incomplete. Ask an owner for a new reset link.</Card>;
  return (
    <Card className="space-y-4">
      {done ? (
        <>
          <p className="rounded-lg bg-leaf-50 p-3 text-leaf-800">Password changed. All old sessions were signed out.</p>
          <Link href="/login" className="block text-center font-semibold text-leaf-700">
            Sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters with a letter and a number" htmlFor="p1">
            <Input id="p1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Repeat new password" htmlFor="p2">
            <Input id="p2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          {err ? <p className="text-sm text-chilli-700">{err}</p> : null}
          <Button className="w-full" disabled={!pw}>
            Set password
          </Button>
        </form>
      )}
    </Card>
  );
}

export default function ResetPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
