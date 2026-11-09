import { defineConfig, devices } from "@playwright/test";

/** Override with E2E_PORT when several checkouts run the tests at once (the next port is used too). */
const PORT = Number(process.env.E2E_PORT ?? 8090);

/**
 * End-to-end smoke tests at phone size against the real server, which serves the built web app
 * from an in-memory database. Run with `npm run e2e` from the repository root (it builds first).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "Europe/Lisbon",
      },
    },
  ],
  webServer: {
    command: "npx tsx ../server/src/main.ts",
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATA_DIR: "memory://",
      SEED_ON_START: "1",
      ENABLE_TEST_ENDPOINTS: "1",
      MAIL_TRANSPORT: "memory",
      APP_ORIGIN: `http://localhost:${PORT}`,
      PUBLIC_HOST: "127.0.0.1",
      PUBLIC_PORT: String(PORT),
      INTERNAL_PORT: String(PORT + 1),
      WEB_DIST: "dist",
    },
  },
});
