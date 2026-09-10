function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
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
        .then(() => void render());
    });
    li.append(name, rm);
    ul.appendChild(li);
  }
  el(emptyId).hidden = hosts.length > 0;
}

async function render(): Promise<void> {
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
