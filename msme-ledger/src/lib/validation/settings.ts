// src/lib/validation/settings.ts
// Organisation settings (stored as JSON on organizations.settings). Every value has a safe default.
import { z } from "zod";

export const TaxAssumptionsSchema = z.object({
  /** Presumptive scheme percentage applied to digital/banking receipts (verify with your CA). */
  presumptiveDigitalPercent: z.number().min(0).max(100).default(6),
  /** Presumptive scheme percentage applied to other (cash) receipts (verify with your CA). */
  presumptiveCashPercent: z.number().min(0).max(100).default(8),
  /** Turnover limit indicator (₹) — standard. */
  presumptiveTurnoverLimit: z.number().min(0).default(20_000_000),
  /** Turnover limit indicator (₹) when cash receipts ≤ 5% of total. */
  presumptiveEnhancedLimit: z.number().min(0).default(30_000_000),
  /** Cash-receipt share (%) at or below which the enhanced limit indicator applies. */
  enhancedLimitCashSharePercent: z.number().min(0).max(100).default(5),
  /** GST note shown on reports. Fresh vegetables are generally NIL-rated; verify for your items. */
  gstNote: z
    .string()
    .max(500)
    .default("Fresh/chilled vegetables (HSN 0701–0709) are listed at NIL GST. Confirm your items and registration status with a CA."),
  sourceUrls: z.array(z.string().url()).default([]),
});

export const OrgSettingsSchema = z.object({
  minDiscountInvoiceAmount: z.number().min(0).default(5000),
  discountMinDaysToDue: z.number().int().min(1).default(15),
  discountMaxDaysToDue: z.number().int().max(180).default(90),
  defaultCreditDays: z.number().int().min(0).max(180).default(30),
  overdueAlertDays: z.number().int().min(1).default(30),
  staleStockDays: z.number().int().min(1).default(3),
  defaultCommissionPercent: z.number().min(0).max(100).default(1),
  inactivityTimeoutMinutes: z.number().int().min(5).max(480).default(30),
  /** userId → percent share of profit, used only for the per-partner tax view. Must sum to 100 when set. */
  profitAllocation: z.record(z.string(), z.number().min(0).max(100)).default({}),
  taxAssumptions: TaxAssumptionsSchema.default(TaxAssumptionsSchema.parse({})),
});

export type OrgSettings = z.infer<typeof OrgSettingsSchema>;

export function parseSettings(raw: unknown): OrgSettings {
  const r = OrgSettingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : OrgSettingsSchema.parse({});
}
