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
    const fakeChrome = {
      runtime: {
        onMessage: {
          addListener: (fn: MessageListener): void => {
            listeners.push(fn);
          },
        },
      },
    };
    (window as unknown as { chrome?: unknown }).chrome = fakeChrome;
    (window as unknown as FakeWindow & { __jatListeners?: MessageListener[] }).__jatListeners =
      listeners;
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
  } finally {
    site.close();
  }
});
