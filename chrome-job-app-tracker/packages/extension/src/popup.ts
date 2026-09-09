import { CaptureRequest, CaptureResponse } from "@jat/shared";
import { guessCompany } from "./extract.js";

const DEFAULT_SERVER = "http://127.0.0.1:8765";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function show(text: string): void {
  el("status").textContent = text;
}

async function currentTab(): Promise<chrome.tabs.Tab> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url) throw new Error("no active tab");
  return tab;
}

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

async function save(): Promise<void> {
  const server = (el("server") as HTMLInputElement).value.trim().replace(/\/$/, "");
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
  const { folder, buildOk, fit, model } = out.data;
  const lines = [
    `Saved ${folder}`,
    `Build: ${buildOk ? "ok, one page" : "FAILED — see terminal"}`,
    `Best fit: ${fit.projects.map((p) => `${p.id} (${p.score})`).join(", ") || "none"}`,
    `Gaps: ${fit.gaps.slice(0, 8).join(", ") || "none"}`,
  ];
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

document.addEventListener("DOMContentLoaded", () => {
  void prefill();
  (el("description") as HTMLTextAreaElement).addEventListener("input", updateCount);
  el("save").addEventListener("click", () => void save());
});
