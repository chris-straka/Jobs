import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { pkgDir, startStatic } from "./helpers.js";

type Respond = (response: unknown) => void;
type MessageListener = (msg: { type?: string }, sender: unknown, respond: Respond) => void;
interface FakeWindow {
  __jatListener?: MessageListener;
}

interface PostingResponse {
  ok?: boolean;
  posting?: { title?: string; url?: string; description?: string };
}

test("content script extracts the posting from the real bundle", async ({ page }) => {
  await page.addInitScript(() => {
    const listeners: MessageListener[] = [];
    const store: Record<string, unknown> = {};
    const messages: string[] = [];
    // Stands in for background.ts: FP reports land in falsePositives.
    const fakeBackground = (msg: { type?: string; host?: string }): unknown => {
      messages.push(msg?.type ?? "");
      if (msg?.type === "JAT_FP_REPORT" && msg.host) {
        const hosts = Array.isArray(store["falsePositives"]) ? store["falsePositives"] : [];
        if (!(hosts as string[]).includes(msg.host)) {
          store["falsePositives"] = [...(hosts as string[]), msg.host];
        }
      }
      if (msg?.type === "JAT_FP_UNREPORT" && msg.host) {
        const hosts = Array.isArray(store["falsePositives"]) ? store["falsePositives"] : [];
        store["falsePositives"] = (hosts as string[]).filter((h) => h !== msg.host);
      }
      return { ok: true };
    };
    const fakeChrome = {
      runtime: {
        onMessage: {
          addListener: (fn: MessageListener): void => {
            listeners.push(fn);
          },
        },
        sendMessage: (msg: { type?: string; host?: string }): Promise<unknown> =>
          Promise.resolve(fakeBackground(msg)),
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
      },
    };
    const w = window as unknown as { chrome?: unknown } & FakeWindow & {
        __jatListeners?: MessageListener[];
        __jatStore?: Record<string, unknown>;
        __jatMessages?: string[];
      };
    w.chrome = fakeChrome;
    w.__jatListeners = listeners;
    w.__jatStore = store;
    w.__jatMessages = messages;
  });

  const site = await startStatic(pkgDir);
  try {
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    const result = (await page.evaluate(
      () =>
        new Promise<unknown>((resolve) => {
          const w = window as unknown as FakeWindow & { __jatListeners?: MessageListener[] };
          const listener = w.__jatListeners?.[0] ?? w.__jatListener;
          if (!listener) throw new Error("content script registered no listener");
          listener({ type: "JAT_GET_POSTING" }, {}, resolve);
        }),
    )) as PostingResponse;

    expect(result.ok).toBe(true);
    expect(result.posting?.title).toContain("Senior Backend Engineer");
    // Article-only word: proves it picked the posting, not nav/footer.
    expect(result.posting?.description).toContain("exactly-once");
    expect(result.posting?.description?.length).toBeGreaterThan(500);
    // Nav, footer, button, and div-soup chrome are scrubbed from the description.
    expect(result.posting?.description).not.toContain("boilerplate");
    expect(result.posting?.description).not.toContain("Apply now");
    expect(result.posting?.description).not.toContain("soup");
    // Invisible ink never reaches the description, in any hiding —
    // including inside the winning candidate itself.
    expect(result.posting?.description).not.toContain("HIDDEN-DIV-INJECTION");
    expect(result.posting?.description).not.toContain("HIDDEN-ATTR-INJECTION");
    expect(result.posting?.description).not.toContain("OFFSCREEN-INJECTION");
    expect(result.posting?.description).not.toContain("HIDDEN-ARTICLE-INJECTION");
    // Sub-legible type is unreadable ink; the zero-size wrapper's sized
    // child is real text and survives.
    expect(result.posting?.description).not.toContain("TINY-FONT-INJECTION");
    expect(result.posting?.description).toContain("ZERO-SIZE-WRAPPER-KEPT");

    // Pill is three buttons and nothing else.
    await expect(page.locator("#jat-pill button[data-act='open']")).toHaveText("Open");
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveText("False positive");
    await expect(page.locator("#jat-pill")).not.toContainText("Save this job?");

    // "False positive" swaps the pill for a mute confirm and records this host.
    await page.locator("#jat-pill button[data-act='no']").click();
    await expect(page.locator("#jat-pill")).toContainText("Added to the");
    await expect(page.locator("#jat-pill button[data-act='undo']")).toBeVisible();
    const store = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(store["falsePositives"]).toContain("127.0.0.1");
    // "List" opens the Manage page without dismissing the confirm.
    await page.locator("#jat-pill a[data-act='dash']").click();
    expect(await messages(page)).toContain("JAT_OPEN_DASHBOARD");
    await expect(page.locator("#jat-pill")).toContainText("Added to the");
    // Undo puts the pill back and un-records the host.
    await page.locator("#jat-pill button[data-act='undo']").click();
    await expect(page.locator("#jat-pill button[data-act='open']")).toHaveText("Open");
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveText("False positive");
    const afterUndo = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(afterUndo["falsePositives"] ?? []).not.toContain("127.0.0.1");
    // Reporting again re-arms the confirm, which dismisses itself: the
    // toast is a receipt, not a workspace.
    await page.locator("#jat-pill button[data-act='no']").click();
    await expect(page.locator("#jat-pill")).toContainText("Added to the");
    await expect(page.locator("#jat-pill")).toBeHidden({ timeout: 15000 });
  } finally {
    site.close();
  }
});

