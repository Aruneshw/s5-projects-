// src/features/discounting/pricing.ts
// Invoice discounting price calculation. Pure and deterministic.
//
//   Annual rate: score >= 750 → 10%, 650–749 → 12%, < 650 → 15%
//   Daily Rate  = Annual Rate / 365          (kept at full precision, never rounded)
//   Fee         = round2(Amount × Daily Rate × Tenure Days)
//   Reserve     = round2(Amount × 0.15)
//   Payout      = Amount − Reserve − Fee
//
// Payout is mathematically Amount × 0.85 − Fee. We compute it as Amount − Reserve − Fee so the
// three parts always add up to the invoice amount to the paisa (enforced by a DB CHECK).
import { D, dec, money, type Dec, type DecimalInput } from "@/lib/money";

export const RESERVE_RATIO = new D("0.15");
export const PRICING_TENURE_MIN = 1;
export const PRICING_TENURE_MAX = 180;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingError";
  }
}

export function annualRateForScore(trustScore: number): Dec {
  if (!Number.isInteger(trustScore) || trustScore < 300 || trustScore > 900) {
    throw new PricingError("Trust score must be an integer between 300 and 900");
  }
  if (trustScore >= 750) return new D(10);
  if (trustScore >= 650) return new D(12);
  return new D(15);
}

export interface DiscountPricing {
  invoiceAmount: Dec;
  tenureDays: number;
  annualRatePercent: Dec;
  dailyRate: Dec;
  discountFee: Dec;
  reserveHoldback: Dec;
  upfrontPayout: Dec;
}

export function calculateDiscountPricing(invoiceAmount: DecimalInput, tenureDays: number, trustScore: number): DiscountPricing {
  const amount = dec(invoiceAmount);
  if (!amount.isFinite() || amount.lte(0)) throw new PricingError("Invoice amount must be greater than 0");
  if (amount.decimalPlaces() > 2) throw new PricingError("Invoice amount cannot have more than 2 decimal places");
  if (!Number.isInteger(tenureDays) || tenureDays < PRICING_TENURE_MIN || tenureDays > PRICING_TENURE_MAX) {
    throw new PricingError(`Tenure must be a whole number of days between ${PRICING_TENURE_MIN} and ${PRICING_TENURE_MAX}`);
  }
  const annualRatePercent = annualRateForScore(trustScore);
  const dailyRate = annualRatePercent.div(100).div(365);
  const discountFee = money(amount.times(dailyRate).times(tenureDays));
  const reserveHoldback = money(amount.times(RESERVE_RATIO));
  const upfrontPayout = money(amount.minus(reserveHoldback).minus(discountFee));
  if (upfrontPayout.lte(0)) throw new PricingError("Pricing would produce a non-positive payout");
  return { invoiceAmount: money(amount), tenureDays, annualRatePercent, dailyRate, discountFee, reserveHoldback, upfrontPayout };
}

export function pricingToJSON(p: DiscountPricing) {
  return {
    invoiceAmount: p.invoiceAmount.toFixed(2),
    tenureDays: p.tenureDays,
    annualRatePercent: p.annualRatePercent.toFixed(2),
    discountFee: p.discountFee.toFixed(2),
    reserveHoldback: p.reserveHoldback.toFixed(2),
    upfrontPayout: p.upfrontPayout.toFixed(2),
  };
}
