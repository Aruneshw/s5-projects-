// src/components/layout/nav.ts — navigation filtered by permission (UI convenience only).
import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CircleDollarSign,
  ClipboardList,
  FileScan,
  FileText,
  Gauge,
  HandCoins,
  History,
  Landmark,
  Package,
  ReceiptIndianRupee,
  RefreshCw,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/authorization/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perm: Permission;
  /** Shown in the mobile bottom bar (max 4 visible for a role). */
  primary?: boolean;
  /** Hide when the user also has this permission (avoids duplicates, e.g. cashier "Daily Ledger"). */
  hideIf?: Permission;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: Gauge, perm: "dashboard:view", primary: true },
  { href: "/bills/new?type=SALES", label: "New invoice", icon: ReceiptIndianRupee, perm: "bill:create:sales", primary: true },
  { href: "/bills?type=SALES", label: "Sales bills", icon: FileText, perm: "bill:read", primary: true },
  { href: "/bills?type=PURCHASE", label: "Purchase bills", icon: ShoppingCart, perm: "bill:create:purchase" },
  { href: "/ledger", label: "Ledger", icon: BookOpen, perm: "ledger:read", primary: true },
  { href: "/ledger/daily", label: "Daily ledger", icon: ClipboardList, perm: "ledger:daily", primary: true, hideIf: "ledger:read" },
  { href: "/payments", label: "Payments", icon: Wallet, perm: "payment:create" },
  { href: "/inventory", label: "Inventory", icon: Package, perm: "inventory:read" },
  { href: "/stores", label: "Stores", icon: Store, perm: "store:write" },
  { href: "/items", label: "Items", icon: Boxes, perm: "item:write" },
  { href: "/expenses", label: "Expenses", icon: HandCoins, perm: "expense:create" },
  { href: "/reports", label: "Reports", icon: BarChart3, perm: "report:read" },
  { href: "/discounting", label: "Invoice discounting", icon: CircleDollarSign, perm: "discount:read" },
  { href: "/credit", label: "Credit matchmaker", icon: Landmark, perm: "credit:read" },
  { href: "/ocr", label: "Scan purchase bill", icon: FileScan, perm: "ocr:use" },
  { href: "/team", label: "Team", icon: Users, perm: "team:manage" },
  { href: "/audit", label: "Audit log", icon: History, perm: "audit:read" },
  { href: "/sync", label: "Sync", icon: RefreshCw, perm: "sync:use" },
  { href: "/settings", label: "Settings", icon: Settings, perm: "settings:manage" },
  { href: "/marketplace", label: "Marketplace", icon: Building2, perm: "marketplace:read", primary: true },
  { href: "/investments", label: "Active investments", icon: CircleDollarSign, perm: "investment:read", primary: true },
  { href: "/lender", label: "Lender portal", icon: Landmark, perm: "lender:profiles:read", primary: true },
];

export function navFor(permissions: readonly Permission[]): NavItem[] {
  return NAV.filter((n) => permissions.includes(n.perm) && !(n.hideIf && permissions.includes(n.hideIf)));
}
