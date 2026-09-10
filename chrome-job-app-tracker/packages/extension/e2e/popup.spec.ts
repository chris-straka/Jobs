import { expect, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { JD, mkFixtureRepo, pkgDir, startCaptureServer, startStatic } from "./helpers.js";

test("popup save creates an application through the real server", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { dir, cleanup } = await mkFixtureRepo();
  // The build stamps the real checkout path; remove it so the fixture stays isolated.
  const { rm } = await import("node:fs/promises");
  await rm(path.join(pkgDir, "repo-root.txt"), { force: true });
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    await page.addInitScript(
      ({
        jobUrl,
        description,
        serverUrl,
        serverRoot,
      }: {
        jobUrl: string;
        description: string;
        serverUrl: string;
        serverRoot: string;
      }) => {
        const store: Record<string, unknown> = { server: serverUrl, serverRoot };
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
      {
        jobUrl: `${site.url}/e2e/fixture-job.html`,
        description: `prefill ${"x".repeat(200)}`,
        serverUrl: capture.url,
        serverRoot: dir,
      },
    );

    await page.goto(`${site.url}/popup.html`);
    await page.locator("#company").fill("Acme");
    await page.locator("#role").fill("Backend Engineer");
    await page.locator("#description").fill(JD);

    // No server field; track is a dropdown defaulting to the detected track.
    await expect(page.locator("#server")).toHaveCount(0);
    await expect(page.locator("#track")).toBeVisible();
    await expect(page.locator("#track")).toHaveValue("swe");
    // Untracked URL: mark-applied waits for the save.
    await expect(page.locator("#mark-applied")).toBeDisabled();
    await expect(page.locator("#copy-row")).toBeVisible();
    await page.locator("#save").click();

    await expect(page.locator("#status")).toContainText(/Saved applications\//, {
      timeout: 30000,
    });
    await expect(page.locator("#status")).toContainText("Best match: telemetry");

    // The form gives way to the result: opener links plus mark-applied.
    await expect(page.locator("#capture-form")).toBeHidden();
    await expect(page.locator("#open-saved")).toHaveAttribute(
      "href",
      /vscode:\/\/file.*applications\//,
    );

    const apps = await readdir(path.join(dir, "applications"));
    expect(apps).toHaveLength(1);
    const jobMd = await readFile(path.join(dir, "applications", apps[0], "job.md"), "utf8");
    expect(jobMd).toContain("Acme");
    const csv = await readFile(path.join(dir, "applications.csv"), "utf8");
    expect(csv).toContain('"draft"');

    // Mark applied resolves this tab's URL and moves csv + job.md together.
    await expect(page.locator("#health")).toContainText("Server Online");
    await page.locator("#mark-applied").click();
    await expect(page.locator("#status")).toContainText(/Marked applied/, { timeout: 15000 });
    const csv2 = await readFile(path.join(dir, "applications.csv"), "utf8");
    expect(csv2).toContain('"applied"');

    // One copy button follows the server: stop cmd while online...
    await page.locator("#copy-srv").click();
    await expect(page.locator("#toast")).toContainText("Copied:");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `pkill -f "server/src/index.ts"`,
    );

    // ...start cmd once offline.
    capture.stop();
    await page.reload();
    await expect(page.locator("#health")).toContainText("Server Offline");
    await page.locator("#copy-srv").click();
    await expect(page.locator("#toast")).toContainText("Copied:");
    const startCmd = await page.evaluate(() => navigator.clipboard.readText());
    expect(startCmd).toContain("bun run server");
    expect(startCmd).toContain(dir);

    // No native host here: the pill toggle disables, copy button carries the load.
    await expect(page.locator("#health")).toBeDisabled();
    await expect(page.locator("#copy-srv")).toBeVisible();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

test("native toggle starts and stops the server through the host", async ({ page }) => {
  await page.addInitScript(() => {
    let started = false;
    const calls: string[] = [];
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
        query: (): Promise<unknown[]> => Promise.resolve([]),
      },
      runtime: {
        sendNativeMessage: (_host: string, msg: { cmd?: string }): Promise<unknown> => {
          calls.push(msg.cmd ?? "?");
          if (msg.cmd === "status") return Promise.resolve({ ok: true, running: started });
          if (msg.cmd === "start") {
            started = true;
            return Promise.resolve({ ok: true });
          }
          if (msg.cmd === "stop") {
            started = false;
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve({ ok: false });
        },
      },
    };
    const w = window as unknown as { chrome?: unknown; __jatCalls?: string[] };
    w.chrome = fakeChrome;
    w.__jatCalls = calls;
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/popup.html`);
    // Base health text depends on ambient port state; the action label
    // comes from the mocked host and is deterministic.
    await expect(page.locator("#health")).toContainText("Start server");
    await expect(page.locator("#health")).toBeEnabled();
    await expect(page.locator("#copy-row")).toBeHidden();

    await page.locator("#health").click();
    await expect(page.locator("#status")).toContainText("Server starting");
    await expect(page.locator("#health")).toContainText("Stop server");

    await page.locator("#health").click();
    await expect(page.locator("#status")).toContainText("Server stopped");
    await expect(page.locator("#health")).toContainText("Start server");

    const calls = await page.evaluate(
      () => (window as unknown as { __jatCalls?: string[] }).__jatCalls ?? [],
    );
    expect(calls[0]).toBe("status");
    expect(calls).toContain("start");
    expect(calls).toContain("stop");
  } finally {
    site.close();
  }
});
