import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { IneligibleList, normalizeIneligibleUrls } from "@jat/shared";

const INELIGIBLE_DIR = ".jat";
const INELIGIBLE_FILE = "ineligible.json";

function ineligiblePath(root: string): string {
  return path.join(root, INELIGIBLE_DIR, INELIGIBLE_FILE);
}

/** Canonicalized, deduped, sorted posting URLs — stable on disk for clean diffs. */
export function normalizeIneligible(list: IneligibleList): IneligibleList {
  return { ineligible: normalizeIneligibleUrls(list.ineligible) };
}

export function mergeIneligible(a: IneligibleList, b: IneligibleList): IneligibleList {
  return normalizeIneligible({ ineligible: [...a.ineligible, ...b.ineligible] });
}

/** Strict shape only — there is no legacy form. Null when it doesn't match. */
export function parseIneligible(body: unknown): IneligibleList | null {
  const strict = IneligibleList.safeParse(body);
  if (!strict.success) return null;
  return normalizeIneligible(strict.data);
}

/**
 * Durable ineligible-postings list. A missing or corrupt file reads as
 * empty — the dashboard merge heals it from browser storage on next load.
 */
export function readIneligible(root: string): IneligibleList {
  try {
    const parsed = parseIneligible(JSON.parse(readFileSync(ineligiblePath(root), "utf8")));
    if (!parsed) return { ineligible: [] };
    return parsed;
  } catch {
    return { ineligible: [] };
  }
}

export function writeIneligible(root: string, list: IneligibleList): void {
  mkdirSync(path.join(root, INELIGIBLE_DIR), { recursive: true });
  writeFileSync(ineligiblePath(root), `${JSON.stringify(normalizeIneligible(list), null, 2)}\n`);
}
