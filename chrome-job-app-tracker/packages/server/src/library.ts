import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
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

/** Read the master bullet library. Unknown keys (e.g. `track`) are ignored. */
export async function loadLibrary(root: string): Promise<LibraryProject[]> {
  const raw = await readFile(path.join(root, "content", "projects.yml"), "utf8");
  const parsed = ProjectsFile.parse(yaml.load(raw));
  return parsed.projects.map((p) => ({
    id: p.id,
    name: p.name,
    bullets: p.bullets.map((b) => ({ id: b.id, text: b.text })),
  }));
}
