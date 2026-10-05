import { defineConfig } from "@playwright/test";

// Run `npm run build` first. Uses its own throw-away SQLite file.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3200",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: "rm -f data/e2e.db && npx prisma db push && npx next start -H 127.0.0.1 -p 3200",
    url: "http://127.0.0.1:3200/api/months",
    env: { DATABASE_URL: "file:./data/e2e.db" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
