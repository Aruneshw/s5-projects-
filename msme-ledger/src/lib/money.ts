// src/lib/money.ts
// Decimal-safe money and quantity helpers. NEVER use JavaScript floats for money.
// Rounding rule (documented in docs/FINANCIAL_RULES.md): ROUND_HALF_UP at 2 decimal
// places for money and 3 decimal places for quantities, applied at each documented step.
import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
export type DecimalInput = Dec | string | number;

/** Convert anything decimal-like (incl. Prisma.Decimal, which exposes toString) to our Decimal. */
export function dec(value: DecimalInput | { toString(): string } | null | undefined): Dec {
  if (value === null || value === undefined) return new D(0);
  if (value instanceof D) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite number cannot be used as money");
    return new D(String(value));
  }
  return new D(value.toString());
}

export const ZERO = new D(0);

export function money(value: DecimalInput | { toString(): string }): Dec {
  return dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export function qty(value: DecimalInput | { toString(): string }): Dec {
  return dec(value).toDecimalPlaces(3, D.ROUND_HALF_UP);
}

export function sum(values: Array<DecimalInput | { toString(): string }>): Dec {
  return values.reduce<Dec>((acc, v) => acc.plus(dec(v)), new D(0));
}

/** Fixed 2dp string, safe to send to Prisma Decimal columns or over JSON. */
export function m2(value: DecimalInput | { toString(): string }): string {
  return money(value).toFixed(2);
}

export function q3(value: DecimalInput | { toString(): string }): string {
  return qty(value).toFixed(3);
}

/**
 * Indian number formatting: 12,34,567.89 (lakh / crore grouping).
 * Uses string manipulation (not Intl on floats) so large values never lose precision.
 */
export function formatINR(value: DecimalInput | { toString(): string }, opts: { symbol?: boolean } = {}): string {
  const d = money(value);
  const negative = d.isNegative() && !d.isZero();
  const [intPart = "0", frac = "00"] = d.abs().toFixed(2).split(".");
  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  const sym = opts.symbol === false ? "" : "₹";
  return `${negative ? "-" : ""}${sym}${grouped}.${frac}`;
}

export function formatQty(value: DecimalInput | { toString(): string }, unit: string): string {
  const d = qty(value);
  const s = d.isInteger() ? d.toFixed(0) : d.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} ${unit}`;
}
