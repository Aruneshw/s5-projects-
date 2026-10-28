// src/components/auth/can.tsx — UI wrappers. They only HIDE things; the server enforces access.
"use client";
import { ShieldAlert } from "lucide-react";
import { useMe } from "./me";
import type { Permission, RoleT } from "@/server/authorization/permissions";

export function Can({ perm, children, fallback = null }: { perm: Permission; children: React.ReactNode; fallback?: React.ReactNode }) {
  const me = useMe();
  return <>{me?.permissions.includes(perm) ? children : fallback}</>;
}

function Denied({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-xl border-2 border-turmeric-100 bg-turmeric-100/50 p-4 text-turmeric-700">
      <ShieldAlert className="size-5" /> {text}
    </div>
  );
}

export function ProtectRole({ roles, children }: { roles: RoleT[]; children: React.ReactNode }) {
  const me = useMe();
  if (!me) return null;
  return roles.includes(me.role) ? <>{children}</> : <Denied text="This screen is not available for your role." />;
}

export function RequirePerm({ perm, children }: { perm: Permission; children: React.ReactNode }) {
  const me = useMe();
  if (!me) return null;
  return me.permissions.includes(perm) ? <>{children}</> : <Denied text="You do not have access to this screen." />;
}
