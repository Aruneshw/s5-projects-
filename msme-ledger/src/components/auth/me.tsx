// src/components/auth/me.tsx — current user / org / permissions for the UI.
"use client";
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Permission, RoleT } from "@/server/authorization/permissions";

export interface Me {
  userId: string;
  displayName: string;
  orgId: string;
  orgName: string;
  orgType: "MSME" | "FINANCIER";
  role: RoleT;
  permissions: Permission[];
  inactivityTimeoutMinutes: number;
  memberships: Array<{ orgId: string; orgName: string; orgType: string; role: RoleT }>;
}

const MeContext = createContext<Me | null>(null);

export function useMeQuery() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 5 * 60_000, retry: 1 });
}

export function MeProvider({ me, children }: { me: Me | null; children: React.ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me | null {
  return useContext(MeContext);
}

export function useCan(perm: Permission): boolean {
  const me = useMe();
  return !!me?.permissions.includes(perm);
}
