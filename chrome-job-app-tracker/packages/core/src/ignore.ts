import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IgnoreLists } from "@jat/shared";

const IGNORE_DIR = ".jat";
const IGNORE_FILE = "ignore.json";

function ignorePath(root: string): string {
  return path.join(root, IGNORE_DIR, IGNORE_FILE);
}

/** Lowercase, trimmed, deduped, sorted — stable on disk for clean diffs. */
export function normalizeHosts(hosts: unknown): string[] {
  if (!Array.isArray(hosts)) return [];
  return [
    ...new Set(
      hosts
        .filter((h): h is string => typeof h === "string")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
    ),
  ].sort();
}

export function normalizeIgnoreLists(lists: IgnoreLists): IgnoreLists {
  return { fpReported: normalizeHosts(lists.fpReported), fpHosts: normalizeHosts(lists.fpHosts) };
}

export function mergeIgnoreLists(a: IgnoreLists, b: IgnoreLists): IgnoreLists {
  return normalizeIgnoreLists({
    fpReported: [...a.fpReported, ...b.fpReported],
    fpHosts: [...a.fpHosts, ...b.fpHosts],
  });
}

/**
 * Durable mute lists. A missing or corrupt file reads as empty — the
 * dashboard merge heals it from browser storage on next load.
 */
export function readIgnoreLists(root: string): IgnoreLists {
  try {
    const parsed = IgnoreLists.safeParse(
      JSON.parse(readFileSync(ignorePath(root), "utf8")),
    );
    if (!parsed.success) return { fpReported: [], fpHosts: [] };
    return normalizeIgnoreLists(parsed.data);
  } catch {
    return { fpReported: [], fpHosts: [] };
  }
}

export function writeIgnoreLists(root: string, lists: IgnoreLists): void {
  mkdirSync(path.join(root, IGNORE_DIR), { recursive: true });
  writeFileSync(ignorePath(root), `${JSON.stringify(normalizeIgnoreLists(lists), null, 2)}\n`);
}
