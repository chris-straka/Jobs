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
const FEED_URL = "https://www.linkedin.com/feed/";
const JOBS_URL = "https://www.linkedin.com/jobs/search/";

/**
 * Serves the LinkedIn fixture under a real linkedin.com hostname (route
 * fulfillment — no network) with a fake chrome API, then injects the real
 * early (document_start) bundle.
 */
async function bootLinkedIn(
  page: Page,
  url: string = PROFILE_URL,
  initial: Record<string, unknown> = {},
): Promise<void> {
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
  await page.route(url, (route) => route.fulfill({ status: 200, contentType: "text/html", body }));
  await page.goto(url);
  await page.addScriptTag({ path: path.join(pkgDir, "dist", "linkedin-early.js") });
}

async function fireStorage(
  page: Page,
  changes: Record<string, { newValue?: unknown }>,
): Promise<void> {
  await page.evaluate((c) => window.__jatFireStorage?.(c), changes);
}

const DISCOVERY = ["#pav", "#pymk", "#mpf", "#yml", "#atf"];
const PREMIUM = ["#prem", "#prem2"];
const NAVGONE = ["#nav-home", "#nav-network", "#nav-biz"];
const ADS = ["#adrail", "#feedad"];

const ALL_ON = {
  peopleAlsoViewed: true,
  peopleYouMayKnow: true,
  youMightLike: true,
  followSuggestions: true,
  premiumUpsell: true,
  loadingSkeletons: true,
  navHome: true,
  navNetwork: true,
  navBusiness: true,
  linkedinNews: true,
  promotedAds: true,
  homeFeed: true,
};

const ALL_OFF = {
  peopleAlsoViewed: false,
  peopleYouMayKnow: false,
  youMightLike: false,
  followSuggestions: false,
  premiumUpsell: false,
  loadingSkeletons: false,
  navHome: false,
  navNetwork: false,
  navBusiness: false,
  linkedinNews: false,
  promotedAds: false,
  homeFeed: false,
};

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
  // Premium cards hide via CTA link or views pitch.
  for (const sel of PREMIUM) {
    await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator(sel)).toHaveAttribute("data-jat-linkedin-clean", "premiumUpsell");
  }
  // Nav items hide one by one — the header, nav, and list itself survive,
  // and Jobs stays for the jobs-only workflow.
  await expect(page.locator("#nav-home")).toHaveAttribute("data-jat-linkedin-clean", "navHome");
  await expect(page.locator("#nav-network")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "navNetwork",
  );
  await expect(page.locator("#nav-biz")).toHaveAttribute("data-jat-linkedin-clean", "navBusiness");
  for (const sel of NAVGONE) {
    await expect(page.locator(sel)).toBeHidden();
  }
  await expect(page.locator("#nav-premium")).toBeHidden();
  await expect(page.locator("#nav-premium")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "premiumUpsell",
  );
  await expect(page.locator("#topnav")).toBeVisible();
  await expect(page.locator("#nav-jobs")).toBeVisible();
  expect(await page.locator("#topnav").getAttribute("data-jat-linkedin-clean")).toBeNull();
  // News and Promoted ads hide; the main column stays (not a feed path).
  await expect(page.locator("#news")).toBeHidden();
  await expect(page.locator("#news")).toHaveAttribute("data-jat-linkedin-clean", "linkedinNews");
  for (const sel of ADS) {
    await expect(page.locator(sel)).toBeHidden();
    await expect(page.locator(sel)).toHaveAttribute("data-jat-linkedin-clean", "promotedAds");
  }
  await expect(page.locator("#main")).toBeVisible();
  // Skeletons hide while skeletal.
  await expect(page.locator("#skel-static")).toBeHidden();
  await expect(page.locator("#skel-static")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "loadingSkeletons",
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

  await fireStorage(page, { linkedinClean: { newValue: ALL_OFF } });
  for (const sel of [...DISCOVERY, ...PREMIUM, ...NAVGONE, ...ADS, "#skel-static"]) {
    await expect(page.locator(sel)).toBeVisible();
  }

  await fireStorage(page, { linkedinClean: { newValue: ALL_ON } });
  for (const sel of [...DISCOVERY, ...PREMIUM, ...NAVGONE, ...ADS, "#skel-static"]) {
    await expect(page.locator(sel)).toBeHidden();
  }
});

test("skeletons release when content arrives", async ({ page }) => {
  await bootLinkedIn(page);
  await expect(page.locator("#skel-legit")).toBeHidden();
  await expect(page.locator("#skel-disc")).toBeHidden();

  // Same-node replacement: the skeleton becomes a legit card.
  await page.evaluate(() => {
    const legit = document.getElementById("skel-legit");
    if (legit) {
      legit.className = "";
      legit.innerHTML = "<h2>Profile language</h2><p>English</p>";
    }
  });
  await expect(page.locator("#skel-legit")).toBeVisible();
  expect(await page.locator("#skel-legit").getAttribute("data-jat-linkedin-clean")).toBeNull();

  // Same-node replacement into discovery: released, then re-hidden as
  // the real module — the skeleton mark gives way to the module's.
  await page.evaluate(() => {
    const disc = document.getElementById("skel-disc");
    if (disc) {
      disc.removeAttribute("aria-busy");
      disc.innerHTML =
        '<h2>People also viewed</h2><ul><li><a href="/in/late">Late Ada</a></li></ul>';
    }
  });
  await expect(page.locator("#skel-disc")).toBeHidden();
  await expect(page.locator("#skel-disc")).toHaveAttribute(
    "data-jat-linkedin-clean",
    "peopleAlsoViewed",
  );
});

test("linkedin declutter respects stored offs at boot", async ({ page }) => {
  await bootLinkedIn(page, PROFILE_URL, {
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

test("home feed column hides only on feed paths", async ({ page }) => {
  await bootLinkedIn(page, FEED_URL);

  await expect(page.locator("#main")).toBeHidden();
  await expect(page.locator("#main")).toHaveAttribute("data-jat-linkedin-clean", "homeFeed");
  // Rails survive eradication: only the feed column goes.
  await expect(page.locator("#rail")).toBeVisible();
  await expect(page.locator("#topnav")).toBeVisible();
});

test("promoted ads stay on jobs pages, where the label marks listings", async ({ page }) => {
  await bootLinkedIn(page, JOBS_URL);

  for (const sel of ADS) {
    await expect(page.locator(sel)).toBeVisible();
    expect(await page.locator(sel).getAttribute("data-jat-linkedin-clean")).toBeNull();
  }
  // Other groups still apply there.
  await expect(page.locator("#pav")).toBeHidden();
  await expect(page.locator("#news")).toBeHidden();
  await expect(page.locator("#main")).toBeVisible();
});
