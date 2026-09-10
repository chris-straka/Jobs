import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { FalsePositives } from "@jat/shared";

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

export function normalizeFalsePositives(list: FalsePositives): FalsePositives {
  return { falsePositives: normalizeHosts(list.falsePositives) };
}

export function mergeFalsePositives(a: FalsePositives, b: FalsePositives): FalsePositives {
  return normalizeFalsePositives({ falsePositives: [...a.falsePositives, ...b.falsePositives] });
}

/**
 * Tolerant parse: the current `{ falsePositives }` shape, or the retired
 * split `{ fpReported, fpHosts }` shape unioned into it. Null when neither
 * matches.
 */
export function parseFalsePositives(body: unknown): FalsePositives | null {
  const strict = FalsePositives.safeParse(body);
  if (strict.success) return normalizeFalsePositives(strict.data);
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    if ("fpReported" in o || "fpHosts" in o) {
      return normalizeFalsePositives({
        falsePositives: [...normalizeHosts(o["fpReported"]), ...normalizeHosts(o["fpHosts"])],
      });
    }
  }
  return null;
}

/**
 * Durable false-positives list. A missing or corrupt file reads as empty —
 * the dashboard merge heals it from browser storage on next load. A legacy
 * split-shape file reads unioned and is rewritten in the new shape on next
 * write.
 */
export function readFalsePositives(root: string): FalsePositives {
  try {
    const parsed = parseFalsePositives(JSON.parse(readFileSync(ignorePath(root), "utf8")));
    if (!parsed) return { falsePositives: [] };
    return parsed;
  } catch {
    return { falsePositives: [] };
  }
}

export function writeFalsePositives(root: string, list: FalsePositives): void {
  mkdirSync(path.join(root, IGNORE_DIR), { recursive: true });
  writeFileSync(ignorePath(root), `${JSON.stringify(normalizeFalsePositives(list), null, 2)}\n`);
}
