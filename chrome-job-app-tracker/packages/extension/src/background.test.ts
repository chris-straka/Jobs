import { afterAll, beforeEach, describe, expect, it } from "bun:test";

type Listener = (
  msg: Record<string, unknown>,
  sender: unknown,
  respond: (r: unknown) => void,
) => boolean | undefined;

const listeners: Listener[] = [];
const fetchCalls: { url: string; init?: RequestInit }[] = [];
const createdTabs: { url?: string }[] = [];
let routes: Record<string, { ok: boolean; body: unknown } | Error> = {};
let popupOpens = 0;
let popupFails = false;
const localStore: Record<string, unknown> = {};
const sessionStore: Record<string, unknown> = {};

const prevChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
const prevFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

(globalThis as unknown as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string[]): Promise<Record<string, unknown>> => ({
        server: "http://127.0.0.1:9999",
        ...Object.fromEntries(keys.map((k) => [k, localStore[k]])),
      }),
      set: async (obj: Record<string, unknown>): Promise<void> => {
        Object.assign(localStore, obj);
      },
      remove: async (keys: string[]): Promise<void> => {
        for (const k of keys) delete localStore[k];
      },
    },
    session: {
      get: async (keys: string[]): Promise<Record<string, unknown>> =>
        Object.fromEntries(keys.map((k) => [k, sessionStore[k]])),
      set: async (obj: Record<string, unknown>): Promise<void> => {
        Object.assign(sessionStore, obj);
      },
      remove: async (keys: string[]): Promise<void> => {
        for (const k of keys) delete sessionStore[k];
      },
    },
  },
  action: {
    openPopup: async (): Promise<void> => {
      if (popupFails) throw new Error("no activation");
      popupOpens++;
    },
  },
  runtime: {
    onMessage: { addListener: (fn: Listener): void => void listeners.push(fn) },
    getURL: (p: string): string => `chrome-extension://fake/${p}`,
  },
  tabs: {
    create: async (opts: { url?: string }): Promise<{ url?: string }> => {
      createdTabs.push(opts);
      return opts;
    },
  },
};
(globalThis as unknown as { fetch?: unknown }).fetch = async (
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
  fetchCalls.push({ url, init });
  const key = url.includes("/api/open")
    ? "open"
    : url.includes("/api/status")
      ? "status"
      : "resolve";
  const r = routes[key];
  if (r instanceof Error) throw r;
  return { ok: r?.ok ?? true, json: async () => r?.body };
};

await import("./background.js");

afterAll(() => {
  (globalThis as unknown as { chrome?: unknown }).chrome = prevChrome;
  (globalThis as unknown as { fetch?: unknown }).fetch = prevFetch;
});

beforeEach(() => {
  fetchCalls.length = 0;
  createdTabs.length = 0;
  routes = {};
  popupOpens = 0;
  popupFails = false;
  for (const k of Object.keys(localStore)) delete localStore[k];
  for (const k of Object.keys(sessionStore)) delete sessionStore[k];
});

function send(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const hub = listeners[listeners.length - 1];
  return new Promise((resolve) => {
    hub({ type, ...extra }, {}, resolve);
  });
}

function resolveBody(folder: string | null, status: string | null = null): Record<string, unknown> {
  return { folder, description: folder ? "posting text" : null, status };
}

function openCallBody(): Record<string, unknown> {
  const call = fetchCalls.find((c) => c.url.includes("/api/open"));
  expect(call).toBeDefined();
  const body = (call?.init as { body?: string } | undefined)?.body ?? "{}";
  return JSON.parse(body) as Record<string, unknown>;
}

describe("JAT_PILL_STATE", () => {
  it("reports untracked when the URL was never captured", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: false,
      applied: false,
      ineligible: false,
    });
  });

  it("reports draft postings as tracked but not applied", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
      ineligible: false,
    });
  });

  it("reports applied postings and beyond as applied", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "applied") };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: true,
      ineligible: false,
    });
  });

  it("keeps the mark path when the status is unreadable", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", null) };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
      ineligible: false,
    });
  });

  it("reports untracked when the server is offline", async () => {
    routes.resolve = new Error("connection refused");
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: false,
      applied: false,
      ineligible: false,
    });
  });
});

