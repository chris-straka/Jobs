import { defineConfig } from "@playwright/test";

// Real Chromium, no extension context needed: the specs inject the built
// bundles (content.js, popup.html) into plain pages and drive them.
export default defineConfig({
  testDir: "e2e",
  timeout: 90000,
  retries: 0,
  reporter: "list",
  // Serial: the save spec compiles a real resume; parallel workers starve it
  // past its 30s save timeout on this machine.
  workers: 1,
  use: { headless: true },
});
