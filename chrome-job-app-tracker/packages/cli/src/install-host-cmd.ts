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
pass --id when that fails (id from chrome://extensions, Developer mode).
ja extension runs this check automatically — this command is the explicit
version for when the host needs reinstalling on its own.`;
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
  const r = spawnSync(installSh, ["--browser", browser, "--id", id], { stdio: "inherit" });
  if (r.error || r.status !== 0) die("install.sh failed — see above");
}

/**
 * Idempotent host setup for `ja extension`: detects the loaded extension,
 * skips when the host already allows it, installs otherwise. Never dies
 * when the extension simply isn't loaded yet — that just means the user
 * hasn't reached the Load unpacked step.
 *
 * @returns a one-line status for the caller to print
 */
export function ensureHost(tracker: string, candidates: string[], home: string = homedir()): string {
  const detected = detectExtensionId(candidates, browserDirs(home));
  if (!detected) {
    return "native host: extension not loaded yet — load it, then run ja install-host";
  }
  if (hostInstalled(home, detected.id, detected.browser)) {
    return `native host ready for ${detected.id} — skipped`;
  }
  runInstallSh(tracker, detected.id, detected.browser);
  return `native host installed for ${detected.id} (${detected.browser})`;
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
  const browser = values.browser ?? detected?.browser ?? "chrome";
  if (!id) {
    die(
      "extension id not found — load the extension first, then pass it explicitly:\n" +
        "ja install-host --id <id from chrome://extensions, Developer mode>",
    );
  }
  if (hostInstalled(homedir(), id, browser)) {
    console.log(`native host ready for ${id} — skipped`);
    return;
  }
  runInstallSh(tracker, id, browser);
}
