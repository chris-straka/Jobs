import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { JD, mkFixtureRepo, pkgDir, startCaptureServer, startStatic } from "./helpers.js";

test("popup save creates an application through the real server", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    await page.addInitScript(
      ({ jobUrl, description }: { jobUrl: string; description: string }) => {
        const store: Record<string, unknown> = {};
        const fakeChrome = {
          storage: {
            local: {
              get: (keys: string[]): Promise<Record<string, unknown>> =>
                Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
              set: (obj: Record<string, unknown>): Promise<void> => {
                Object.assign(store, obj);
                return Promise.resolve();
              },
            },
          },
          tabs: {
            query: (): Promise<{ id: number; url: string }[]> =>
              Promise.resolve([{ id: 7, url: jobUrl }]),
            sendMessage: (): Promise<unknown> =>
              Promise.resolve({ ok: true, posting: { description } }),
          },
          runtime: {
            // No native host in tests: the popup must fall back to copy buttons.
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      { jobUrl: `${site.url}/e2e/fixture-job.html`, description: `prefill ${"x".repeat(200)}` },
    );

    await page.goto(`${site.url}/popup.html`);
    await page.locator("#company").fill("Acme");
    await page.locator("#role").fill("Backend Engineer");
    await page.locator("#server").fill(capture.url);
    await page.locator("#description").fill(JD);
    await page.locator("#save").click();

    await expect(page.locator("#status")).toContainText(/Saved applications\//, {
      timeout: 30000,
    });
    await expect(page.locator("#status")).toContainText("Best fit: telemetry");

    const apps = await readdir(path.join(dir, "applications"));
    expect(apps).toHaveLength(1);
    const jobMd = await readFile(path.join(dir, "applications", apps[0], "job.md"), "utf8");
    expect(jobMd).toContain("Acme");
    const csv = await readFile(path.join(dir, "applications.csv"), "utf8");
    expect(csv).toContain('"draft"');

    // Mark applied resolves this tab's URL and moves csv + job.md together.
    await expect(page.locator("#health")).toContainText("server online");
    await page.locator("#mark-applied").click();
    await expect(page.locator("#status")).toContainText(/Marked applied/, { timeout: 15000 });
    const csv2 = await readFile(path.join(dir, "applications.csv"), "utf8");
    expect(csv2).toContain('"applied"');

    // Clipboard helpers copy runnable commands.
    await page.locator("#copy-stop").click();
    await expect(page.locator("#status")).toContainText("Copied:");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `pkill -f "server/src/index.ts"`,
    );
    await page.locator("#copy-start").click();
    const startCmd = await page.evaluate(() => navigator.clipboard.readText());
    expect(startCmd).toContain("bun run server");
    expect(startCmd).toContain(dir);

    // No native host here: native buttons hide, copy buttons carry the load.
    await expect(page.locator("#native-row")).toBeHidden();
    await expect(page.locator("#copy-start")).toBeVisible();
    await expect(page.locator("#copy-stop")).toBeVisible();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});
