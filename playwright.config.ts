import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: { channel: "chrome", baseURL: "http://localhost:5273" },
  projects: [{ name: "chromium", use: { browserName: "chromium", channel: "chrome" } }],
  webServer: { command: "pnpm dev", port: 5273, reuseExistingServer: true },
});
