import { FalsePositives, hostFromUrlOrHost } from "@jat/shared";

/** Retired split keys: read for migration, never written. */
const LEGACY_KEYS = ["fpReported", "fpHosts"];

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

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((h): h is string => typeof h === "string"))]
    : [];
}

/** The live list, unioned with retired split keys still in storage. */
async function getList(): Promise<string[]> {
  const stored = await chrome.storage.local.get(["falsePositives", ...LEGACY_KEYS]);
  const all = ["falsePositives", ...LEGACY_KEYS].flatMap((k) => cleanList(stored[k]));
  return [...new Set(all)].sort();
}

/**
 * Single writer: the merged list goes under one key and the retired keys
 * are dropped, so a removal can never resurrect from a stale split list.
 */
async function setList(hosts: string[]): Promise<void> {
  await chrome.storage.local.set({ falsePositives: [...new Set(hosts)].sort() });
  await chrome.storage.local.remove([...LEGACY_KEYS]);
}

/** Server payload, current or retired shape — anything else is ignored. */
function parsePayload(body: unknown): string[] | null {
  const strict = FalsePositives.safeParse(body);
  if (strict.success) return [...new Set(strict.data.falsePositives)].sort();
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if ("fpReported" in o || "fpHosts" in o) {
      return [...new Set([...cleanList(o["fpReported"]), ...cleanList(o["fpHosts"])])].sort();
    }
  }
  return null;
}

/**
 * Push the list to the on-disk file. Silent offline — storage stays
 * live, the file heals on the next online write.
 */
async function persist(): Promise<void> {
  try {
    const base = await serverBase();
    await fetch(`${base}/api/ignore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ falsePositives: await getList() }),
    });
  } catch {
    // Offline — storage is the live store.
  }
}

/**
 * Union the on-disk list into storage (fresh profiles, hand-edited
 * files), then push the merged result back.
 */
async function healFromFile(): Promise<void> {
  try {
    const base = await serverBase();
    const res = await fetch(`${base}/api/ignore`);
    const pulled = parsePayload(await res.json());
    if (!pulled) return;
    const current = await getList();
    const merged = [...new Set([...current, ...pulled])].sort();
    // Write only on change: avoids redundant work and any set→onChanged→render feedback.
    if (JSON.stringify(current) !== JSON.stringify(merged)) {
      await setList(merged);
    }
    await persist();
  } catch {
    // Offline — storage is the live store.
  }
}

async function renderSection(): Promise<void> {
  const hosts = await getList();
  el("fp-count").textContent = String(hosts.length);
  const ul = el("fp-list");
  ul.replaceChildren();
  for (const host of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.type = "button";
    rm.addEventListener("click", () => {
      void getList()
        .then((all) => setList(all.filter((h) => h !== host)))
        .then(() => persist())
        .then(() => void render());
    });
    li.append(name, rm);
    ul.appendChild(li);
  }
  el("fp-empty").hidden = hosts.length > 0;
}

/**
 * Migrate retired split keys into the one list on sight (storage-only, so
 * it runs offline too). Later writes drop the retired keys regardless.
 */
async function migrateStorage(): Promise<void> {
  const stored = await chrome.storage.local.get([...LEGACY_KEYS]);
  if (LEGACY_KEYS.every((k) => cleanList(stored[k]).length === 0)) return;
  await setList(await getList());
}

async function render(): Promise<void> {
  await migrateStorage();
  await healFromFile();
  await renderSection();
}

function showError(text: string): void {
  const err = el("form-error");
  err.textContent = text;
  err.hidden = !text;
}

document.addEventListener("DOMContentLoaded", () => {
  el("add-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const urlInput = el("add-url") as HTMLInputElement;
    const hostInput = el("add-host") as HTMLInputElement;
    const adds: string[] = [];
    for (const [raw, label] of [
      [urlInput.value, "URL"],
      [hostInput.value, "host"],
    ] as const) {
      if (!raw.trim()) continue;
      const host = hostFromUrlOrHost(raw);
      if (!host) {
        showError(`Couldn't read a host from that ${label}.`);
        return;
      }
      adds.push(host);
    }
    if (adds.length === 0) {
      showError("Paste a posting URL or enter a host, e.g. example.com.");
      return;
    }
    showError("");
    void getList()
      .then((hosts) => setList([...new Set([...hosts, ...adds])].sort()))
      .then(() => persist())
      .then(() => {
        urlInput.value = "";
        hostInput.value = "";
        return render();
      });
  });
  void render();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (
        area === "local" &&
        ("falsePositives" in changes || LEGACY_KEYS.some((k) => k in changes))
      ) {
        void render();
      }
    });
  } catch {
    // storage events unavailable (tests) — renders stay explicit
  }
});
