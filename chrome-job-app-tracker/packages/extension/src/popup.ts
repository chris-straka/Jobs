import { CaptureRequest, CaptureResponse, ResolveResponse, StatusResponse } from "@jat/shared";
import { guessCompany } from "@jat/shared";
import { detectTrack, guessRegion } from "./extract.js";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function show(text: string): void {
  el("status").textContent = text;
}

let serverBaseUrl = DEFAULT_SERVER;

/** Fixed loopback URL; tests override it via stored prefs (no UI for this). */
function serverBase(): string {
  return serverBaseUrl;
}

let serverOnline = false;

/** The single copy button follows the server: stop cmd when up, start cmd when down. */
function refreshCopyButton(): void {
  (el("copy-srv") as HTMLButtonElement).textContent = serverOnline
    ? "⧉ Copy stop cmd"
    : "⧉ Copy start cmd";
}

function setHealth(state: "online" | "offline" | "pending", text: string): void {
  const pill = el("health");
  pill.classList.remove("online", "offline", "pending");
  pill.classList.add(state);
  el("health-text").textContent = text;
}

async function checkHealth(): Promise<void> {
  try {
    const res = await fetch(`${serverBase()}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      setHealth("online", "Server Online");
      serverOnline = true;
      const body = (await res.json().catch(() => null)) as { root?: unknown } | null;
      if (body && typeof body.root === "string") {
        serverRoot = body.root;
        await chrome.storage.local.set({ serverRoot: body.root });
      }
    } else {
      setHealth("offline", "Server Error");
      serverOnline = false;
    }
  } catch {
    setHealth("offline", "Server Offline");
    serverOnline = false;
  }
  refreshCopyButton();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      // clipboard unavailable — ok stays false
    }
    ta.remove();
    return ok;
  }
}

/** Jobs root for runnable commands: live health truth, else the export stamp. */
let serverRoot = "";

async function loadRepoRoot(): Promise<void> {
  try {
    const res = await fetch(chrome.runtime.getURL("repo-root.txt"));
    const text = (await res.text()).trim().replace(/\/$/, "");
    if (text) serverRoot = text;
  } catch {
    // export predates the stamp — health root or placeholder still works
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string): void {
  const toast = el("toast");
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
}

async function copyStart(): Promise<void> {
  const cmd = serverRoot
    ? `cd ${serverRoot}/chrome-job-app-tracker && bun run server`
    : "cd <jobs-checkout>/chrome-job-app-tracker && bun run server";
  showToast((await copyText(cmd)) ? `Copied:\n${cmd}` : "Copy failed — select and copy manually.");
}

async function copyStop(): Promise<void> {
  const cmd = `pkill -f "server/src/index.ts"`;
  showToast((await copyText(cmd)) ? `Copied:\n${cmd}` : "Copy failed — select and copy manually.");
}

/** One memorable command — it finds the extension id itself. */
function installHint(): string {
  return `One-click Start needs the native host. Run once in a terminal:\nja install-host`;
}

const NATIVE_HOST = "com.jobs.jat";

/** One-shot native call with a timeout; null when the host is missing. */
async function nativeCall(msg: Record<string, unknown>): Promise<unknown | null> {
  try {
    if (typeof chrome.runtime.sendNativeMessage !== "function") return null;
    return await Promise.race([
      chrome.runtime.sendNativeMessage(NATIVE_HOST, msg),
      new Promise((_, reject) =>
        window.setTimeout(() => reject(new Error("native timeout")), 2500),
      ),
    ]);
  } catch {
    return null;
  }
}

/**
 * Native Start/Stop lives on the status pill; the copy button appears only
 * when the host is missing or a native call fails.
 */
let nativeRunning = false;
let nativeWorks = false;

async function refreshNative(): Promise<void> {
  const status = (await nativeCall({ cmd: "status" })) as {
    ok?: boolean;
    running?: boolean;
  } | null;
  const works = status?.ok === true;
  nativeWorks = works;
  nativeRunning = works && status.running === true;
  const pill = el("health") as HTMLButtonElement;
  pill.disabled = !works;
  el("health-action").textContent = works ? (nativeRunning ? "Stop server" : "Start server") : "";
  el("copy-row").hidden = works;
  if (!works) {
    const hint = el("host-hint");
    hint.textContent = installHint();
    hint.hidden = false;
    return;
  }
  el("host-hint").hidden = true;
}

/** The dashboard is an extension page: list, add, and remove ignored hosts. */
async function openDashboard(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  } catch {
    showToast("Couldn't open the dashboard tab.");
  }
}

/**
 * The "Server starting…" line is stale once the server is up. It clears
 * on a delay so tests and fast readers still see it, then re-arms while
 * the server is still down (slow boots).
 */
function clearStartingWhenOnline(remaining = 3): void {
  window.setTimeout(() => {
    if (!el("status").textContent?.startsWith("Server starting")) return;
    if (serverOnline) show("");
    else if (remaining > 1) clearStartingWhenOnline(remaining - 1);
  }, 5000);
}

async function nativeStart(): Promise<void> {
  const r = (await nativeCall({ cmd: "start" })) as { ok?: boolean; reason?: string } | null;
  if (r?.ok !== true) {
    el("copy-row").hidden = false;
    show(`Start failed (${r?.reason ?? "no host"}) — copy buttons below as fallback.`);
  } else {
    show("Server starting…");
    clearStartingWhenOnline();
  }
  await checkHealth();
  await refreshNative();
}

async function nativeStop(): Promise<void> {
  const r = (await nativeCall({ cmd: "stop" })) as { ok?: boolean; reason?: string } | null;
  if (r?.ok !== true) {
    el("copy-row").hidden = false;
    show(`Stop failed (${r?.reason ?? "no host"}) — copy buttons below as fallback.`);
  } else {
    show("Server stopped.");
  }
  await checkHealth();
  await refreshNative();
}

async function renderFpList(): Promise<void> {
  const stored = await chrome.storage.local.get(["fpHosts"]);
  const hosts = Array.isArray(stored.fpHosts)
    ? stored.fpHosts.filter((h): h is string => typeof h === "string")
    : [];
  el("fp-count").textContent = String(hosts.length);
  const ul = el("fp-list");
  ul.replaceChildren();
  for (const host of hosts.sort()) {
    const li = document.createElement("li");
    li.textContent = `${host} `;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.type = "button";
    rm.addEventListener("click", () => {
      void chrome.storage.local
        .set({ fpHosts: hosts.filter((h) => h !== host) })
        .then(() => void renderFpList());
    });
    li.appendChild(rm);
    ul.appendChild(li);
  }
}

async function currentTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) throw new Error("no active tab");
  return tab;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Restores stored prefs and, when the tab allows it, prefills the posting. */
async function prefill(): Promise<void> {
  const stored = await chrome.storage.local.get(["server", "region", "serverRoot"]);
  serverBaseUrl =
    typeof stored.server === "string" ? stored.server.replace(/\/$/, "") : DEFAULT_SERVER;
  await loadRepoRoot();
  if (!serverRoot && typeof stored.serverRoot === "string") {
    serverRoot = stored.serverRoot;
  }
  const storedRegion = stored.region === "us" || stored.region === "uk" ? stored.region : "ca";

  let tabUrl = "";
  let title = "";
  let description = "";
  try {
    const tab = await currentTab();
    tabUrl = tab.url ?? "";
    try {
      const res = (await chrome.tabs.sendMessage(tab.id!, { type: "JAT_GET_POSTING" })) as {
        ok?: boolean;
        posting?: { title?: string; description?: string };
      };
      if (res?.ok && res.posting) {
        title = res.posting.title ?? "";
        description = res.posting.description ?? "";
      }
    } catch {
      // content script not on this page — user pastes manually
    }
  } catch {
    // no tab access (e.g. chrome://) — manual paste mode
  }
  (el("company") as HTMLInputElement).value = capitalize(guessCompany(tabUrl));
  (el("role") as HTMLInputElement).value = title;
  (el("description") as HTMLTextAreaElement).value = description;
  updateCount();
  updateTrack();
  const detected = title.trim() !== "" || description.trim() !== "";
  el("capture-form").hidden = !detected;
  el("empty-state").hidden = detected;
  (el("region") as HTMLSelectElement).value =
    guessRegion(tabUrl, `${title} ${description}`) || storedRegion;
}

function updateCount(): void {
  const n = (el("description") as HTMLTextAreaElement).value.length;
  el("count").textContent = `(${n} chars)`;
}

/** Live track badge — the same detector save() uses. */
function updateTrack(): void {
  const role = (el("role") as HTMLInputElement).value;
  const description = (el("description") as HTMLTextAreaElement).value;
  el("track-badge").textContent = detectTrack(role, description).toUpperCase();
}

/**
 * Validates the form client-side, POSTs to the capture server, and renders
 * the folder, build state, fit report, and any model suggestions.
 */
async function save(): Promise<void> {
  const server = serverBase();
  const region = (el("region") as HTMLSelectElement).value;
  await chrome.storage.local.set({ region });

  let tabUrl: string;
  try {
    tabUrl = (await currentTab()).url ?? "";
  } catch {
    show("No tab URL — paste the posting URL into the description first line? Aborted.");
    return;
  }
  const role = (el("role") as HTMLInputElement).value.trim();
  const description = (el("description") as HTMLTextAreaElement).value;
  const track = detectTrack(role, description);
  const parsed = CaptureRequest.safeParse({
    url: tabUrl,
    company: (el("company") as HTMLInputElement).value.trim(),
    role,
    track,
    region,
    description,
  });
  if (!parsed.success) {
    show(
      `Fix the form:\n${parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
    return;
  }
  show("Saving…");
  let res: Response;
  try {
    res = await fetch(`${server}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
  } catch {
    show(`Cannot reach ${server} — is the capture server running?`);
    return;
  }
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    show(`Server refused it:\n${JSON.stringify(body).slice(0, 1000)}`);
    return;
  }
  const out = CaptureResponse.safeParse(body);
  if (!out.success) {
    show("Server replied with something unexpected — check the server log.");
    return;
  }
  const { folder, buildOk, fit, model, draft } = out.data;
  const lines = [
    `Saved ${folder}`,
    `Build: ${buildOk ? "ok, one page" : "FAILED — see terminal"}`,
    `Best match: ${fit.projects.map((p) => `${p.id} (${p.score})`).join(", ") || "none"}`,
    `Gaps: ${fit.gaps.slice(0, 8).join(", ") || "none"}`,
  ];
  if (draft.written) {
    lines.push("Draft resume written — review it before sending.");
  }
  if (!model.disabled) {
    if (model.summary) lines.push(`Suggested summary: ${model.summary}`);
    if (model.bullets.length > 0)
      lines.push(
        `Suggested bullets: ${model.bullets.map((b) => `${b.project}:${b.id}`).join(", ")}`,
      );
  }
  lines.push("", "Next: review job.md, tailor resume.typ, run ja build, update notes.md.");
  show(lines.join("\n"));
}

async function markApplied(): Promise<void> {
  let tabUrl: string;
  try {
    tabUrl = (await currentTab()).url ?? "";
  } catch {
    show("No tab URL — nothing to mark.");
    return;
  }
  show("Marking applied…");
  let res: Response;
  try {
    res = await fetch(`${serverBase()}/api/resolve?url=${encodeURIComponent(tabUrl)}`);
  } catch {
    show("Server offline — start it first.");
    return;
  }
  const resolved = ResolveResponse.safeParse(await res.json());
  if (!resolved.success || !resolved.data.folder) {
    show("This page isn't tracked yet — save it first.");
    return;
  }
  const changed = await fetch(`${serverBase()}/api/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ folder: resolved.data.folder, status: "applied" }),
  });
  const out = StatusResponse.safeParse(await changed.json());
  show(
    changed.ok && out.success
      ? `Marked applied ✓ (${out.data.folder})`
      : "Status update failed — see the server log.",
  );
}

