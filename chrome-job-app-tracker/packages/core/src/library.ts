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

const InvariantsFile = z.object({ invariants: z.array(z.string()).default([]) });

/**
 * Read the hard truths list. Missing file or bad shape means no invariants,
 * never a crash — the tailor simply gets no negative facts.
 */
export function loadInvariants(root: string): string[] {
  try {
    const raw = readFileSync(path.join(root, "content", "invariants.yml"), "utf8");
    return InvariantsFile.parse(yaml.load(raw)).invariants;
  } catch {
    return [];
  }
}

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
 * A recycled URL (rolling intakes) matches every term's folder; folders
 * sort newest-first, so the current application wins.
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
  entries = entries.filter((e) => !e.startsWith(".")).sort().reverse();
  for (const e of entries) {
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

/**
 * Saved job.md body (posting text after the front-matter block) for a
 * tracked folder. `null` when the file is missing or unparsable — the
 * caller then treats the posting as changed, which keeps the form.
 */
export function readSavedDescription(root: string, folder: string): string | null {
  try {
    const job = readFileSync(path.join(root, folder, "job.md"), "utf8");
    const lines = job.split("\n");
    if (lines[0] !== "---") return job.trim() || null;
    const end = lines.indexOf("---", 1);
    if (end === -1) return null;
    const body = lines.slice(end + 1).join("\n").trim();
    return body || null;
  } catch {
    return null;
  }
}
