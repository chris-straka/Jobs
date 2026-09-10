import { expect, test } from "@playwright/test";
import { pkgDir, startStatic } from "./helpers.js";

test("dashboard lists, adds, and removes ignored hosts", async ({ page }) => {
  await page.addInitScript(() => {
    const store: Record<string, unknown> = {
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
    await expect(page.locator("#fp-list li")).toHaveCount(1);
    await expect(page.locator("#fp-count")).toHaveText("1");
    await expect(page.locator("#dash-list li")).toHaveCount(2);
    await expect(page.locator("#dash-count")).toHaveText("2");

    // Removing a false positive updates its own key.
    await page.locator("#fp-list li", { hasText: "reported.example.com" }).locator("button").click();
    await expect(page.locator("#fp-list li")).toHaveCount(0);
    await expect(page.locator("#fp-empty")).toBeVisible();

    // Remove drops the row and the stored host.
    await page.locator("#dash-list li", { hasText: "example.com" }).locator("button").click();
    await expect(page.locator("#dash-list li")).toHaveCount(1);
    const afterRm = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterRm["fpHosts"]).toEqual(["jobs.example.org"]);

    // Add normalizes and stores a new host.
    await page.locator("#add-host").fill("  New-Site.com ");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#dash-list li")).toHaveCount(2);
    await expect(page.locator("#dash-count")).toHaveText("2");
    const afterAdd = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterAdd["fpHosts"]).toContain("new-site.com");

    // Duplicates don't double-add; garbage is rejected with an error.
    await page.locator("#add-host").fill("new-site.com");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#dash-list li")).toHaveCount(2);
    await page.locator("#add-host").fill("not a host!!");
    await page.locator("#add-form button[type='submit']").click();
    await expect(page.locator("#form-error")).toBeVisible();
    await expect(page.locator("#dash-list li")).toHaveCount(2);
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
