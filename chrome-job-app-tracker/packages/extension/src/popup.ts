import {
  CaptureRequest,
  CaptureResponse,
  PENDING_POSTING_KEY,
  PENDING_POSTING_TTL_MS,
  PendingPosting,
  ResolveResponse,
  StatusResponse,
} from "@jat/shared";
import { guessCompany } from "@jat/shared";
import { detectTrack, guessRegion, samePostingText } from "./extract.js";

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

/**
 * Tab URL behind the current form: the stash the pill handed over, or the
 * live tab prefill read. Save and Mark applied reuse it so they keep
 * working where the live tab query sees nothing (programmatic openPopup
 * grants no activeTab).
 */
let prefilledTabUrl = "";

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
  el("health-action").textContent = works ? (nativeRunning ? "Stop server?" : "Start server?") : "";
  el("copy-row").hidden = works;
  if (!works) {
    const hint = el("host-hint");
    hint.textContent = installHint();
    hint.hidden = false;
    return;
  }
  el("host-hint").hidden = true;
}

/** The dashboard is an extension page: list, add, and remove false-positive hosts. */
async function openDashboard(): Promise<void> {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  } catch {
    showToast("Couldn't open the dashboard tab.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function nativeStart(): Promise<void> {
  // Pending until health confirms: the host reports the process alive,
  // not the port answering, so green waits for a real /health 200.
  setHealth("pending", "Starting server…");
  const r = (await nativeCall({ cmd: "start" })) as { ok?: boolean; reason?: string } | null;
  if (r?.ok !== true) {
    el("copy-row").hidden = false;
    show(`Start failed (${r?.reason ?? "no host"}) — copy buttons below as fallback.`);
    await checkHealth();
    await refreshNative();
    return;
  }
  show("Server starting…");
  // Poll until the server answers (slow boots) instead of trusting the
  // first check. Green clears the line; while still down it stays — a
  // slow boot may yet answer, and the 5s poll keeps watching.
  for (let i = 0; i < 8; i++) {
    await checkHealth();
    if (serverOnline) break;
    await sleep(400);
  }
  if (serverOnline) show("");
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

async function currentTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) throw new Error("no active tab");
  return tab;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Resolve this tab's URL: the tracked folder plus the saved posting text,
 * so the popup can tell a repost (same text) from a recycled URL.
 * `null` when untracked, offline, or there is no tab URL.
 */
async function resolvePosting(
  tabUrl: string,
): Promise<{ folder: string; description: string | null } | null> {
  if (!tabUrl) return null;
  try {
    const res = await fetch(`${serverBase()}/api/resolve?url=${encodeURIComponent(tabUrl)}`);
    const parsed = ResolveResponse.safeParse(await res.json());
    if (parsed.success && parsed.data.folder) {
      return { folder: parsed.data.folder, description: parsed.data.description ?? null };
    }
    return null;
  } catch {
    // Offline — plain form; mark-applied waits for the save.
    return null;
  }
}

/** Restores stored prefs and, when the tab allows it, prefills the posting. */
async function prefill(): Promise<void> {
  el("save-row").appendChild(el("mark-applied"));
  el("result").hidden = true;
  const stored = await chrome.storage.local.get(["server", "region", "serverRoot"]);
  serverBaseUrl =
    typeof stored.server === "string" ? stored.server.replace(/\/$/, "") : DEFAULT_SERVER;
  await loadRepoRoot();
  if (!serverRoot && typeof stored.serverRoot === "string") {
    serverRoot = stored.serverRoot;
  }
  const storedRegion = stored.region === "us" || stored.region === "uk" ? stored.region : "ca";

  // Pill-Open handoff: the exact posting the pill verdict used. The live
  // tab query is not always permitted to see the tab (programmatic
  // openPopup grants no activeTab), so the stash wins whenever the tab is
  // hidden or agrees with it; a visible, different tab means stale stash.
  let stash: PendingPosting | null = null;
  try {
    const s = await chrome.storage.session.get([PENDING_POSTING_KEY]);
    const parsed = PendingPosting.safeParse(s[PENDING_POSTING_KEY]);
    if (parsed.success && Date.now() - parsed.data.at < PENDING_POSTING_TTL_MS) {
      stash = parsed.data;
    }
  } catch {
    // session storage unavailable — live tab read only
  }

  let tabUrl = "";
  let tabId: number | undefined;
  try {
    const tab = await currentTab();
    tabUrl = tab.url ?? "";
    tabId = tab.id;
  } catch {
    // no tab access (e.g. chrome://) — stash or manual paste mode
  }

  let title = "";
  let description = "";
  if (stash && (!tabUrl || tabUrl === stash.url)) {
    tabUrl = stash.url;
    title = stash.title;
    description = stash.description;
    try {
      await chrome.storage.session.remove([PENDING_POSTING_KEY]);
    } catch {
      // stays until TTL expiry — harmless, the URL check guards reuse
    }
  } else if (tabId !== undefined) {
    try {
      const res = (await chrome.tabs.sendMessage(tabId, { type: "JAT_GET_POSTING" })) as {
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
  }
  prefilledTabUrl = tabUrl;
  (el("company") as HTMLInputElement).value = capitalize(guessCompany(tabUrl));
  (el("role") as HTMLInputElement).value = title;
  (el("description") as HTMLTextAreaElement).value = description;
  updateCount();
  (el("track") as HTMLSelectElement).value = detectTrack(title, description);
  const detected = title.trim() !== "" || description.trim() !== "";
  el("capture-form").hidden = !detected;
  el("empty-state").hidden = detected;
  // Tracked URL + unchanged text: the posting is already saved, so the
  // form gives way to the saved state. Changed text means the URL was
  // recycled for a new posting — keep the form, with a notice.
  const known = await resolvePosting(tabUrl);
  const mark = el("mark-applied") as HTMLButtonElement;
  if (detected && known && samePostingText(description, known.description)) {
    showSavedState(known.folder);
  } else {
    mark.disabled = true;
    mark.title = "Save this posting first";
    const note = el("recycled-note");
    if (known) {
      // No saved text to compare (older server, unreadable file): report
      // the save without claiming the text changed.
      note.textContent =
        known.description === null
          ? `This URL was saved before as ${known.folder}.`
          : `This URL was saved before as ${known.folder} — but the text changed, ` +
            `so this looks like a new posting.`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }
  (el("region") as HTMLSelectElement).value =
    guessRegion(tabUrl, `${title} ${description}`) || storedRegion;
}

function updateCount(): void {
  const n = (el("description") as HTMLTextAreaElement).value.length;
  el("count").textContent = `(${n} chars)`;
}

/** Absolute checkout path of a saved folder, for the result links. */
function savedAbsPath(folder: string): string | null {
  if (!serverRoot) return null;
  return `${serverRoot.replace(/\/+$/, "")}/${folder}`;
}

/** Opener link for a saved folder, shared by the result and saved states. */
function renderLinks(folder: string): void {
  const links = el("result-links");
  links.replaceChildren();
  const abs = savedAbsPath(folder);
  if (!abs) {
    links.textContent = `Saved under ${folder} (Jobs root unknown).`;
    return;
  }
  const vs = document.createElement("a");
  vs.id = "open-saved";
  vs.href = `vscode://file${abs}`;
  vs.textContent = "Open in VS Code";
  // Protocol clicks fail silently when VS Code isn't installed: nothing
  // handles the link, so the popup never loses focus. No blur within the
  // window means the handoff went nowhere — say so instead of nothing.
  vs.addEventListener("click", () => {
    const timer = window.setTimeout(() => {
      alert("VS Code didn't open — install it from https://code.visualstudio.com, then try again.");
    }, 1500);
    window.addEventListener("blur", () => window.clearTimeout(timer), { once: true });
  });
  links.append(vs);
}

/**
 * Tracked URL, unchanged text: the posting is already saved, so there is
 * no form — just the opener link and an enabled Mark applied. The save
 * collision path passes markEnabled=false when the form text does not
 * match the folder, so a same-slug different posting is never one click
 * away from being marked applied.
 */
function showSavedState(folder: string, markEnabled = true): void {
  el("capture-form").hidden = true;
  el("empty-state").hidden = true;
  el("result-title").textContent = "Already saved ✓";
  renderLinks(folder);
  el("build-line").hidden = true;
  el("build-output").hidden = true;
  el("draft-line").hidden = true;
  el("notes-line").hidden = true;
  el("result-actions").prepend(el("mark-applied"));
  const mark = el("mark-applied") as HTMLButtonElement;
  mark.disabled = !markEnabled;
  mark.title = markEnabled ? "" : "Saved posting differs — check the folder first";
  el("result").hidden = false;
  // The saved state replaces the status box — never both.
  show("");
}

/**
 * Swap the form for the result: a merged title/build line, one draft line,
 * one notes line, the VS Code link at the bottom, and the (relocated) Mark
 * applied button. No dumps — the details live in the repo, not the popup.
 */
function showResult(
  folder: string,
  buildOk: boolean,
  buildOutput: string,
  model: { disabled: boolean; raw: string | null },
  draft: { written: boolean; bullets: number; elapsedMs: number },
  notes: { written: boolean },
): void {
  el("capture-form").hidden = true;
  el("empty-state").hidden = true;
  renderLinks(folder);
  const buildLine = el("build-line");
  if (buildOk) {
    el("result-title").textContent = "Saved ✓ Resume built · one page";
    buildLine.hidden = true;
  } else {
    el("result-title").textContent = "Saved ✓";
    buildLine.hidden = false;
    buildLine.textContent = "Build failed";
  }
  buildLine.classList.toggle("fail", !buildOk);
  const output = el("build-output");
  output.hidden = buildOk;
  if (!buildOk) output.textContent = buildOutput.split("\n").slice(0, 8).join("\n");
  const draftLine = el("draft-line");
  if (model.disabled) {
    draftLine.hidden = true;
  } else {
    draftLine.hidden = false;
    draftLine.textContent = draft.written
      ? `Tailored with ${draft.bullets} bullets in ${formatElapsed(draft.elapsedMs)} — review resume.typ before sending`
      : `Tailoring failed — ${shortReason(model.raw)}`;
  }
  const notesLine = el("notes-line");
  if (notes.written) {
    notesLine.hidden = false;
    notesLine.textContent = "Interview notes ready in notes.md";
  } else {
    notesLine.hidden = true;
  }
  el("result-actions").prepend(el("mark-applied"));
  // Failed saves stay unmarked: nothing is ready to send.
  const mark = el("mark-applied") as HTMLButtonElement;
  mark.disabled = !buildOk;
  mark.title = buildOk ? "" : "Fix the failed build first";
  el("result").hidden = false;
  // The result panel replaces the status box — never both.
  show("");
}

let saving = false;

/**
 * Mark gating for a save collision: enable Mark applied only when the
 * conflicting folder is what the form shows — the same folder the tab URL
 * resolves to, with matching posting text.
 */
async function conflictMatches(
  tabUrl: string,
  description: string,
  folder: string,
): Promise<boolean> {
  const known = await resolvePosting(tabUrl);
  return !!known && known.folder === folder && samePostingText(description, known.description);
}

/** First line of the failure record, or a fallback when there is none. */
function shortReason(raw: string | null): string {
  const first = (raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return (first ?? "no output").slice(0, 160);
}

/** 83s, 1m 23s — the result receipt. */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Human labels for the server's capture stages. Unknown stages keep quiet. */
function stageLabel(stage: string): string | null {
  switch (stage) {
    case "scaffold":
      return "Saving posting…";
    case "fit":
      return "Scoring project fit…";
    case "build":
      return "Building default resume…";
    case "model":
      return "Asking Muse Spark for bullets…";
    case "draft":
      return "Drafting tailored resume…";
    case "fit-page":
      return "Fitting one page…";
    case "notes":
      return "Writing interview notes…";
    case "agent":
      return "Muse Spark is tailoring…";
    case "agent-think":
      return "Muse Spark is thinking…";
    case "agent-read":
      return "Reading bullet library…";
    case "agent-write":
      return "Writing resume draft…";
    case "agent-run":
      return "Running commands…";
    default:
      return null;
  }
}

/**
 * Polls the server's live capture stage while the POST is in flight.
 * Never overwrites the final result: the caller stops the loop first.
 */
function pollProgress(server: string, clientId: string): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const res = await fetch(`${server}/api/progress?client=${encodeURIComponent(clientId)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const body = (await res.json()) as { stage?: unknown };
        const label = typeof body.stage === "string" ? stageLabel(body.stage) : null;
        if (label && !stopped) show(label);
      }
    } catch {
      // Server busy or gone — the capture POST is the source of truth.
    }
    if (!stopped) {
      window.setTimeout(() => void tick(), 700);
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}

/**
 * Save-row buttons while a capture is in flight: Save off, full-width
 * Cancel on. Every save() exit restores it — including the result states,
 * which move mark-applied elsewhere but never touch Cancel.
 */
function setSavingUI(savingNow: boolean): void {
  (el("save") as HTMLButtonElement).disabled = savingNow;
  const cancel = el("cancel-save") as HTMLButtonElement;
  cancel.hidden = !savingNow;
  if (!savingNow) cancel.disabled = false;
}

/**
 * Validates the form client-side, POSTs to the capture server, and renders
 * the folder, build state, fit report, and any model suggestions.
 */
async function save(): Promise<void> {
  const server = serverBase();
  const region = (el("region") as HTMLSelectElement).value;
  await chrome.storage.local.set({ region });

  let tabUrl = prefilledTabUrl;
  if (!tabUrl) {
    try {
      tabUrl = (await currentTab()).url ?? "";
    } catch {
      show("No tab URL — paste the posting URL into the description first line? Aborted.");
      return;
    }
  }
  const role = (el("role") as HTMLInputElement).value.trim();
  const description = (el("description") as HTMLTextAreaElement).value;
  const track = (el("track") as HTMLSelectElement).value;
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
  if (saving) return;
  saving = true;
  setSavingUI(true);
  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(Date.now());
  show("Saving…");
  const stopProgress = pollProgress(server, clientId);
  // Manual abort (Cancel button) replaces the fire-and-forget timeout so
  // giving up locally also stops waiting. The 10-minute timeout stays: an
  // unanswered run still releases the form.
  const manual = new AbortController();
  const manualTimeout = window.setTimeout(() => manual.abort(), 600000);
  const cancelBtn = el("cancel-save") as HTMLButtonElement;
  let cancelled = false;
  cancelBtn.onclick = () => void (async () => {
    cancelBtn.disabled = true;
    show("Cancelling…");
    let killed = false;
    try {
      const r = await fetch(`${server}/api/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId }),
        signal: AbortSignal.timeout(5000),
      });
      killed = r.ok;
    } catch {
      // Server gone — killed stays false.
    }
    if (!killed) {
      // Unknown capture: already finished or server gone. Keep waiting —
      // the save itself will report.
      cancelBtn.disabled = false;
      show("Cancel didn't land — still saving…");
      return;
    }
    cancelled = true;
    manual.abort();
    stopProgress();
    window.clearTimeout(manualTimeout);
    setSavingUI(false);
    saving = false;
    show("Cancelled — nothing saved.");
  })();
  let res: Response;
  try {
    res = await fetch(`${server}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed.data, clientId }),
      signal: manual.signal,
    });
  } catch (err) {
    stopProgress();
    window.clearTimeout(manualTimeout);
    setSavingUI(false);
    saving = false;
    // A confirmed cancel already reported the truth above; anything else
    // is a timeout or a dead server.
    if (!cancelled) {
      show(
        err instanceof Error && err.name === "AbortError"
          ? "Capture timed out — the model may still be working; check the repo."
          : `Cannot reach ${server} — is the capture server running?`,
      );
    }
    return;
  }
  stopProgress();
  window.clearTimeout(manualTimeout);
  const body = (await res.json()) as unknown;
  if (!res.ok) {
    // Lost the race (stale form, double save): the folder is the truth
    // now, so show its saved state instead of the raw collision error.
    // No form, no save button — and Mark applied only when the form text
    // provably matches the folder's posting.
    if (res.status === 409) {
      const conflict = body as { folder?: unknown };
      if (typeof conflict?.folder === "string" && conflict.folder) {
        const markEnabled = await conflictMatches(tabUrl, description, conflict.folder);
        saving = false;
        setSavingUI(false);
        showSavedState(conflict.folder, markEnabled);
        return;
      }
    }
    const refused = body as { error?: unknown };
    show(
      typeof refused?.error === "string"
        ? refused.error
        : `Server refused it:\n${JSON.stringify(body).slice(0, 1000)}`,
    );
    saving = false;
    setSavingUI(false);
    return;
  }
  const out = CaptureResponse.safeParse(body);
  if (!out.success) {
    show("Server replied with something unexpected — check the server log.");
    saving = false;
    setSavingUI(false);
    return;
  }
  const { folder, buildOk, buildOutput, model, draft, notes } = out.data;
  saving = false;
  setSavingUI(false);
  showResult(folder, buildOk, buildOutput, model, draft, notes);
}

async function markApplied(): Promise<void> {
  let tabUrl = prefilledTabUrl;
  if (!tabUrl) {
    try {
      tabUrl = (await currentTab()).url ?? "";
    } catch {
      show("No tab URL — nothing to mark.");
      return;
    }
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
