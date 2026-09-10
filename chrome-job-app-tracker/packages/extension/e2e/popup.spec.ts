import { expect, test } from "@playwright/test";
import { appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { JD, mkFixtureRepo, pkgDir, startCaptureServer, startStatic } from "./helpers.js";

test("failed builds keep mark-applied off and leave one message box", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  // Break the template import so the scaffold cannot compile.
  await appendFile(path.join(dir, "templates", "lib.typ"), "\n#let broken = (((\n");
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    await page.addInitScript(
      ({
        jobUrl,
        serverUrl,
        serverRoot,
        description,
      }: {
        jobUrl: string;
        serverUrl: string;
        serverRoot: string;
        description: string;
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
              Promise.resolve({ ok: true, posting: { title: "Broken Build Role", description } }),
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      {
        jobUrl: `${site.url}/e2e/fixture-job.html`,
        serverUrl: capture.url,
        serverRoot: dir,
        description: JD,
      },
    );

    await page.goto(`${site.url}/popup.html`);
    await page.locator("#company").fill("Acme");
    await page.locator("#save").click();

    await expect(page.locator("#result")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#build-line")).toContainText("Build failed");
    await expect(page.locator("#build-output")).not.toBeEmpty();
    await expect(page.locator("#mark-applied")).toBeDisabled();
    // One box only: the status that said Saving… is gone.
    await expect(page.locator("#status")).toBeHidden();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

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

    // The form gives way to the result: build state, opener links, mark-applied.
    await expect(page.locator("#result")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#build-line")).toContainText("one page");
    await expect(page.locator("#draft-line")).toBeHidden();
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

test("pill-open handoff prefills from stash when the tab URL is hidden", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    const jobUrl = `${site.url}/e2e/fixture-job.html`;
    await page.addInitScript(
      ({
        serverUrl,
        serverRoot,
        stash,
      }: {
        serverUrl: string;
        serverRoot: string;
        stash: { url: string; title: string; description: string; at: number };
      }) => {
        const store: Record<string, unknown> = { server: serverUrl, serverRoot };
        const sessionStore: Record<string, unknown> = { pendingPosting: stash };
        const removedKeys: string[][] = [];
        const tabMessages: unknown[] = [];
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
            session: {
              get: (keys: string[]): Promise<Record<string, unknown>> =>
                Promise.resolve(Object.fromEntries(keys.map((k) => [k, sessionStore[k]]))),
              set: (obj: Record<string, unknown>): Promise<void> => {
                Object.assign(sessionStore, obj);
                return Promise.resolve();
              },
              remove: (keys: string[]): Promise<void> => {
                removedKeys.push(keys);
                for (const k of keys) delete sessionStore[k];
                return Promise.resolve();
              },
            },
          },
          tabs: {
            // No url: programmatic openPopup grants no activeTab.
            query: (): Promise<{ id: number }[]> => Promise.resolve([{ id: 7 }]),
            sendMessage: (...args: unknown[]): Promise<unknown> => {
              tabMessages.push(args[1]);
              return Promise.resolve({ ok: false });
            },
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        const w = window as unknown as {
          chrome?: unknown;
          __jatRemoved?: string[][];
          __jatTabMessages?: unknown[];
        };
        w.chrome = fakeChrome;
        w.__jatRemoved = removedKeys;
        w.__jatTabMessages = tabMessages;
      },
      {
        serverUrl: capture.url,
        serverRoot: dir,
        stash: { url: jobUrl, title: "Backend Engineer", description: JD, at: Date.now() },
      },
    );

    await page.goto(`${site.url}/popup.html`);
    // The form is prefilled from the stash — never the empty state —
    // and the live tab read is never attempted.
    await expect(page.locator("#capture-form")).toBeVisible();
    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(page.locator("#role")).toHaveValue("Backend Engineer");
    await expect(page.locator("#description")).toHaveValue(JD);
    const removed = await page.evaluate(
      () => (window as unknown as { __jatRemoved?: string[][] }).__jatRemoved ?? [],
    );
    expect(removed).toEqual([["pendingPosting"]]);
    const tabMessages = await page.evaluate(
      () => (window as unknown as { __jatTabMessages?: unknown[] }).__jatTabMessages ?? [],
    );
    expect(tabMessages).toEqual([]);

    // The stashed posting saves end to end under the stashed URL.
    await page.locator("#company").fill("Acme");
    await page.locator("#save").click();
    await expect(page.locator("#result")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#build-line")).toContainText("one page");
    const apps = await readdir(path.join(dir, "applications"));
    expect(apps).toHaveLength(1);
    const jobMd = await readFile(path.join(dir, "applications", apps[0], "job.md"), "utf8");
    // addApplication stores the canonical URL (https, no tracking params).
    expect(jobMd).toContain("/e2e/fixture-job.html");
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

test("tracked posting reopens in saved state, not the form", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    await page.addInitScript(
      ({
        jobUrl,
        serverUrl,
        serverRoot,
        description,
      }: {
        jobUrl: string;
        serverUrl: string;
        serverRoot: string;
        description: string;
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
              Promise.resolve({
                ok: true,
                posting: { title: "Backend Engineer", description },
              }),
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      {
        jobUrl: `${site.url}/e2e/fixture-job.html`,
        serverUrl: capture.url,
        serverRoot: dir,
        description: JD,
      },
    );

    await page.goto(`${site.url}/popup.html`);
    await page.locator("#company").fill("Acme");
    await page.locator("#save").click();
    await expect(page.locator("#result")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#build-line")).toContainText("one page");

    // Same URL, same text: the form gives way to the saved state.
    await page.reload();
    await expect(page.locator("#result")).toBeVisible();
    await expect(page.locator("#result-title")).toContainText("Already saved");
    await expect(page.locator("#capture-form")).toBeHidden();
    await expect(page.locator("#empty-state")).toBeHidden();
    await expect(page.locator("#build-line")).toBeHidden();
    await expect(page.locator("#draft-line")).toBeHidden();
    await expect(page.locator("#open-saved")).toHaveAttribute(
      "href",
      /vscode:\/\/file.*applications\//,
    );
    await expect(page.locator("#mark-applied")).toBeEnabled();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

test("changed text at a tracked URL keeps the form with a notice", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    const jobUrl = `${site.url}/e2e/fixture-job.html`;
    // Seed an earlier application at this URL with different text.
    const seed = await fetch(`${capture.url}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: jobUrl,
        company: "Acme",
        role: "Backend Engineer",
        track: "swe",
        region: "ca",
        description: "An older posting for the same rolling-intake URL. ".repeat(10),
      }),
    });
    expect(seed.ok).toBe(true);

    await page.addInitScript(
      ({
        jobUrl: url,
        serverUrl,
        serverRoot,
        description,
      }: {
        jobUrl: string;
        serverUrl: string;
        serverRoot: string;
        description: string;
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
              Promise.resolve([{ id: 7, url }]),
            sendMessage: (): Promise<unknown> =>
              Promise.resolve({
                ok: true,
                posting: { title: "Backend Engineer", description },
              }),
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      {
        jobUrl,
        serverUrl: capture.url,
        serverRoot: dir,
        description: JD,
      },
    );

    await page.goto(`${site.url}/popup.html`);
    await expect(page.locator("#capture-form")).toBeVisible();
    await expect(page.locator("#recycled-note")).toBeVisible();
    await expect(page.locator("#recycled-note")).toContainText("looks like a new posting");
    // The old folder is not this posting: marking waits for the new save.
    await expect(page.locator("#mark-applied")).toBeDisabled();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

test("saving over a different posting shows its saved state, mark off", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    const jobUrl = `${site.url}/e2e/fixture-job.html`;
    // Same slug, different text: the classic recycled-URL collision.
    const seed = await fetch(`${capture.url}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: jobUrl,
        company: "Acme",
        role: "Backend Engineer",
        track: "swe",
        region: "ca",
        description: "An older posting for the same rolling-intake URL. ".repeat(10),
      }),
    });
    expect(seed.ok).toBe(true);

    await page.addInitScript(
      ({
        jobUrl: url,
        serverUrl,
        serverRoot,
        description,
      }: {
        jobUrl: string;
        serverUrl: string;
        serverRoot: string;
        description: string;
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
              Promise.resolve([{ id: 7, url }]),
            sendMessage: (): Promise<unknown> =>
              Promise.resolve({
                ok: true,
                posting: { title: "Backend Engineer", description },
              }),
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      {
        jobUrl,
        serverUrl: capture.url,
        serverRoot: dir,
        description: JD,
      },
    );

    await page.goto(`${site.url}/popup.html`);
    await expect(page.locator("#recycled-note")).toBeVisible();
    await page.locator("#company").fill("Acme");
    await page.locator("#save").click();

    // Collision, not an error dump: no form, no save, mark stays off —
    // the folder is a different posting.
    await expect(page.locator("#result-title")).toContainText("Already saved");
    await expect(page.locator("#capture-form")).toBeHidden();
    await expect(page.locator("#mark-applied")).toBeDisabled();
    await expect(page.locator("#status")).toBeHidden();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});

test("saving over the same posting shows its saved state, mark on", async ({ page }) => {
  const { dir, cleanup } = await mkFixtureRepo();
  const capture = await startCaptureServer(dir);
  const site = await startStatic(pkgDir);
  try {
    const jobUrl = `${site.url}/e2e/fixture-job.html`;
    await page.addInitScript(
      ({
        jobUrl: url,
        serverUrl,
        serverRoot,
        description,
      }: {
        jobUrl: string;
        serverUrl: string;
        serverRoot: string;
        description: string;
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
              Promise.resolve([{ id: 7, url }]),
            sendMessage: (): Promise<unknown> =>
              Promise.resolve({
                ok: true,
                posting: { title: "Backend Engineer", description },
              }),
          },
          runtime: {
            sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
          },
        };
        (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
      },
      {
        jobUrl,
        serverUrl: capture.url,
        serverRoot: dir,
        description: JD,
      },
    );

    // Stale form: untracked at prefill, saved elsewhere before the click.
    await page.goto(`${site.url}/popup.html`);
    await expect(page.locator("#capture-form")).toBeVisible();
    await page.locator("#company").fill("Acme");
    const seed = await fetch(`${capture.url}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: jobUrl,
        company: "Acme",
        role: "Backend Engineer",
        track: "swe",
        region: "ca",
        description: JD,
      }),
    });
    expect(seed.ok).toBe(true);
    await page.locator("#save").click();

    // Same posting, so Mark applied is safe to offer.
    await expect(page.locator("#result-title")).toContainText("Already saved");
    await expect(page.locator("#capture-form")).toBeHidden();
    await expect(page.locator("#mark-applied")).toBeEnabled();
  } finally {
    site.close();
    capture.stop();
    await cleanup();
  }
});
