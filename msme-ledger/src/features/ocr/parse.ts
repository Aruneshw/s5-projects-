// src/features/ocr/parse.ts
// Turns raw OCR text from a supplier's purchase bill into UNTRUSTED candidate fields.
// Nothing here is ever posted automatically: the user reviews, fixes and confirms.
import { dec, money } from "@/lib/money";

export interface OcrLineCandidate {
  raw: string;
  itemText: string;
  itemId: string | null;
  quantity: string | null;
  rate: string | null;
  amount: string | null;
  issues: string[];
}

export interface OcrCandidates {
  supplierText: string | null;
  storeId: string | null;
  date: string | null;
  lines: OcrLineCandidate[];
  total: string | null;
  linesSum: string;
  issues: string[];
}

const num = (s: string) => s.replace(/,/g, "");

function parseDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return check.toISOString().slice(0, 10) === iso ? iso : null;
}

function bestMatch<T extends { id: string; name: string }>(text: string, options: T[]): T | null {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  let best: T | null = null;
  let bestLen = 0;
  for (const o of options) {
    const n = o.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    if (!n) continue;
    if (t.includes(n) || n.includes(t)) {
      const len = Math.min(n.length, t.length);
      if (len > bestLen) {
        best = o;
        bestLen = len;
      }
    }
  }
  return best;
}

const LINE_RE =
  /^\s*(?:\d+[.)]\s*)?([A-Za-z][A-Za-z .()'\-]{1,40}?)\s+(\d{1,6}(?:\.\d{1,3})?)\s*(?:kgs?|bags?|box(?:es)?|nos?)?\s*(?:[x@*]\s*)?(\d{1,6}(?:\.\d{1,2})?)\s+(?:rs\.?\s*|₹\s*)?(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*$/i;

export function parsePurchaseBillText(
  text: string,
  stores: Array<{ id: string; name: string }>,
  items: Array<{ id: string; name: string }>,
): OcrCandidates {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const issues: string[] = [];
  const supplierLine = rawLines.find((l) => /[A-Za-z]{3,}/.test(l) && !/bill|invoice|date|phone|gst/i.test(l)) ?? null;
  const store = supplierLine ? bestMatch(supplierLine, stores) : null;
  if (!store) issues.push("Supplier not recognised — choose it manually");

  const date = parseDate(text);
  if (!date) issues.push("Bill date not found");

  const lines: OcrLineCandidate[] = [];
  for (const raw of rawLines) {
    if (/total|balance|amount due|grand/i.test(raw)) continue;
    const m = raw.match(LINE_RE);
    if (!m) continue;
    const [, itemText = "", q = "", r = "", a = ""] = m;
    const item = bestMatch(itemText, items);
    const lineIssues: string[] = [];
    if (!item) lineIssues.push("Item not recognised");
    const quantity = num(q);
    const rate = num(r);
    const amount = num(a);
    const expected = money(dec(quantity).times(dec(rate)));
    if (!expected.equals(money(amount))) lineIssues.push(`Qty × rate = ${expected.toFixed(2)}, bill shows ${money(amount).toFixed(2)}`);
    lines.push({ raw, itemText: itemText.trim(), itemId: item?.id ?? null, quantity, rate, amount: money(amount).toFixed(2), issues: lineIssues });
  }
  if (lines.length === 0) issues.push("No item lines could be read — enter them manually");

  const totalMatch = text.match(/(?:grand\s*)?total\s*[:\-]?\s*(?:rs\.?|₹)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/i);
  const total = totalMatch?.[1] ? money(num(totalMatch[1])).toFixed(2) : null;
  const linesSum = money(lines.reduce((acc, l) => acc.plus(dec(l.amount ?? 0)), dec(0))).toFixed(2);
  if (total && total !== linesSum) issues.push(`Line amounts add up to ${linesSum} but the bill total reads ${total}`);
  if (!total) issues.push("Bill total not found");

  return { supplierText: supplierLine, storeId: store?.id ?? null, date, lines, total, linesSum, issues };
}