/** Fake background that answers pill state and records every message. */
async function bootPill(
  page: Page,
  pillState: { tracked: boolean; applied: boolean },
  fpResponse: unknown = { ok: true },
): Promise<void> {
  await page.addInitScript(
    ({ state, fp }: { state: { tracked: boolean; applied: boolean }; fp: unknown }) => {
      const listeners: MessageListener[] = [];
      const messages: string[] = [];
      let lastOpen: unknown = null;
      const fakeChrome = {
        runtime: {
          onMessage: {
            addListener: (fn: MessageListener): void => {
              listeners.push(fn);
            },
          },
          sendMessage: (msg: { type?: string }): Promise<unknown> => {
            messages.push(msg?.type ?? "");
            if (msg?.type === "JAT_PILL_STATE") return Promise.resolve(state);
            if (msg?.type === "JAT_MARK_APPLIED") return Promise.resolve({ ok: true });
            if (msg?.type === "JAT_FP_REPORT") return Promise.resolve(fp);
            if (msg?.type === "JAT_OPEN") {
              lastOpen = msg;
              return Promise.resolve({ ok: true, via: "popup" });
            }
            return Promise.resolve({ ok: true });
          },
        },
        storage: {
          local: {
            get: (): Promise<Record<string, unknown>> => Promise.resolve({}),
            set: (): Promise<void> => Promise.resolve(),
          },
        },
      };
      const w = window as unknown as { chrome?: unknown } & {
        __jatMessages?: string[];
        __jatLastOpen?: unknown;
      };
      w.chrome = fakeChrome;
      w.__jatMessages = messages;
      Object.defineProperty(w, "__jatLastOpen", { get: () => lastOpen, configurable: true });
    },
    { state: pillState, fp: fpResponse },
  );
}

async function messages(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __jatMessages?: string[] }).__jatMessages ?? [],
  );
}

test("tracked draft pill swaps false-positive for mark applied", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: true, applied: false });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    await expect(page.locator("#jat-pill button[data-act='open']")).toHaveText("Open");
    await expect(page.locator("#jat-pill button[data-act='mark']")).toHaveText("Mark applied ✓");
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveCount(0);

    // Mark applied confirms through the background resolve.
    await page.locator("#jat-pill button[data-act='mark']").click();
    await expect(page.locator("#jat-pill")).toContainText("Marked applied ✓");
    expect(await messages(page)).toContain("JAT_MARK_APPLIED");

    // Open routes through the background but leaves the pill up.
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });
    await page.locator("#jat-pill button[data-act='open']").click();
    await expect(page.locator("#jat-pill button[data-act='mark']")).toBeVisible();
    expect(await messages(page)).toContain("JAT_OPEN");
  } finally {
    site.close();
  }
});

test("tracked applied pill shows only open and dismiss", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: true, applied: true });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    await expect(page.locator("#jat-pill button[data-act='open']")).toHaveText("Open");
    await expect(page.locator("#jat-pill button")).toHaveCount(2);
    await expect(page.locator("#jat-pill button[data-act='mark']")).toHaveCount(0);
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveCount(0);
  } finally {
    site.close();
  }
});

test("apply click on an untracked page keeps the reminder menu", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: false, applied: false });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveText("False positive");

    // The posting's own Apply button is not an application: with nothing
    // tracked there is nothing to mark, so the False positive menu stays.
    await page.locator("article button").click();
    await page.waitForTimeout(1200);
    await expect(page.locator("#jat-pill")).not.toContainText("Just applied?");
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveText("False positive");
  } finally {
    site.close();
  }
});

test("apply click on a tracked draft asks about the application", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: true, applied: false });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    await page.locator("article button").click();
    await expect(page.locator("#jat-pill")).toContainText("Just applied?");
  } finally {
    site.close();
  }
});

test("open hands the verdict-time posting to the background", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: false, applied: false });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    await page.locator("#jat-pill button[data-act='open']").click();
    // Open no longer dismisses the pill — only False positive and ✕ do.
    await expect(page.locator("#jat-pill button[data-act='open']")).toBeVisible();
    const lastOpen = (await page.evaluate(
      () => (window as unknown as { __jatLastOpen?: unknown }).__jatLastOpen,
    )) as { url?: string; posting?: { title?: string; description?: string } };
    expect(lastOpen?.url).toContain("/e2e/fixture-job.html");
    expect(lastOpen?.posting?.title).toContain("Senior Backend Engineer");
    expect(lastOpen?.posting?.description).toContain("exactly-once");
  } finally {
    site.close();
  }
});

test("false-positive on a tracked posting is refused, not recorded", async ({ page }) => {
  const site = await startStatic(pkgDir);
  try {
    await bootPill(page, { tracked: false, applied: false }, { ok: false, reason: "tracked" });
    await page.goto(`${site.url}/e2e/fixture-job.html`);
    await page.addScriptTag({ path: path.join(pkgDir, "dist", "content.js") });

    await page.locator("#jat-pill button[data-act='no']").click();
    // The pill stays and says what it is instead of vanishing.
    await expect(page.locator("#jat-pill")).toContainText("Already saved");
    await expect(page.locator("#jat-pill")).toHaveCount(1);
  } finally {
    site.close();
  }
});
