// src/lib/dates.ts
// Business dates are calendar dates in India Standard Time (Asia/Kolkata).
// They are exchanged as "YYYY-MM-DD" strings and stored in PostgreSQL DATE columns.
// We represent a DATE as a JS Date at 00:00:00 UTC of that calendar day, which is what
// Prisma reads/writes for @db.Date columns.

export const BUSINESS_TZ = "Asia/Kolkata";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** "YYYY-MM-DD" → Date (UTC midnight) for @db.Date columns. */
export function toDbDate(s: string): Date {
  if (!isIsoDate(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}

/** Date from a @db.Date column → "YYYY-MM-DD". */
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in IST. */
export function todayIST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(s: string, days: number): string {
  const d = toDbDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / 86_400_000);
}

/** Indian financial year label containing the date, e.g. 2026-10-15 → "2026-27". */
export function financialYearOf(s: string): { label: string; start: string; end: string } {
  const [y, m] = s.split("-").map(Number) as [number, number];
  const startYear = m >= 4 ? y : y - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
  };
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

/** The last `n` month keys ending with the month of `asOf` (oldest first). */
export function lastMonths(asOf: string, n: number): string[] {
  const [y, m] = asOf.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function formatDisplayDate(s: string): string {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}
