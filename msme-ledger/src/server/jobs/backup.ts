// src/server/jobs/backup.ts
// Logical export of ONE organisation (owner-downloadable). This complements, and does not
// replace, full PostgreSQL backups with pg_dump (see scripts/backup.* and docs/OPERATIONS.md).
// Secrets are excluded: password hashes, reset tokens and bank account numbers are never exported.
import "server-only";
import { prisma } from "../db";

export async function exportOrganisation(orgId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, settings: true, createdAt: true } });
  const [members, stores, items, bills, lines, weights, links, payments, adjustments, ledger, movements, expenses, workers, salaries, modes, years] = await Promise.all([
    prisma.membership.findMany({ where: { orgId }, select: { role: true, isActive: true, user: { select: { username: true, displayName: true } } } }),
    prisma.store.findMany({ where: { orgId } }),
    prisma.item.findMany({ where: { orgId } }),
    prisma.bill.findMany({ where: { orgId } }),
    prisma.billLine.findMany({ where: { orgId } }),
    prisma.bagWeight.findMany({ where: { line: { orgId } } }),
    prisma.purchaseSaleLink.findMany({ where: { orgId } }),
    prisma.payment.findMany({ where: { orgId } }),
    prisma.billAdjustment.findMany({ where: { orgId } }),
    prisma.ledgerEntry.findMany({ where: { orgId }, orderBy: { seq: "asc" } }),
    prisma.inventoryMovement.findMany({ where: { orgId } }),
    prisma.expense.findMany({ where: { orgId } }),
    prisma.worker.findMany({ where: { orgId } }),
    prisma.workerSalary.findMany({ where: { orgId } }),
    prisma.paymentMode.findMany({ where: { orgId } }),
    prisma.financialYear.findMany({ where: { orgId } }),
  ]);
  return {
    format: "msme-ledger-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    organisation: org,
    members,
    stores,
    items,
    bills,
    billLines: lines,
    bagWeights: weights,
    purchaseSaleLinks: links,
    payments,
    billAdjustments: adjustments,
    ledgerEntries: ledger,
    inventoryMovements: movements,
    expenses,
    workers,
    workerSalaries: salaries,
    paymentModes: modes,
    financialYears: years,
    counts: { bills: bills.length, ledgerEntries: ledger.length, payments: payments.length },
  };
}
