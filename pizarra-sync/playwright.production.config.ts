import { defineConfig, devices } from "@playwright/test";

// Explicit opt-in: these tests create temporary rooms in the published service.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://pizarra-sync.vercel.app",
    ...devices["Desktop Chrome"],
    launchOptions: process.env.E2E_BROWSER_PATH
      ? { executablePath: process.env.E2E_BROWSER_PATH }
      : {},
  },
});