document.addEventListener("DOMContentLoaded", () => {
  (el("description") as HTMLTextAreaElement).addEventListener("input", updateCount);
  (el("role") as HTMLInputElement).addEventListener("input", updateTrack);
  (el("description") as HTMLTextAreaElement).addEventListener("input", updateTrack);
  el("manual-entry").addEventListener("click", () => {
    el("empty-state").hidden = true;
    el("capture-form").hidden = false;
    (el("company") as HTMLInputElement).focus();
  });
  el("save").addEventListener("click", () => void save());
  el("mark-applied").addEventListener("click", () => void markApplied());
  el("copy-srv").addEventListener("click", () => void (serverOnline ? copyStop() : copyStart()));
  el("health").addEventListener("click", () => {
    if (!nativeWorks) return;
    void (nativeRunning ? nativeStop() : nativeStart());
  });
  el("open-dashboard").addEventListener("click", () => void openDashboard());
  void renderFpList();
  void (async () => {
    await prefill();
    await checkHealth();
    await refreshNative();
  })();
  // The popup is short-lived, but while it's open keep the state honest.
  let polling = false;
  window.setInterval(() => {
    if (polling) return;
    polling = true;
    void Promise.all([checkHealth(), refreshNative()]).finally(() => {
      polling = false;
    });
  }, 5000);
});