describe("JAT_OPEN", () => {
  it("opens the popup form for untracked URLs", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(await send("JAT_OPEN", { url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
      via: "popup",
    });
    expect(popupOpens).toBe(1);
    expect(fetchCalls.some((c) => c.url.includes("/api/open"))).toBe(false);
  });

  it("opens tracked folders through the server without the popup", async () => {
    const folder = "applications/2026-09-09_acme_x";
    routes.resolve = { ok: true, body: resolveBody(folder, "draft") };
    routes.open = { ok: true, body: { via: "code" } };
    expect(await send("JAT_OPEN", { url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
      via: "code",
    });
    expect(openCallBody().folder).toBe(folder);
    expect(popupOpens).toBe(0);
  });

  it("falls back to the popup when the folder open fails", async () => {
    const folder = "applications/2026-09-09_acme_x";
    routes.resolve = { ok: true, body: resolveBody(folder, "draft") };
    routes.open = { ok: false, body: { error: "could not open" } };
    expect(await send("JAT_OPEN", { url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
      via: "popup",
    });
    expect(popupOpens).toBe(1);
  });

  it("reports failure when the server is offline and the popup refuses", async () => {
    routes.resolve = new Error("connection refused");
    popupFails = true;
    expect(await send("JAT_OPEN", { url: "https://example.com/jobs/1" })).toEqual({ ok: false });
  });
});

describe("JAT_OPEN handoff", () => {
  it("stashes the pill posting for the popup", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    const url = "https://example.com/jobs/1";
    await send("JAT_OPEN", {
      url,
      posting: { title: "Backend Engineer", description: "Long posting text here." },
    });
    const stashed = sessionStore["pendingPosting"] as Record<string, unknown>;
    expect(stashed.url).toBe(url);
    expect(stashed.title).toBe("Backend Engineer");
    expect(stashed.description).toBe("Long posting text here.");
    expect(typeof stashed.at).toBe("number");
  });

  it("skips the stash when there is no posting", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    await send("JAT_OPEN", { url: "https://example.com/jobs/1" });
    expect(sessionStore["pendingPosting"]).toBeUndefined();
  });
});

describe("JAT_PILL_STATE compatibility", () => {
  it("treats older servers that omit status and description as draft", async () => {
    routes.resolve = { ok: true, body: { folder: "applications/2026-09-09_acme_x" } };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
      ineligible: false,
    });
  });
});

describe("JAT_FP_REPORT", () => {
  it("records the path-scoped entry for untracked URLs", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(
      await send("JAT_FP_REPORT", {
        host: "example.com",
        entry: "example.com/jobs/1",
        url: "https://example.com/jobs/1",
      }),
    ).toEqual({
      ok: true,
    });
    expect(localStore["falsePositives"]).toEqual(["example.com/jobs/1"]);
  });

  it("derives the entry from the URL when the pill sends host-only", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(
      await send("JAT_FP_REPORT", { host: "example.com", url: "https://example.com/dashboard/" }),
    ).toEqual({ ok: true });
    expect(localStore["falsePositives"]).toEqual(["example.com/dashboard"]);
  });

  it("collapses root pages to a bare-host entry", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(
      await send("JAT_FP_REPORT", { host: "example.com", url: "https://example.com/" }),
    ).toEqual({ ok: true });
    expect(localStore["falsePositives"]).toEqual(["example.com"]);
  });

  it("refuses tracked URLs — a saved posting is never a false positive", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    expect(
      await send("JAT_FP_REPORT", {
        host: "example.com",
        entry: "example.com/jobs/1",
        url: "https://example.com/jobs/1",
      }),
    ).toEqual({ ok: false, reason: "tracked" });
    expect(localStore["falsePositives"]).toBeUndefined();
  });

  it("unions retired split keys and drops them on write", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    localStore["fpReported"] = ["old-reported.com"];
    localStore["fpHosts"] = ["old-hand.com"];
    expect(
      await send("JAT_FP_REPORT", {
        host: "example.com",
        entry: "example.com/jobs/1",
        url: "https://example.com/jobs/1",
      }),
    ).toEqual({
      ok: true,
    });
    expect(localStore["falsePositives"]).toEqual([
      "example.com/jobs/1",
      "old-hand.com",
      "old-reported.com",
    ]);
    expect(localStore["fpReported"]).toBeUndefined();
    expect(localStore["fpHosts"]).toBeUndefined();
  });
});

