import { CaptureRequest, CaptureResponse, ResolveResponse, StatusResponse } from "@jat/shared";
import { guessCompany } from "@jat/shared";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function show(text: string): void {
  el("status").textContent = text;
}

function serverBase(): string {
  return (el("server") as HTMLInputElement).value.trim().replace(/\/$/, "");
}

async function checkHealth(): Promise<void> {
  const dot = el("health");
  try {
    const res = await fetch(`${serverBase()}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      dot.textContent = "● server online";
      dot.style.color = "green";
      const body = (await res.json().catch(() => null)) as { root?: unknown } | null;
      if (body && typeof body.root === "string") {
        await chrome.storage.local.set({ serverRoot: body.root });
      }
    } else {
      dot.textContent = "● server error";
      dot.style.color = "red";
    }
  } catch {
    dot.textContent = "● server offline — copy the start cmd below";
    dot.style.color = "red";
  }
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

async function copyStart(): Promise<void> {
  const stored = await chrome.storage.local.get(["serverRoot"]);
  const root = typeof stored.serverRoot === "string" ? stored.serverRoot : null;
  const cmd = root
    ? `cd ${root}/chrome-job-app-tracker && bun run server`
    : "cd <jobs-checkout>/chrome-job-app-tracker && bun run server";
  show((await copyText(cmd)) ? `Copied:\n${cmd}` : "Copy failed — select and copy manually.");
}

async function copyStop(): Promise<void> {
  const cmd = `pkill -f "server/src/index.ts"`;
  show((await copyText(cmd)) ? `Copied:\n${cmd}` : "Copy failed — select and copy manually.");
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

/** Show native buttons only when the host answers; copy buttons are the fallback. */
async function refreshNative(): Promise<void> {
  const row = el("native-row");
  const status = (await nativeCall({ cmd: "status" })) as {
    ok?: boolean;
    running?: boolean;
  } | null;
  if (!status?.ok) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  (el("srv-start") as HTMLButtonElement).disabled = status.running === true;
  (el("srv-stop") as HTMLButtonElement).disabled = status.running !== true;
}

async function nativeStart(): Promise<void> {
  const r = (await nativeCall({ cmd: "start" })) as { ok?: boolean; reason?: string } | null;
  show(r?.ok === true ? "Server starting…" : `Start failed: ${r?.reason ?? "no host"}`);
  await checkHealth();
  await refreshNative();
}

async function nativeStop(): Promise<void> {
  const r = (await nativeCall({ cmd: "stop" })) as { ok?: boolean; reason?: string } | null;
  show(r?.ok === true ? "Server stopped." : `Stop failed: ${r?.reason ?? "no host"}`);
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

/** Restores stored prefs and, when the tab allows it, prefills company + description. */
async function prefill(): Promise<void> {
  const stored = await chrome.storage.local.get(["server", "track", "region"]);
  (el("server") as HTMLInputElement).value =
    typeof stored.server === "string" ? stored.server : DEFAULT_SERVER;
  (el("track") as HTMLSelectElement).value = stored.track === "csa" ? "csa" : "swe";
  (el("region") as HTMLSelectElement).value =
    stored.region === "us" || stored.region === "ca" ? stored.region : "uk";

  let tab: chrome.tabs.Tab;
  try {
    tab = await currentTab();
  } catch {
    return; // no tab access (e.g. chrome://) — manual paste mode
  }
  (el("company") as HTMLInputElement).value = guessCompany(tab.url ?? "");
  try {
    const res = (await chrome.tabs.sendMessage(tab.id!, { type: "JAT_GET_POSTING" })) as {
      ok?: boolean;
      posting?: { description?: string };
    };
    if (res?.ok && res.posting?.description) {
      (el("description") as HTMLTextAreaElement).value = res.posting.description;
      updateCount();
    }
  } catch {
    // content script not on this page — user pastes manually
  }
}

function updateCount(): void {
  const n = (el("description") as HTMLTextAreaElement).value.length;
  el("count").textContent = `(${n} chars)`;
}

/**
 * Validates the form client-side, POSTs to the capture server, and renders
 * the folder, build state, fit report, and any model suggestions.
 */
async function save(): Promise<void> {
  const server = serverBase();
  const track = (el("track") as HTMLSelectElement).value;
  const region = (el("region") as HTMLSelectElement).value;
  await chrome.storage.local.set({ server, track, region });

  let tabUrl: string;
  try {
    tabUrl = (await currentTab()).url ?? "";
  } catch {
    show("No tab URL — paste the posting URL into the description first line? Aborted.");
    return;
  }
  const parsed = CaptureRequest.safeParse({
    url: tabUrl,
    company: (el("company") as HTMLInputElement).value.trim(),
    role: (el("role") as HTMLInputElement).value.trim(),
    track,
    region,
    description: (el("description") as HTMLTextAreaElement).value,
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
    `Best fit: ${fit.projects.map((p) => `${p.id} (${p.score})`).join(", ") || "none"}`,
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
  lines.push("", "Next: review job.md, tailor resume.typ, run bin/build.sh, update notes.md.");
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
  void prefill().then(() => void checkHealth());
  void refreshNative();
  void renderFpList();
  (el("description") as HTMLTextAreaElement).addEventListener("input", updateCount);
  (el("server") as HTMLInputElement).addEventListener("input", () => void checkHealth());
  el("save").addEventListener("click", () => void save());
  el("mark-applied").addEventListener("click", () => void markApplied());
  el("copy-start").addEventListener("click", () => void copyStart());
  el("copy-stop").addEventListener("click", () => void copyStop());
  el("srv-start").addEventListener("click", () => void nativeStart());
  el("srv-stop").addEventListener("click", () => void nativeStop());
});
