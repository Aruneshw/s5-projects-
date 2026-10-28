// src/server/authorization/permissions.ts
// Single source of truth for role-based access control (RBAC).
// This file has no server-only imports so the UI can use the SAME map for hiding buttons —
// but hiding is only a convenience: every Route Handler re-checks with requirePermission().

export const ROLES = ["MSME_OWNER", "STAFF_CASHIER", "INVESTOR", "LENDER_BANK"] as const;
export type RoleT = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard:view",
  "dashboard:financials", // revenue, dues, trust badge
  "store:read",
  "store:write",
  "store:bank:read",
  "store:bank:write",
  "store:adjust", // opening balance / balance corrections
  "item:read",
  "item:write",
  "bill:read",
  "bill:create:sales",
  "bill:create:purchase",
  "bill:cancel",
  "bill:adjust",
  "bill:print",
  "bill:margin:view",
  "bill:oversell:approve",
  "payment:read",
  "payment:create",
  "payment:cancel",
  "ledger:read",
  "ledger:daily",
  "inventory:read",
  "inventory:adjust",
  "expense:read",
  "expense:create",
  "expense:cancel",
  "salary:manage",
  "report:read",
  "report:export",
  "tax:read",
  "discount:read",
  "discount:request",
  "credit:read",
  "credit:apply",
  "team:manage",
  "audit:read",
  "settings:manage",
  "sync:use",
  "ocr:use",
  "backup:export",
  "marketplace:read",
  "marketplace:bid",
  "investment:read",
  "investment:fund",
  "lender:profiles:read",
  "lender:offers:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER: readonly Permission[] = PERMISSIONS.filter(
  (p) => !p.startsWith("marketplace:") && !p.startsWith("investment:") && !p.startsWith("lender:"),
);

const ROLE_PERMISSIONS: Record<RoleT, readonly Permission[]> = {
  MSME_OWNER: OWNER,
  // Cashier: permitted sales, expenses, printing invoices and the daily ledger.
  // Explicitly NO financial reports, discounting, credit, margins, team or purchase bills.
  STAFF_CASHIER: [
    "dashboard:view",
    "store:read",
    "item:read",
    "bill:read",
    "bill:create:sales",
    "bill:print",
    "payment:create",
    "ledger:daily",
    "expense:read",
    "expense:create",
    "sync:use",
  ],
  INVESTOR: ["marketplace:read", "marketplace:bid", "investment:read", "investment:fund"],
  LENDER_BANK: ["lender:profiles:read", "lender:offers:manage"],
};

export function hasPermission(role: RoleT | null | undefined, action: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(action) ?? false;
}

export function permissionsFor(role: RoleT): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Which roles belong to which organisation type. */
export function roleAllowedInOrg(role: RoleT, orgType: "MSME" | "FINANCIER"): boolean {
  return orgType === "MSME" ? role === "MSME_OWNER" || role === "STAFF_CASHIER" : role === "INVESTOR" || role === "LENDER_BANK";
}
