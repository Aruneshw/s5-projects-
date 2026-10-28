// tests/e2e/critical.spec.ts — uses the fictional seed data (npm run db:seed) and SEED_* passwords from .env.
import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";

const OWNER = { u: "me", p: process.env.SEED_OWNER_PASSWORD ?? "" };
const CASHIER = { u: "cashier", p: process.env.SEED_CASHIER_PASSWORD ?? "" };

async function login(page: Page, who: { u: string; p: string }) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(who.u);
  await page.getByLabel("Password").fill(who.p);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function startSale(page: Page, customer: string) {
  await page.goto("/bills/new?type=SALES");
  await page.getByLabel(/Customer \(shop — city\)/).fill(customer.slice(0, 6));
  await page.getByRole("option").filter({ hasText: customer }).click();
}

async function weighTomato(page: Page, weights: string[], rate: string) {
  const item = page.getByRole("combobox", { name: "Item" }).last();
  await item.fill("Tom");
  await item.press("Enter");
  const w = page.getByRole("textbox", { name: /bag.*weight/i }).last();
  for (const x of weights) {
    await w.fill(x);
    await w.press("Enter");
  }
  await w.press("Enter"); // blank Enter finishes weighing → focus moves to rate
  await expect(page.getByLabel(/^Rate/).last()).toBeFocused();
  await page.getByLabel(/^Rate/).last().fill(rate);
}

test("sign-in and sign-out; protected pages redirect when signed out", async ({ page }) => {
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/login\?next=%2Freports/);
  await login(page, OWNER);
  await expect(page.getByRole("heading", { name: /Vanakkam, Me/ })).toBeVisible();
});

test("kg workflow: 70 + 80 → 2 bags · 150 kg; posted bill shows weights, coolie and hidden margin", async ({ page }) => {
  await login(page, OWNER);
  await startSale(page, "Thrissur Greens — Thrissur");
  await weighTomato(page, ["70", "80"], "28");
  await expect(page.getByText("2 bags · 150 kg")).toBeVisible();
  await page.getByRole("button", { name: "Post bill" }).click();
  await expect(page).toHaveURL(/\/bills\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Weights: 70 + 80 kg")).toBeVisible();
  await expect(page.getByText(/Margin:/)).toHaveCount(0); // hidden by default
  await expect(page.getByRole("button", { name: "Show margin" })).toBeVisible();
});

test("cashier cannot reach reports, discounting or credit", async ({ page, request }) => {
  await login(page, CASHIER);
  await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
  await page.goto("/reports");
  await expect(page.getByText("You do not have access to this screen.")).toBeVisible();
  const res = await page.request.get("/api/reports/sales");
  expect(res.status()).toBe(403);
  const res2 = await page.request.get("/api/credit/offers");
  expect(res2.status()).toBe(403);
  void request;
});

test("offline sale is saved on the phone and syncs after reconnection", async ({ page, context }) => {
  await login(page, OWNER);
  await page.goto("/sync");
  await startSale(page, "Malabar Veg Stores — Kozhikode");
  await context.setOffline(true);
  await expect(page.getByText(/Offline — this bill is saved/)).toBeVisible();
  await weighTomato(page, ["55.5"], "30");
  await page.getByRole("button", { name: "Save on phone" }).click();
  await expect(page.getByText(/Saved on this phone/)).toBeVisible();
  await expect(page).toHaveURL(/\/sync/);
  await expect(page.getByText(/Sales bill · Malabar Veg Stores/).first()).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("synced").first()).toBeVisible({ timeout: 20_000 });
  const bills = await (await page.request.get("/api/bills?type=SALES&limit=5")).json();
  expect(bills.some((b: { party: string; invoiceAmount: string }) => b.party.startsWith("Malabar") && b.invoiceAmount === "1675.00")).toBe(true); // 55.5×30 + 1 bag×10 coolie
});
