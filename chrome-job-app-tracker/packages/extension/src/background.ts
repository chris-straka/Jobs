import {
  PENDING_POSTING_KEY,
  PendingPosting,
  OpenResponse,
  ResolveResponse,
  StatusResponse,
} from "@jat/shared";

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

interface FpResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pill reports land in fpReported, hand adds in fpHosts. The pill stays
 * hidden on both; the dashboard shows them as separate sections. A tracked
 * URL is never a false positive — the report is refused so a saved posting
 * can never be muted out of the pill.
 */
async function reportFalsePositive(host: string, url: string): Promise<FpResult> {
  if (url) {
    const base = await serverBase();
    try {
      const res = await fetch(`${base}/api/resolve?url=${encodeURIComponent(url)}`);
      const parsed = ResolveResponse.safeParse(await res.json());
      if (parsed.success && parsed.data.folder) return { ok: false, reason: "tracked" };
    } catch {
      // Server offline — nothing tracked that we know of; record the report.
    }
  }
  const stored = await chrome.storage.local.get(["fpReported"]);
  const hosts = Array.isArray(stored.fpReported) ? stored.fpReported : [];
  if (!hosts.includes(host)) {
    await chrome.storage.local.set({ fpReported: [...hosts, host] });
  }
  return { ok: true };
}

interface PillState {
  tracked: boolean;
  applied: boolean;
}

/** Content-script pill: which buttons make sense for this URL. */
async function pillState(url: string): Promise<PillState> {
  const untracked = { tracked: false, applied: false };
  const base = await serverBase();
  try {
    const res = await fetch(`${base}/api/resolve?url=${encodeURIComponent(url)}`);
    const parsed = ResolveResponse.safeParse(await res.json());
    if (!parsed.success || !parsed.data.folder) return untracked;
    // Unknown status keeps the Mark applied path (the click re-resolves).
    const applied = !!parsed.data.status && parsed.data.status !== "draft";
    return { tracked: true, applied };
  } catch {
    // Server offline — plain pill; Open falls back to the popup.
    return untracked;
  }
}

/** Best effort: opening the popup requires user activation, which does not always survive the hop from content script to worker. */
async function openPopup(): Promise<OpenResult> {
  try {
    await chrome.action.openPopup();
    return { ok: true, via: "popup" };
  } catch {
    return { ok: false };
  }
}

interface OpenResult {
  ok: boolean;
  via?: string;
}

/**
 * Stash the pill's verdict-time posting for the popup that is about to
 * open: the popup cannot always read the tab itself (programmatic
 * openPopup grants no activeTab), so this handoff is what prefills it.
 */
async function stashPendingPosting(url: string, posting: unknown): Promise<void> {
  const p = (posting ?? {}) as { title?: unknown; description?: unknown };
  const title = typeof p.title === "string" ? p.title : "";
  const description = typeof p.description === "string" ? p.description : "";
  // Nothing to hand over — leave any live tab read (or older stash) alone.
  if (!url || (title === "" && description === "")) return;
  const parsed = PendingPosting.safeParse({ url, title, description, at: Date.now() });
  if (!parsed.success) return;
  try {
    await chrome.storage.session.set({ [PENDING_POSTING_KEY]: parsed.data });
  } catch {
    // Session storage unavailable — the popup falls back to reading the tab.
  }
}

/**
 * Pill Open: tracked URLs open in VS Code (or Finder without the `code`
 * CLI) via the server; everything else gets the popup form. A failed
 * folder-open falls through to the popup, whose saved state carries the
 * opener links.
 */
async function openPosting(url: string, posting: unknown): Promise<OpenResult> {
  await stashPendingPosting(url, posting);
  const base = await serverBase();
  try {
    const resolveRes = await fetch(`${base}/api/resolve?url=${encodeURIComponent(url)}`);
    const resolved = ResolveResponse.safeParse(await resolveRes.json());
    if (resolved.success && resolved.data.folder) {
      const openRes = await fetch(`${base}/api/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: resolved.data.folder }),
      });
      const opened = OpenResponse.safeParse(await openRes.json());
      if (openRes.ok && opened.success) return { ok: true, via: opened.data.via };
    }
  } catch {
    // Server offline — the popup is the only move.
  }
  return openPopup();
}

// Message hub for content scripts (which cannot reach the local server
// directly). Popup pages call the server themselves.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "JAT_MARK_APPLIED") {
    void markApplied(String(msg.url ?? "")).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_PILL_STATE") {
    void pillState(String(msg.url ?? "")).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_OPEN") {
    void openPosting(String(msg.url ?? ""), msg.posting).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_FP_REPORT") {
    void reportFalsePositive(String(msg.host ?? "").toLowerCase(), String(msg.url ?? "")).then(
      sendResponse,
    );
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
