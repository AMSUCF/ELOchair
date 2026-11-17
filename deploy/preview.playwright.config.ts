import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.PREVIEW_TEST_PORT ?? 5190);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "../docs/design/visitor-preview/e2e",
  outputDir: "../test-results/preview",
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.PREVIEW_TEST_BROWSER
      ? { executablePath: process.env.PREVIEW_TEST_BROWSER }
      : undefined,
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory docs/design/visitor-preview`,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
