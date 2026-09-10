function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

async function getHosts(): Promise<string[]> {
  const stored = await chrome.storage.local.get(["fpHosts"]);
  const hosts = Array.isArray(stored.fpHosts)
    ? stored.fpHosts.filter((h): h is string => typeof h === "string")
    : [];
  return [...new Set(hosts)].sort();
}

async function setHosts(hosts: string[]): Promise<void> {
  await chrome.storage.local.set({ fpHosts: hosts });
}

/** Bare host only: no scheme, path, port, or spaces. */
function cleanHost(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!host || /[\s/:]/.test(host)) return null;
  return host;
}

async function render(): Promise<void> {
  const hosts = await getHosts();
  el("dash-count").textContent = String(hosts.length);
  const ul = el("dash-list");
  ul.replaceChildren();
  for (const host of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = host;
    const rm = document.createElement("button");
    rm.textContent = "Remove";
    rm.type = "button";
    rm.addEventListener("click", () => {
      void getHosts()
        .then((all) => setHosts(all.filter((h) => h !== host)))
        .then(() => void render());
    });
    li.append(name, rm);
    ul.appendChild(li);
  }
  el("empty-note").hidden = hosts.length > 0;
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
    void getHosts()
      .then((hosts) => setHosts(hosts.includes(host) ? hosts : [...hosts, host]))
      .then(() => {
        input.value = "";
        return render();
      });
  });
  void render();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && "fpHosts" in changes) void render();
    });
  } catch {
    // storage events unavailable (tests) — renders stay explicit
  }
});
