// tests/unit/bill-form.test.ts — the bag-by-bag weight prompt and payload building.
import { describe, expect, it } from "vitest";
import { emptyForm, emptyLine, formToPayload, previewLine, submitWeight, validateForm, type LineState } from "@/features/bills/form";

describe("next-bag-weight prompt", () => {
  it("70 ↵ 80 ↵ (blank) ↵ → 2 bags, 150 kg, finished", () => {
    let line: LineState = { ...emptyLine(), itemId: "i", weightInput: "70" };
    let r = submitWeight(line);
    expect(r).toMatchObject({ finished: false, error: null });
    line = { ...r.line, weightInput: "80" };
    r = submitWeight(line);
    expect(r.line.weights).toEqual(["70", "80"]);
    r = submitWeight({ ...r.line, weightInput: "" });
    expect(r.finished).toBe(true);
    const p = previewLine("SALES", { ...r.line, rate: "28" }, { unitType: "KG", cooliePerBag: "10" });
    expect(p).toMatchObject({ ok: true, bagCount: 2, quantity: "150.000", amount: "4200.00", coolieAmount: "20.00" });
  });
  it("blank before any bag is an error, bad input is rejected without losing earlier bags", () => {
    expect(submitWeight({ ...emptyLine(), weightInput: "" }).error).toMatch(/first bag/);
    const r = submitWeight({ ...emptyLine(), weights: ["70"], weightInput: "abc" });
    expect(r.error).toBeTruthy();
    expect(r.line.weights).toEqual(["70"]);
    expect(submitWeight({ ...emptyLine(), weightInput: "0" }).error).toBeTruthy();
    expect(submitWeight({ ...emptyLine(), weightInput: "1200" }).error).toMatch(/1000/);
  });
  it("bag items skip weights entirely", () => {
    const p = previewLine("PURCHASE", { ...emptyLine(), itemId: "i", entryMode: "COUNT", quantity: "20", rate: "900" }, { unitType: "BAG", cooliePerBag: "12" });
    expect(p).toMatchObject({ ok: true, bagCount: 20, amount: "18000.00", coolieAmount: "0.00" });
  });
});

describe("payload", () => {
  it("sends inputs only (no totals), drops blank rows, keeps weights", () => {
    const f = emptyForm("SALES", "2026-10-15", "11111111-1111-4111-8111-111111111111");
    f.storeId = "22222222-2222-4222-8222-222222222222";
    f.lines = [{ ...emptyLine(), itemId: "33333333-3333-4333-8333-333333333333", weights: ["70", "80"], rate: "28" }, emptyLine()];
    const p = formToPayload(f, { post: true });
    expect(p.lines).toHaveLength(1);
    expect(p.lines[0]).toMatchObject({ entryMode: "WEIGHED", weights: ["70", "80"], rate: "28" });
    expect(p).not.toHaveProperty("totalBalance");
    expect(p.commissionPercent).toBe("0");
  });
  it("validation catches a weight typed but not entered, and missing reasons", () => {
    const f = emptyForm("SALES", "2026-10-15");
    f.storeId = "s";
    f.lines = [{ ...emptyLine(), itemId: "i", weights: ["70"], weightInput: "80", rate: "28" }];
    f.lessAmount = "10";
    const previews = f.lines.map((l) => previewLine("SALES", l, { unitType: "KG", cooliePerBag: "0" }));
    const errs = validateForm(f, previews);
    expect(errs.join(" ")).toMatch(/press Enter to add the last weight/);
    expect(errs.join(" ")).toMatch(/reason for Less/);
  });
});
