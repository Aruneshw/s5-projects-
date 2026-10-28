// playwright.config.ts — critical end-to-end workflows on a phone-sized viewport.
// Run against a SEEDED development database:  npm run build && npm run start  (another terminal)  then  npm run test:e2e
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Pixel 7"],
    // Optional: use an already-installed Chrome/Chromium instead of `npx playwright install chromium`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: "npm run start", url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
