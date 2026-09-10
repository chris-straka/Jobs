import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const ProjectsFile = z.object({
  projects: z.array(
    z.object({
      bullets: z.array(z.object({ id: z.string(), text: z.string() })).default([]),
    }),
  ),
});

/** Bullet ids whose text starts with "TODO:" — never compilable. */
export function todoIds(root: string): string[] {
  const raw = readFileSync(path.join(root, "content", "projects.yml"), "utf8");
  const parsed = ProjectsFile.parse(yaml.load(raw));
  return parsed.projects.flatMap((p) =>
    p.bullets.filter((b) => b.text.startsWith("TODO:")).map((b) => b.id),
  );
}

export type Runner = (cmd: string, args: string[]) => { status: number | null; output: string };

const TYPST_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")];

/**
 * Servers spawned outside a shell (native host, LaunchAgents) inherit a
 * skeletal PATH without typst. These are the only other places it lives.
 */
function withTypstPath(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const d of TYPST_PATHS) if (!parts.includes(d)) parts.push(d);
  return { ...process.env, PATH: parts.join(":") };
}

function defaultRunner(cmd: string, args: string[]): { status: number | null; output: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: withTypstPath() });
  return { status: r.status, output: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim() };
}

export interface BuildReport {
  ok: boolean;
  lines: string[];
}

/**
 * Compile resumes and enforce one page. Inputs are `resume.typ` paths or
 * application folders (relative to root or absolute). Mirrors `bin/build.sh`
 * output line-for-line (`ok` / `MISSING` / `TODO` / `FAILED` / `PAGES`).
 */
export function buildResumes(
  root: string,
  inputs: string[],
  run: Runner = defaultRunner,
): BuildReport {
  const lines: string[] = [];
  let fail = false;

  const hasTypst = ((): boolean => {
    try {
      const r = spawnSync("typst", ["--version"], { encoding: "utf8", env: withTypstPath() });
      return r.status === 0;
    } catch {
      return false;
    }
  })();
  if (!hasTypst) {
    return { ok: false, lines: ["error: typst not found. Install it with:  brew install typst"] };
  }

  const ids = todoIds(root);
  const usesTodo = (text: string): string | null =>
    ids.find((id) => text.includes(`"${id}"`)) ?? null;

  const defaultsPath = path.join(root, "content", "defaults.yml");
  if (existsSync(defaultsPath)) {
    const hit = usesTodo(readFileSync(defaultsPath, "utf8"));
    if (hit) {
      lines.push(`  TODO     content/defaults.yml uses the not-yet-true bullet "${hit}"`);
      fail = true;
    }
  }

  const targets = inputs.map((a) => {
    const abs = path.isAbsolute(a) ? a : path.join(root, a);
    const dir = abs.endsWith(".typ") ? path.dirname(abs) : abs;
    return { typ: path.join(dir, "resume.typ"), out: path.join(dir, "chris-straka-resume.pdf") };
  });

  for (const t of targets) {
    const rel = path.relative(root, t.typ) || t.typ;
    if (!existsSync(t.typ)) {
      lines.push(`  MISSING  ${rel}`);
      fail = true;
      continue;
    }
    const hit = usesTodo(readFileSync(t.typ, "utf8"));
    if (hit) {
      lines.push(`  TODO     ${rel}  <- selects "${hit}", which is not true yet`);
      fail = true;
      continue;
    }
    const r = run("typst", ["compile", "--root", root, t.typ, t.out]);
    if (r.status !== 0) {
      lines.push(`  FAILED   ${rel}`);
      for (const l of r.output.split("\n")) if (l.trim()) lines.push(`           ${l}`);
      fail = true;
      continue;
    }
    // Typst writes an uncompressed page tree, so /Count is greppable.
    const pdf = readFileSync(t.out, "latin1");
    const m = /\/Count (\d+)/.exec(pdf);
    const pages = m ? Number(m[1]) : 1;
    if (pages > 1) {
      lines.push(`  ${pages} PAGES  ${rel}  <- turn down leading/bullet-gap or cut a bullet`);
      fail = true;
    } else {
      lines.push(`  ok       ${path.relative(root, t.out)}`);
    }
  }
  return { ok: !fail, lines };
}
