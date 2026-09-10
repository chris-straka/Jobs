import { IgnoreLists } from "@jat/shared";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const DEFAULT_SERVER = "http://127.0.0.1:8765";

async function serverBase(): Promise<string> {
  try {
    const stored = await chrome.storage.local.get(["server"]);
    return typeof stored.server === "string" ? stored.server : DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

/** Pill reports (fpReported) and hand adds (fpHosts) render as sections. */
async function getList(key: string): Promise<string[]> {
  const stored = await chrome.storage.local.get([key]);
  const hosts = Array.isArray(stored[key])
    ? stored[key].filter((h): h is string => typeof h === "string")
    : [];
  return [...new Set(hosts)].sort();
}

async function setList(key: string, hosts: string[]): Promise<void> {
  await chrome.storage.local.set({ [key]: hosts });
}

/**
 * Push both lists to the on-disk file. Silent offline — storage stays
 * live, the file heals on the next online write.
 */
async function persist(): Promise<void> {
  try {
    const base = await serverBase();
    await fetch(`${base}/api/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fpReported: await getList("fpReported"),
        fpHosts: await getList("fpHosts"),
      }),
    });
  } catch {
    // Offline — storage is the live store.
  }
}

/**
 * Union the on-disk lists into storage (fresh profiles, hand-edited
 * files), then push the merged result back.
 */
async function healFromFile(): Promise<void> {
  try {
    const base = await serverBase();
    const res = await fetch(`${base}/api/ignore`);
    const parsed = IgnoreLists.safeParse(await res.json());
    if (!parsed.success) return;
    const current = { fpReported: await getList("fpReported"), fpHosts: await getList("fpHosts") };
    const merged = {
      fpReported: [...new Set([...current.fpReported, ...parsed.data.fpReported])].sort(),
      fpHosts: [...new Set([...current.fpHosts, ...parsed.data.fpHosts])].sort(),
    };
    // Write only on change: avoids redundant work and any set→onChanged→render feedback.
    if (JSON.stringify(current) !== JSON.stringify(merged)) {
      await chrome.storage.local.set(merged);
    }
    await persist();
  } catch {
    // Offline — storage is the live store.
  }
}

/** Bare host only: no scheme, path, port, or spaces. */
function cleanHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!host || /[\s/:]/.test(host)) return null;
  return host;
}

async function renderSection(key: string, ulId: string, countId: string, emptyId: string): Promise<void> {
  const hosts = await getList(key);
  el(countId).textContent = String(hosts.length);
  const ul = el(ulId);
  ul.replaceChildren();
  for (const host of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.type = "button";
    rm.addEventListener("click", () => {
      void getList(key)
        .then((all) => setList(key, all.filter((h) => h !== host)))
        .then(() => persist())
        .then(() => void render());
    });
    li.append(name, rm);
    ul.appendChild(li);
  }
  el(emptyId).hidden = hosts.length > 0;
}

async function render(): Promise<void> {
  await healFromFile();
  await renderSection("fpReported", "fp-list", "fp-count", "fp-empty");
  await renderSection("fpHosts", "dash-list", "dash-count", "empty-note");
}

function showError(text: string): void {
  const err = el("form-error");
  err.textContent = text;
  err.hidden = !text;
}

document.addEventListener("DOMContentLoaded", () => {
  el("add-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const input = el("add-host") as HTMLInputElement;
    const host = cleanHost(input.value);
    if (!host) {
      showError("Enter a bare host, e.g. example.com.");
      return;
    }
    showError("");
    void getList("fpHosts")
      .then((hosts) => setList("fpHosts", hosts.includes(host) ? hosts : [...hosts, host]))
      .then(() => persist())
      .then(() => {
        input.value = "";
        return render();
      });
  });
  void render();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && ("fpHosts" in changes || "fpReported" in changes)) void render();
    });
  } catch {
    // storage events unavailable (tests) — renders stay explicit
  }
});
