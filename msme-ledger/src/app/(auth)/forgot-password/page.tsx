// src/app/(auth)/forgot-password/page.tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ message: string }>("/api/auth/recover", { method: "POST", json: { username } });
      setMsg(r.message);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Failed");
    }
  }
  return (
    <Card className="space-y-4">
      <p className="text-sm text-muted">
        This app does not send emails or SMS. An <strong>owner</strong> of your business can create a one-time reset link for you from <em>Team</em>.
      </p>
      {msg ? (
        <p role="status" className="rounded-lg bg-leaf-50 p-3 text-sm text-leaf-800">
          {msg}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Username" htmlFor="u">
            <Input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
          </Field>
          {err ? <p className="text-sm text-chilli-700">{err}</p> : null}
          <Button className="w-full" disabled={username.length < 3}>
            Request reset
          </Button>
        </form>
      )}
      <Link href="/login" className="block text-center text-sm font-semibold text-leaf-700">
        Back to sign in
      </Link>
    </Card>
  );
}
