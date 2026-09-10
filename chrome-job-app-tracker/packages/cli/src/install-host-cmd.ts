import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { die } from "./prompt.js";

export function installHostHelp(): string {
  return `Usage: ja install-host [--id ID] [--browser brave|chrome|chromium]

Installs the native-messaging host so the popup gets one-click Start/Stop.
Finds the loaded extension id in the browser's preferences automatically;
when nothing is loaded yet, predicts the id from the checkout path
(Chrome derives it from the folder) and installs in every browser
present. Pass --id to override (id from chrome://extensions,
Developer mode). ja extension runs this check automatically — this
command is the explicit version for when the host needs reinstalling
on its own.`;
}

export interface BrowserDir {
  browser: string;
  dir: string;
}

export function browserDirs(home: string = homedir()): BrowserDir[] {
  const base = path.join(home, "Library", "Application Support");
  return [
    { browser: "brave", dir: path.join(base, "BraveSoftware", "Brave-Browser") },
    { browser: "chrome", dir: path.join(base, "Google", "Chrome") },
    { browser: "chromium", dir: path.join(base, "Chromium") },
  ];
}

/**
 * Extension id from Secure Preferences (fallback: Preferences), matched
 * against the checkout and Downloads copies. First candidate wins.
 *
 * @returns id + browser, or null when nothing matches
 */
export function detectExtensionId(
  candidates: string[],
  dirs: BrowserDir[],
): { id: string; browser: string } | null {
  const want = new Set(candidates.filter(existsSync).map((c) => path.normalize(c)));
  if (want.size === 0) return null;
  const seen = new Map<string, { id: string; browser: string; rank: number }>();
  for (const { browser, dir } of dirs) {
    let profiles: string[];
    try {
      profiles = readdirSync(dir).filter((d) => d === "Default" || d.startsWith("Profile "));
    } catch {
      continue;
    }
    for (const profile of profiles) {
      for (const file of ["Secure Preferences", "Preferences"]) {
        let json: unknown;
        try {
          json = JSON.parse(readFileSync(path.join(dir, profile, file), "utf8"));
        } catch {
          continue;
        }
        const settings =
          (json as { extensions?: { settings?: Record<string, { path?: unknown }> } })?.extensions
            ?.settings ?? {};
        for (const [id, info] of Object.entries(settings)) {
          const extPath = info?.path;
          if (typeof extPath !== "string") continue;
          const rank = candidates.findIndex((c) => path.normalize(c) === path.normalize(extPath));
          if (rank === -1 || !want.has(path.normalize(extPath))) continue;
          const key = `${browser}${id}`;
          if (!seen.has(key)) seen.set(key, { id, browser, rank });
        }
      }
    }
  }
  const best = [...seen.values()].sort((a, b) => a.rank - b.rank)[0];
  return best ? { id: best.id, browser: best.browser } : null;
}

/**
 * Native-host manifest path. Mirrors the mapping in
 * packages/native-host/install.sh — keep the two in sync.
 */
export function hostManifestPath(home: string, browser: string): string {
  const base = path.join(home, "Library", "Application Support");
  const profile =
    browser === "brave"
      ? path.join(base, "BraveSoftware", "Brave-Browser")
      : browser === "chromium"
        ? path.join(base, "Chromium")
        : path.join(base, "Google", "Chrome");
  return path.join(profile, "NativeMessagingHosts", "com.jobs.jat.json");
}

/** True when the host manifest already allows the given extension id. */
export function hostInstalled(home: string, id: string, browser: string): boolean {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(hostManifestPath(home, browser), "utf8"));
  } catch {
    return false;
  }
  const origins = (manifest as { allowed_origins?: unknown })?.allowed_origins;
  return Array.isArray(origins) && origins.includes(`chrome-extension://${id}/`);
}

function runInstallSh(tracker: string, id: string, browser: string): void {
  const installSh = path.join(tracker, "packages", "native-host", "install.sh");
  if (!existsSync(installSh)) die(`no native host checkout under ${tracker}`);
  // Quiet on success — the caller prints one summary line. Loud on failure.
  const r = spawnSync(installSh, ["--browser", browser, "--id", id], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error || r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    die("install.sh failed — see above");
  }
}

