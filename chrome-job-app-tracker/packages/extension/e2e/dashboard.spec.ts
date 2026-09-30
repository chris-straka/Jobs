import { expect, test } from "@playwright/test";
import { pkgDir, startStatic } from "./helpers.js";

test("dashboard lists, adds, and removes false-positive hosts", async ({ page }) => {
  await page.addInitScript(() => {
    const store: Record<string, unknown> = {
      // Dead port: the dashboard must never touch an ambient real server.
      server: "http://127.0.0.1:1",
      // Retired split keys: the dashboard unions and migrates them.
      fpReported: ["reported.example.com"],
      fpHosts: ["example.com", "jobs.example.org"],
    };
    const listeners: ((changes: unknown, area: string) => void)[] = [];
    const fakeChrome = {
      storage: {
        local: {
          get: (keys: string[]): Promise<Record<string, unknown>> =>
            Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj: Record<string, unknown>): Promise<void> => {
            Object.assign(store, obj);
            for (const l of listeners) l(obj, "local");
            return Promise.resolve();
          },
          remove: (keys: string[]): Promise<void> => {
            for (const k of keys) delete store[k];
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: (l: (changes: unknown, area: string) => void): void => {
            listeners.push(l);
          },
        },
      },
    };
    const w = window as unknown as { chrome?: unknown; __jatStore?: Record<string, unknown> };
    w.chrome = fakeChrome;
    w.__jatStore = store;
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/dashboard.html`);
    // Legacy split keys show unioned under the one list, then migrate away.
    await expect(page.locator("#fp-list li")).toHaveCount(3);
    await expect(page.locator("#fp-count")).toHaveText("3");
    const afterMigrate = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterMigrate["falsePositives"]).toEqual([
      "example.com",
      "jobs.example.org",
      "reported.example.com",
    ]);
    expect(afterMigrate["fpReported"]).toBeUndefined();
    expect(afterMigrate["fpHosts"]).toBeUndefined();

    // Remove drops the row and the stored host.
    await page.locator('#fp-list li:has(span:text-is("example.com")) button').click();
    await expect(page.locator("#fp-list li")).toHaveCount(2);
    const afterRm = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterRm["falsePositives"]).toEqual(["jobs.example.org", "reported.example.com"]);

    // The URL input adds host+path, scoped to that subtree.
    await page.locator("#add-url").fill("https://jobs.example.com/post/123?utm_source=x");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#fp-list li")).toHaveCount(3);
    await expect(page.locator("#fp-count")).toHaveText("3");
    await expect(page.locator("#fp-list")).toContainText("jobs.example.com/post/123");

    // The host input normalizes and stores a bare host.
    await page.locator("#add-host").fill("  New-Site.com ");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#fp-list li")).toHaveCount(4);
    const afterAdd = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterAdd["falsePositives"]).toContain("new-site.com");

    // Duplicates don't double-add; garbage and empty submits show an error.
    await page.locator("#add-host").fill("new-site.com");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#fp-list li")).toHaveCount(4);
    await page.locator("#add-url").fill("not a url!!");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#form-error")).toBeVisible();
    await expect(page.locator("#fp-list li")).toHaveCount(4);
    await page.locator("#add-url").fill("");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#form-error")).toBeVisible();
    await expect(page.locator("#fp-list li")).toHaveCount(4);
  } finally {
    site.close();
  }
});

test("dashboard adds and removes ineligible posting URLs", async ({ page }) => {
  await page.addInitScript(() => {
    const store: Record<string, unknown> = {
      // Dead port: the dashboard must never touch an ambient real server.
      server: "http://127.0.0.1:1",
    };
    const listeners: ((changes: unknown, area: string) => void)[] = [];
    const fakeChrome = {
      storage: {
        local: {
          get: (keys: string[]): Promise<Record<string, unknown>> =>
            Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj: Record<string, unknown>): Promise<void> => {
            Object.assign(store, obj);
            for (const l of listeners) l(obj, "local");
            return Promise.resolve();
          },
          remove: (keys: string[]): Promise<void> => {
            for (const k of keys) delete store[k];
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: (l: (changes: unknown, area: string) => void): void => {
            listeners.push(l);
          },
        },
      },
    };
    const w = window as unknown as { chrome?: unknown; __jatStore?: Record<string, unknown> };
    w.chrome = fakeChrome;
    w.__jatStore = store;
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/dashboard.html`);
    await expect(page.locator("#in-list li")).toHaveCount(0);
    await expect(page.locator("#in-empty")).toBeVisible();

    // The URL input canonicalizes before storing.
    await page.locator("#in-url").fill("https://www.example.com/jobs/1?utm_source=x");
    await page.locator("#in-form button[type='submit']").click();
    await expect(page.locator("#in-list li")).toHaveCount(1);
    await expect(page.locator("#in-count")).toHaveText("1");
    await expect(page.locator("#in-list")).toContainText("https://example.com/jobs/1");
    const afterAdd = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterAdd["ineligibleUrls"]).toEqual(["https://example.com/jobs/1"]);

    // Duplicates don't double-add; garbage and empty submits show an error.
    await page.locator("#in-url").fill("https://example.com/jobs/1");
    await page.locator("#in-form button[type='submit']").click();
    await expect(page.locator("#in-list li")).toHaveCount(1);
    await page.locator("#in-url").fill("not a url!!");
    await page.locator("#in-form button[type='submit']").click();
    await expect(page.locator("#in-error")).toBeVisible();
    await expect(page.locator("#in-list li")).toHaveCount(1);
    await page.locator("#in-url").fill("");
    await page.locator("#in-form button[type='submit']").click();
    await expect(page.locator("#in-error")).toBeVisible();
    await expect(page.locator("#in-list li")).toHaveCount(1);

    // Remove drops the row and the stored URL.
    await page.locator("#in-list li button").click();
    await expect(page.locator("#in-list li")).toHaveCount(0);
    await expect(page.locator("#in-empty")).toBeVisible();
    const afterRm = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterRm["ineligibleUrls"]).toEqual([]);
  } finally {
    site.close();
  }
});