describe("JAT_FP_UNREPORT", () => {
  it("removes the entry and pushes storage to disk", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    await send("JAT_FP_REPORT", {
      host: "example.com",
      entry: "example.com/jobs/1",
      url: "https://example.com/jobs/1",
    });
    expect(localStore["falsePositives"]).toEqual(["example.com/jobs/1"]);
    expect(
      await send("JAT_FP_UNREPORT", { host: "example.com", entry: "example.com/jobs/1" }),
    ).toEqual({ ok: true });
    expect(localStore["falsePositives"]).toEqual([]);
    const pushes = fetchCalls.filter(
      (c) => c.url.includes("/api/ignore") && (c.init?.method ?? "GET") === "POST",
    );
    const last = pushes[pushes.length - 1];
    expect(last).toBeDefined();
    const body = JSON.parse((last?.init as { body?: string } | undefined)?.body ?? "{}") as {
      falsePositives?: string[];
    };
    expect(body.falsePositives).toEqual([]);
  });
});

describe("JAT_INELIGIBLE_MARK", () => {
  it("stores the canonical URL for untracked postings", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(
      await send("JAT_INELIGIBLE_MARK", {
        url: "https://www.example.com/jobs/1/?utm_source=x#apply",
      }),
    ).toEqual({ ok: true });
    expect(localStore["ineligibleUrls"]).toEqual(["https://example.com/jobs/1"]);
  });

  it("refuses tracked URLs — a saved posting is never ineligible", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    expect(await send("JAT_INELIGIBLE_MARK", { url: "https://example.com/jobs/1" })).toEqual({
      ok: false,
      reason: "tracked",
    });
    expect(localStore["ineligibleUrls"]).toBeUndefined();
  });

  it("refuses unreadable URLs", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(await send("JAT_INELIGIBLE_MARK", { url: "not a url" })).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(localStore["ineligibleUrls"]).toBeUndefined();
  });
});

describe("JAT_INELIGIBLE_UNMARK", () => {
  it("removes the canonical URL and pushes storage to disk", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    await send("JAT_INELIGIBLE_MARK", { url: "https://example.com/jobs/1?utm_source=x" });
    expect(localStore["ineligibleUrls"]).toEqual(["https://example.com/jobs/1"]);
    expect(await send("JAT_INELIGIBLE_UNMARK", { url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
    });
    expect(localStore["ineligibleUrls"]).toEqual([]);
    const pushes = fetchCalls.filter(
      (c) => c.url.includes("/api/ineligible") && (c.init?.method ?? "GET") === "POST",
    );
    const last = pushes[pushes.length - 1];
    expect(last).toBeDefined();
    const body = JSON.parse((last?.init as { body?: string } | undefined)?.body ?? "{}") as {
      ineligible?: string[];
    };
    expect(body.ineligible).toEqual([]);
  });
});

describe("JAT_PILL_STATE ineligible", () => {
  it("flags listed URLs despite tracking-param noise", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    localStore["ineligibleUrls"] = ["https://example.com/jobs/1"];
    expect(
      await send("JAT_PILL_STATE", { url: "https://www.example.com/jobs/1/?utm_source=x" }),
    ).toEqual({ tracked: false, applied: false, ineligible: true });
  });

  it("prefers tracked state over ineligible", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    localStore["ineligibleUrls"] = ["https://example.com/jobs/1"];
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
      ineligible: false,
    });
  });
});

describe("JAT_OPEN_DASHBOARD", () => {
  it("opens the Manage page in a new tab", async () => {
    expect(await send("JAT_OPEN_DASHBOARD")).toEqual({ ok: true });
    expect(createdTabs).toEqual([{ url: "chrome-extension://fake/dashboard.html" }]);
  });
});

describe("JAT_MARK_APPLIED", () => {
  it("resolves the URL and moves the status", async () => {
    const folder = "applications/2026-09-09_acme_x";
    routes.resolve = { ok: true, body: resolveBody(folder, "draft") };
    routes.status = { ok: true, body: { folder, status: "applied" } };
    expect(await send("JAT_MARK_APPLIED", { url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
      folder,
    });
  });
});
