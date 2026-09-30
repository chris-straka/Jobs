import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pkgDir } from "./helpers.js";

type StorageListener = (changes: Record<string, { newValue?: unknown }>) => void;

declare global {
  interface Window {
    __jatFireStorage?: (changes: Record<string, { newValue?: unknown }>) => void;
  }
}

const PROFILE_URL = "https://www.linkedin.com/in/ada-lovelace";

/**
 * Serves the LinkedIn fixture under a real linkedin.com hostname (route
 * fulfillment — no network) with a fake chrome API, then injects the real
 * content bundle.
 */
async function bootLinkedIn(page: Page, initial: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((stored: Record<string, unknown>) => {
    const listeners: StorageListener[] = [];
    const store: Record<string, unknown> = { ...stored };
    const fakeChrome = {
      runtime: {
        id: "jat-e2e",
        onMessage: { addListener: (): void => {} },
        sendMessage: (): Promise<unknown> => Promise.resolve({ ok: true }),
      },
      storage: {
        local: {
          get: (keys: string[]): Promise<Record<string, unknown>> =>
            Promise.resolve(Object.fromEntries(keys.map((k) => [k, store[k]]))),
          set: (obj: Record<string, unknown>): Promise<void> => {
            Object.assign(store, obj);
            return Promise.resolve();
          },
        },
        onChanged: {
          addListener: (fn: StorageListener): void => {
            listeners.push(fn);
          },
          removeListener: (fn: StorageListener): void => {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
          },
        },
      },
    };
    const w = window as unknown as { chrome?: unknown };
    w.chrome = fakeChrome;
    window.__jatFireStorage = (changes) => {
      for (const fn of listeners) fn(changes);
    };
  }, initial);
  const body = await readFile(path.join(pkgDir, "e2e", "fixture-linkedin.html"), "utf8");
  await page.route("**/favicon.ico", (route) => route.abort());
  await page.route(PROFILE_URL, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body }),
  );
  await page.goto(PROFILE_URL);
  await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });
}

async function fireStorage(
  page: Page,
  changes: Record<string, { newValue?: unknown }>,
): Promise<void> {
  await page.evaluate((c) => window.__jatFireStorage?.(c), changes);
}

const DISCOVERY = ["#pav", "#pymk", "#mpf", "#yml", "#atf"];

test("linkedin declutter hides discovery modules, keeps real content", async ({ page }) => {
  await bootLinkedIn(page);

  for (const sel of DISCOVERY) {
    await expect(page.locator(sel)).toBeHidden();
  }
  // The rail itself survives: cards hide one by one, never the container.
  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#rail-card")).toBeVisible();
  expect(await page.locator("#rail").getAttribute("data-jat-linkedin-clean")).toBeNull();
  await expect(page.locator("#exp")).toBeVisible();
  await expect(page.locator("#about")).toBeVisible();
  // Each card is marked with its group for targeted restores.
  await expect(page.locator("#pav")).toHaveAttribute("data-jat-linkedin-clean", "peopleAlsoViewed");
  await expect(page.locator("#pymk")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "peopleYouMayKnow",
  );
  await expect(page.locator("#atf")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "followSuggestions",
  );
});

test("linkedin declutter catches late SPA inserts", async ({ page }) => {
  await bootLinkedIn(page);
  await expect(page.locator("#pav")).toBeHidden();

  await page.evaluate(() => {
    const rail = document.getElementById("rail");
    const late = document.createElement("section");
    late.id = "late";
    const h = document.createElement("h2");
    h.textContent = "People also viewed";
    const ul = document.createElement("ul");
    ul.innerHTML = '<li><a href="/in/late">Late Ada</a></li>';
    late.append(h, ul);
    rail?.append(late);
  });
  await expect(page.locator("#late")).toBeHidden();
});

test("linkedin toggles restore and re-hide live", async ({ page }) => {
  await bootLinkedIn(page);
  await expect(page.locator("#pav")).toBeHidden();

  await fireStorage(page, {
    linkedinClean: {
      newValue: {
        peopleAlsoViewed: false,
        peopleYouMayKnow: false,
        youMightLike: false,
        followSuggestions: false,
      },
    },
  });
  for (const sel of DISCOVERY) {
    await expect(page.locator(sel)).toBeVisible();
  }

  await fireStorage(page, {
    linkedinClean: {
      newValue: {
        peopleAlsoViewed: true,
        peopleYouMayKnow: true,
        youMightLike: true,
        followSuggestions: true,
      },
    },
  });
  for (const sel of DISCOVERY) {
    await expect(page.locator(sel)).toBeHidden();
  }
});

test("linkedin declutter respects stored offs at boot", async ({ page }) => {
  await bootLinkedIn(page, {
    linkedinClean: {
      peopleAlsoViewed: true,
      peopleYouMayKnow: false,
      youMightLike: true,
      followSuggestions: true,
    },
  });

  await expect(page.locator("#pav")).toBeHidden();
  await expect(page.locator("#pymk")).toBeVisible();
  await expect(page.locator("#yml")).toBeHidden();
  await expect(page.locator("#atf")).toBeHidden();
});
