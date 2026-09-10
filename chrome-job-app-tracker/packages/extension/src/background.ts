import { ResolveResponse, StatusResponse } from "@jat/shared";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

async function serverBase(): Promise<string> {
  const stored = await chrome.storage.local.get(["server"]);
  return typeof stored.server === "string" ? stored.server : DEFAULT_SERVER;
}

interface MarkResult {
  ok: boolean;
  folder?: string;
  reason?: string;
}

/** Pill confirm ("Just applied?") → resolve URL → mark applied. */
async function markApplied(url: string): Promise<MarkResult> {
  const base = await serverBase();
  let resolveRes: Response;
  try {
    resolveRes = await fetch(`${base}/api/resolve?url=${encodeURIComponent(url)}`);
  } catch {
    return { ok: false, reason: "server offline" };
  }
  const resolved = ResolveResponse.safeParse(await resolveRes.json());
  if (!resolved.success || !resolved.data.folder) return { ok: false, reason: "not tracked yet" };
  const statusRes = await fetch(`${base}/api/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folder: resolved.data.folder, status: "applied" }),
  });
  const changed = StatusResponse.safeParse(await statusRes.json());
  if (!statusRes.ok || !changed.success) return { ok: false, reason: "status update failed" };
  return { ok: true, folder: changed.data.folder };
}

async function reportFalsePositive(host: string): Promise<void> {
  const stored = await chrome.storage.local.get(["fpHosts"]);
  const hosts = Array.isArray(stored.fpHosts) ? stored.fpHosts : [];
  if (!hosts.includes(host)) {
    await chrome.storage.local.set({ fpHosts: [...hosts, host] });
  }
}

// Message hub for content scripts (which cannot reach the local server
// directly). Popup pages call the server themselves.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "JAT_MARK_APPLIED") {
    void markApplied(String(msg.url ?? "")).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_FP_REPORT") {
    void reportFalsePositive(String(msg.host ?? "").toLowerCase()).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }
  if (msg?.type === "JAT_OPEN_POPUP") {
    // Best effort: opening the popup requires user activation, which does
    // not always survive the hop from content script to worker.
    void (async () => {
      try {
        await chrome.action.openPopup();
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
  if (msg?.type === "JAT_SHOW_BADGE") {
    if (sender.tab?.id !== undefined) {
      void chrome.action
        .setBadgeText({ tabId: sender.tab.id, text: "•" })
        .then(() => chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" }))
        .then(() => sendResponse({ ok: true }));
      return true;
    }
    sendResponse({ ok: false });
  }
});