test("remove reaches the file and stays removed with a live server", async ({ page }) => {
  await page.addInitScript(() => {
    const store: Record<string, unknown> = { falsePositives: ["example.com"] };
    // In-memory stand-in for /api/ignore on a live server.
    const box: { file: unknown } = { file: { falsePositives: ["example.com"] } };
    const listeners: ((changes: unknown, area: string) => void)[] = [];
    const fakeChrome = {
      storage: {
        local: {
          get: (keys: string[]): Promise<Record<string, unknown>> =>
            Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj: Record<string, unknown>): Promise<void> => {
            Object.assign(store, obj);
            for (const l of listeners) l(obj, "local");
            return Promise.resolve();
          },
          remove: (keys: string[]): Promise<void> => {
            for (const k of keys) delete store[k];
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: (l: (changes: unknown, area: string) => void): void => {
            listeners.push(l);
          },
        },
      },
    };
    const w = window as unknown as {
      chrome?: unknown;
      fetch?: unknown;
      __jatStore?: Record<string, unknown>;
      __jatBox?: { file: unknown };
    };
    w.chrome = fakeChrome;
    w.__jatStore = store;
    w.__jatBox = box;
    w.fetch = async (url: unknown, init?: { method?: string; body?: string }): Promise<unknown> => {
      if (!String(url).includes("/api/ignore")) throw new Error("offline");
      if (init?.method === "POST") box.file = JSON.parse(String(init.body));
      return { ok: true, json: async () => box.file };
    };
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/dashboard.html`);
    await expect(page.locator("#fp-list li")).toHaveCount(1);
    await page.locator('#fp-list li:has(span:text-is("example.com")) button').click();
    // The row stays gone: re-healing from the file must not resurrect it.
    await expect(page.locator("#fp-list li")).toHaveCount(0);
    await expect(page.locator("#fp-empty")).toBeVisible();
    const state = await page.evaluate(() => {
      const w = window as unknown as {
        __jatStore?: Record<string, unknown>;
        __jatBox?: { file: unknown };
      };
      return { store: w.__jatStore ?? {}, file: w.__jatBox?.file };
    });
    expect(state.store["falsePositives"]).toEqual([]);
    expect(state.file).toEqual({ falsePositives: [] });
    await expect(page.locator("#fp-list li")).toHaveCount(0);
  } finally {
    site.close();
  }
});

test("popup opens the dashboard in a new tab", async ({ page }) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    const fakeChrome = {
      storage: {
        local: {
          get: (): Promise<Record<string, unknown>> => Promise.resolve({}),
          set: (): Promise<void> => Promise.resolve(),
        },
      },
      tabs: {
        query: (): Promise<unknown[]> => Promise.resolve([]),
        create: (opts: { url: string }): Promise<unknown> => {
          opened.push(opts.url);
          return Promise.resolve({ id: 9 });
        },
      },
      runtime: {
        getURL: (p: string): string => `/dashboard/${p}`,
        sendNativeMessage: (): Promise<unknown> => Promise.reject(new Error("no such host")),
      },
    };
    const w = window as unknown as { chrome?: unknown; __jatOpened?: string[] };
    w.chrome = fakeChrome;
    w.__jatOpened = opened;
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/popup.html`);
    await page.locator("#open-dashboard").click();
    const opened = await page.evaluate(
      () => (window as unknown as { __jatOpened?: string[] }).__jatOpened ?? [],
    );
    expect(opened).toEqual(["/dashboard/dashboard.html"]);
  } finally {
    site.close();
  }
});
