import { expect, test } from "@playwright/test";
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
    // Stands in for background.ts: FP reports land in fpReported.
    const fakeBackground = (msg: { type?: string; host?: string }): unknown => {
      if (msg?.type === "JAT_FP_REPORT" && msg.host) {
        const hosts = Array.isArray(store["fpReported"]) ? store["fpReported"] : [];
        if (!(hosts as string[]).includes(msg.host)) {
          store["fpReported"] = [...(hosts as string[]), msg.host];
        }
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
      };
    w.chrome = fakeChrome;
    w.__jatListeners = listeners;
    w.__jatStore = store;
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

    // Pill is three buttons and nothing else.
    await expect(page.locator("#jat-pill button[data-act='open']")).toHaveText("Open");
    await expect(page.locator("#jat-pill button[data-act='no']")).toHaveText("False positive");
    await expect(page.locator("#jat-pill")).not.toContainText("Save this job?");

    // "False positive" hides the pill and records this host.
    await page.locator("#jat-pill button[data-act='no']").click();
    await expect(page.locator("#jat-pill")).toHaveCount(0);
    const store = await page.evaluate(
      () => (window as unknown as { __jatStore?: Record<string, unknown> }).__jatStore ?? {},
    );
    expect(store["fpReported"]).toContain("127.0.0.1");
  } finally {
    site.close();
  }
});
