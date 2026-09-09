import { spawnSync } from "node:child_process";
import path from "node:path";
import type { CaptureRequest } from "@jat/shared";

export interface ScaffoldResult {
  /** Repo-relative folder, e.g. applications/2026-09-09_acme_backend-engineer */
  folder: string;
  output: string;
}

/**
 * Scaffold via bin/add-job — the same script a human runs, so the folder,
 * job.md, notes.md, and CSV row stay identical no matter how capture starts.
 */
export function scaffold(root: string, req: CaptureRequest): ScaffoldResult {
  const addJob = path.join(root, "bin", "add-job");
  const r = spawnSync(
    addJob,
    [req.url, "-c", req.company, "-R", req.role, "-t", req.track, "-r", req.region, "-d", "-"],
    { input: req.description, encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`add-job failed: ${(r.stderr || r.stdout || "unknown error").trim()}`);
  }
  const m = /^created applications\/(\S+)/m.exec(r.stdout ?? "");
  if (!m) throw new Error(`add-job output unparseable: ${(r.stdout ?? "").trim()}`);
  return { folder: `applications/${m[1]}`, output: (r.stdout ?? "").trim() };
}

export type Runner = (cmd: string, args: string[]) => { status: number | null; stdout: string };

/** Verify the starter resume still compiles to one page.
 *  The folder is resolved against the repo root so callers never depend on cwd. */
export function verifyBuild(
  root: string,
  folder: string,
  run: Runner = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: r.status, stdout: `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim() };
  },
): { ok: boolean; output: string } {
  const r = run(path.join(root, "bin", "build.sh"), [path.join(root, folder)]);
  return { ok: r.status === 0, output: r.stdout.trim() };
}
