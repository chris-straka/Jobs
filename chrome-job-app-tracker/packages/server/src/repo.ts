import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The Jobs repo root. Override with REPO_ROOT (the server test-suite does).
 * Default assumes this checkout layout: <root>/chrome-job-app-tracker/packages/server/src.
 */
export function repoRoot(): string {
  return process.env.REPO_ROOT ?? path.resolve(import.meta.dir, "../../../..");
}

/**
 * Load `chrome-job-app-tracker/.env` without overriding real environment
 * variables. Bun auto-loads `.env` from the *working directory*, which is
 * the package dir under `bun run --filter` — not where the `.env` lives —
 * so this makes key loading independent of how the server was launched.
 * Never called by the test-suite (tests must stay offline).
 */
export function loadTrackerEnv(trackerDir = path.resolve(import.meta.dir, "..", "..", "..")): void {
  let text: string;
  try {
    text = readFileSync(path.join(trackerDir, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    process.env[m[1]] ??= v;
  }
}

export function serverPort(): number {
  return Number(process.env.PORT ?? 8765);
}
