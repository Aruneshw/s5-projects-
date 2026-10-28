// src/lib/validation/common.ts
import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

/** Money as a string with ≤ 2 decimals; accepts numbers too (converted via String). */
export const moneyStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with at most 2 decimals"));

export const signedMoneyStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/, "Enter an amount with at most 2 decimals"));

export const qtyStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a quantity with at most 3 decimals"));

export const percentStr = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a percentage"));

export const isoDate = z.string().refine(isIsoDate, "Use the YYYY-MM-DD date format");
export const uuid = z.uuid();
export const shortText = (max = 120) => z.string().trim().max(max);
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const dateRange = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, { message: "'from' must be on or before 'to'" });
