import { defineConfig } from "@playwright/test";

// Real Chromium, no extension context needed: the specs inject the built
// bundles (content.js, popup.html) into plain pages and drive them.
export default defineConfig({
  testDir: "e2e",
  timeout: 90000,
  retries: 0,
  reporter: "list",
  use: { headless: true },
});
