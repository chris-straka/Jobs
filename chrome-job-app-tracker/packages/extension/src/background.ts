import {
  PENDING_POSTING_KEY,
  PendingPosting,
  FalsePositives,
  normalizeFalsePositiveEntries,
  normalizeFalsePositiveEntry,
  OpenResponse,
  ResolveResponse,
  StatusResponse,
} from "@jat/shared";

/** Retired split keys: read for migration, never written. */
const LEGACY_LIST_KEYS = ["fpReported", "fpHosts"];

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

function cleanStoredList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((h): h is string => typeof h === "string"))]
    : [];
}

/**
 * The live list, unioned with any retired split keys still sitting in
 * storage from before the merge.
 */
async function readFalsePositives(): Promise<string[]> {
  const stored = await chrome.storage.local.get(["falsePositives", ...LEGACY_LIST_KEYS]);
  const all = ["falsePositives", ...LEGACY_LIST_KEYS].flatMap((k) => cleanStoredList(stored[k]));
  return [...new Set(all)].sort();
}

/**
 * Single writer: entries normalize (bare host or `host/path`), the merged
 * list goes under one key, and the retired keys are dropped, so a removal
 * can never resurrect from a stale split list.
 */
async function writeFalsePositives(hosts: string[]): Promise<void> {
  await chrome.storage.local.set({ falsePositives: normalizeFalsePositiveEntries(hosts) });
  await chrome.storage.local.remove([...LEGACY_LIST_KEYS]);
}

/** Server payload, current or retired shape — anything else is ignored. */
function parseListPayload(body: unknown): string[] | null {
  const strict = FalsePositives.safeParse(body);
  if (strict.success) return [...new Set(strict.data.falsePositives)].sort();
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if ("fpReported" in o || "fpHosts" in o) {
      return [...new Set([...cleanStoredList(o["fpReported"]), ...cleanStoredList(o["fpHosts"])])].sort();
    }
  }
  return null;
}

/**
 * Push the storage list to disk after a local mutation (no union: the
 * caller just set storage, so it wins). Silent offline — storage stays live.
 */
async function pushIgnoreLists(): Promise<void> {
  try {
    const base = await serverBase();
    const falsePositives = await readFalsePositives();
    await fetch(`${base}/api/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ falsePositives }),
    });
  } catch {
    // Offline — the file heals on the next online write.
  }
}

/**
 * Pull the on-disk list into storage (union). Heals fresh profiles and
 * hand-edited files; a removal made while offline may reappear once and
 * needs a second, online removal.
 */
async function pullIgnoreLists(): Promise<void> {
  try {
    const base = await serverBase();
    const stored = await readFalsePositives();
    const res = await fetch(`${base}/api/ignore`);
    const pulled = parseListPayload(await res.json());
    if (!pulled) return;
    const merged = [...new Set([...stored, ...pulled])].sort();
    await writeFalsePositives(merged);
    await fetch(`${base}/api/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ falsePositives: merged }),
    });
  } catch {
    // Offline — storage is the live store; nothing to converge.
  }
}

/**
 * Every mute lives in the one false-positives list, however it got there
 * — pill report or dashboard add. Reports are path-scoped (`host/path`
 * covers only that subtree; a bare host covers the whole host), so muting
 * `…/dashboard/` never mutes `…/jobs/…` on the same host. A tracked URL is
 * never a false positive: the report is refused so a saved posting can
 * never be muted out of the pill.
 */
async function reportFalsePositive(host: string, url: string, rawEntry?: unknown): Promise<FpResult> {
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
  const entry =
    normalizeFalsePositiveEntry(rawEntry) ??
    normalizeFalsePositiveEntry(url) ??
    normalizeFalsePositiveEntry(host);
  if (!entry) return { ok: false, reason: "unreadable" };
  const stored = await readFalsePositives();
  if (!stored.includes(entry)) {
    await writeFalsePositives([...stored, entry]);
  }
  await pushIgnoreLists();
  return { ok: true };
}

/** Pill Undo: un-mute the reported entry and push the on-disk list. */
async function unreportFalsePositive(host: string, rawEntry?: unknown, url?: string): Promise<FpResult> {
  const entry =
    normalizeFalsePositiveEntry(rawEntry) ??
    (url ? normalizeFalsePositiveEntry(url) : null) ??
    normalizeFalsePositiveEntry(host);
  const stored = await readFalsePositives();
  await writeFalsePositives(entry ? stored.filter((h) => h !== entry) : stored);
  await pushIgnoreLists();
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

/** Pill "List" link: content scripts cannot open tabs themselves. */
async function openDashboard(): Promise<{ ok: boolean }> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    return { ok: true };
  } catch {
    return { ok: false };
  }
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
    // Converge the on-disk mute list into storage (unawaited): the next
    // page's denied() check then sees file entries too.
    void pullIgnoreLists();
    void pillState(String(msg.url ?? "")).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_OPEN") {
    void openPosting(String(msg.url ?? ""), msg.posting).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_FP_REPORT") {
    void reportFalsePositive(
      String(msg.host ?? "").toLowerCase(),
      String(msg.url ?? ""),
      msg.entry,
    ).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_FP_UNREPORT") {
    void unreportFalsePositive(
      String(msg.host ?? "").toLowerCase(),
      msg.entry,
      typeof msg.url === "string" ? msg.url : undefined,
    ).then(sendResponse);
    return true;
  }
  if (msg?.type === "JAT_OPEN_DASHBOARD") {
    void openDashboard().then(sendResponse);
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
