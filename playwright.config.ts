import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests run against a real `next dev` server (StrictMode ON — that's
 * deliberate, several Phase 3 bugs only reproduce under StrictMode's
 * mount→unmount→remount). If a dev server is already on :3000 it's reused;
 * otherwise one is started.
 */
export default defineConfig({
  testDir: "./e2e",
  // Seeding shares one trip across tests in a file — keep them serial.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
