import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { canonicalPostingUrl } from "@jat/shared";
import type { LibraryProject } from "@jat/shared";

const ProjectsFile = z.object({
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      bullets: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
    }),
  ),
});

/**
 * Read the master bullet library. Unknown keys (e.g. `track`) are ignored.
 */
export function loadLibrary(root: string): LibraryProject[] {
  const raw = readFileSync(path.join(root, "content", "projects.yml"), "utf8");
  const parsed = ProjectsFile.parse(yaml.load(raw));
  return parsed.projects.map((p) => ({
    id: p.id,
    name: p.name,
    bullets: p.bullets.map((b) => ({ id: b.id, text: b.text })),
  }));
}

/**
 * Find the tracked application whose `job.md` records the given posting URL.
 * Reads front-matter, not the CSV — one source of truth for the lookup.
 *
 * @returns repo-relative folder, or `null` when the URL was never captured
 */
export function findByUrl(root: string, url: string): string | null {
  const want = canonicalPostingUrl(url.trim());
  if (!want) return null;
  let entries: string[];
  try {
    entries = readdirSync(path.join(root, "applications"));
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.startsWith(".")) continue;
    try {
      const job = readFileSync(path.join(root, "applications", e, "job.md"), "utf8");
      const m = /^url:\s*"([^"]*)"/m.exec(job);
      if (m && canonicalPostingUrl(m[1]) === want) return `applications/${e}`;
    } catch {
      continue;
    }
  }
  return null;
}
