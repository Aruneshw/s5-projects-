// src/app/(app)/layout.tsx — authenticated area. Server-side session check, then the client shell.
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/server/auth/session";
import { permissionsFor } from "@/server/authorization/permissions";
import { myMemberships } from "@/server/services/team";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  const me = {
    userId: ctx.userId,
    displayName: ctx.displayName,
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    orgType: ctx.orgType,
    role: ctx.role,
    permissions: [...permissionsFor(ctx.role)],
    inactivityTimeoutMinutes: ctx.settings.inactivityTimeoutMinutes,
    memberships: await myMemberships(ctx.userId),
  };
  return (
    <Suspense>
      <AppShell me={me}>{children}</AppShell>
    </Suspense>
  );
}
