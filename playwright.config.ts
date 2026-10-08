import { defineConfig } from "@playwright/test";

// Builds the static site and serves ./out under the GitHub Pages base path, exactly like production.
const BASE = "/employee-email-kpi-analyzer";
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:3200${BASE}/`,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    acceptDownloads: true,
  },
  webServer: {
    command: `npm run build && node scripts/serve-static.mjs --port 3200 --base ${BASE} --dir out`,
    url: `http://127.0.0.1:3200${BASE}/`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