/** Browsers actually present on this machine. */
export function presentBrowsers(home: string = homedir()): BrowserDir[] {
  return browserDirs(home).filter((b) => existsSync(b.dir));
}

/**
 * Install the host for a predicted (pre-load) id in every browser
 * present. Detection can't tell us which browser the user will load
 * into, so cover all of them — manifests are tiny permission files.
 */
function installPredicted(tracker: string, id: string, browsers: BrowserDir[]): void {
  if (browsers.length === 0) die("no supported browser found — nothing to install the host for");
  for (const b of browsers) runInstallSh(tracker, id, b.browser);
}

/**
 * What Chrome will assign an unpacked extension loaded from absPath:
 * the first 128 bits of the path's SHA-256, nibbles mapped to a-p.
 * Verified against a real Secure Preferences entry.
 */
export function unpackedExtensionId(absPath: string): string {
  const digest = createHash("sha256").update(absPath, "utf8").digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(0x61 + (digest[i] >> 4), 0x61 + (digest[i] & 0x0f));
  }
  return id;
}

/** Predicted id for the first existing candidate, or null. */
export function predictId(candidates: string[]): { id: string; path: string } | null {
  for (const c of candidates) {
    if (existsSync(c)) return { id: unpackedExtensionId(path.normalize(c)), path: path.normalize(c) };
  }
  return null;
}

/**
 * Idempotent host setup for `ja extension`: detects the loaded extension,
 * skips when the host already allows it, installs otherwise. When nothing
 * is loaded yet, installs for the predicted id of the checkout copy, so
 * the toggle works as soon as the user loads it. A wrong prediction
 * self-heals: the next run detects the loaded id and reinstalls.
 *
 * @returns a one-line status for the caller to print
 */
export function ensureHost(tracker: string, candidates: string[], home: string = homedir()): string {
  const detected = detectExtensionId(candidates, browserDirs(home));
  if (detected) {
    if (hostInstalled(home, detected.id, detected.browser)) {
      return `native host ready for ${detected.id} — skipped`;
    }
    runInstallSh(tracker, detected.id, detected.browser);
    return `native host installed for ${detected.id} (${detected.browser})`;
  }
  const predicted = predictId(candidates);
  if (!predicted) {
    return "native host: no extension copy found — nothing to install for";
  }
  const targets = presentBrowsers(home);
  installPredicted(tracker, predicted.id, targets);
  return `native host installed for predicted id ${predicted.id} (${targets.map((t) => t.browser).join(", ")})`;
}

export async function installHostCommand(root: string, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      id: { type: "string" },
      browser: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(installHostHelp());
    return;
  }
  if (values.browser && !["brave", "chrome", "chromium"].includes(values.browser)) {
    die("--browser must be brave, chrome, or chromium");
  }
  const tracker = existsSync(path.join(root, "chrome-job-app-tracker", "package.json"))
    ? path.join(root, "chrome-job-app-tracker")
    : root;
  const candidates = [
    path.join(tracker, "packages", "extension"),
    path.join(homedir(), "Downloads", "jat-extension"),
  ];
  const dirs = browserDirs().filter((b) => !values.browser || b.browser === values.browser);
  const detected = !values.id || !values.browser ? detectExtensionId(candidates, dirs) : null;
  const id = values.id ?? detected?.id;
  const browser = values.browser ?? detected?.browser;
  if (!id) {
    const predicted = predictId(candidates);
    if (!predicted) die("no extension copy found — nothing to install the host for");
    const targets = values.browser
      ? browserDirs().filter((b) => b.browser === values.browser)
      : presentBrowsers();
    installPredicted(tracker, predicted.id, targets);
    console.log(
      `installed for predicted id ${predicted.id} (${predicted.path})\n` +
        "load it in Chrome — if the toggle ever reports the host missing, re-run ja install-host",
    );
    return;
  }
  const targetBrowser = browser ?? "chrome";
  if (hostInstalled(homedir(), id, targetBrowser)) {
    console.log(`native host ready for ${id} — skipped`);
    return;
  }
  runInstallSh(tracker, id, targetBrowser);
}
