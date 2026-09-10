import { afterAll, beforeEach, describe, expect, it } from "bun:test";

type Listener = (
  msg: Record<string, unknown>,
  sender: unknown,
  respond: (r: unknown) => void,
) => boolean | undefined;

const listeners: Listener[] = [];
const fetchCalls: { url: string; init?: RequestInit }[] = [];
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
  runtime: { onMessage: { addListener: (fn: Listener): void => void listeners.push(fn) } },
};
(globalThis as unknown as { fetch?: unknown }).fetch = async (
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; json: () => Promise<unknown> }> => {
  fetchCalls.push({ url, init });
  const key = url.includes("/api/open") ? "open" : url.includes("/api/status") ? "status" : "resolve";
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
    });
  });

  it("reports draft postings as tracked but not applied", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
    });
  });

  it("reports applied postings and beyond as applied", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "applied") };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: true,
    });
  });

  it("keeps the mark path when the status is unreadable", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", null) };
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: true,
      applied: false,
    });
  });

  it("reports untracked when the server is offline", async () => {
    routes.resolve = new Error("connection refused");
    expect(await send("JAT_PILL_STATE", { url: "https://example.com/jobs/1" })).toEqual({
      tracked: false,
      applied: false,
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

describe("JAT_FP_REPORT", () => {
  it("records the host for untracked URLs", async () => {
    routes.resolve = { ok: true, body: resolveBody(null) };
    expect(await send("JAT_FP_REPORT", { host: "example.com", url: "https://example.com/jobs/1" })).toEqual({
      ok: true,
    });
    expect(localStore["fpReported"]).toEqual(["example.com"]);
  });

  it("refuses tracked URLs — a saved posting is never a false positive", async () => {
    routes.resolve = { ok: true, body: resolveBody("applications/2026-09-09_acme_x", "draft") };
    expect(
      await send("JAT_FP_REPORT", { host: "example.com", url: "https://example.com/jobs/1" }),
    ).toEqual({ ok: false, reason: "tracked" });
    expect(localStore["fpReported"]).toBeUndefined();
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
