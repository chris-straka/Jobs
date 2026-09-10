import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Agent tailoring per save: opt out with `JAT_AGENT=0` (single model call). */
export function agentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JAT_AGENT !== "0";
}

export function agentModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.JAT_AGENT_MODEL ?? "muse-spark-1.3-contributor";
}

export function agentTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.JAT_AGENT_TIMEOUT_MS ?? 540000);
  return Number.isFinite(n) && n > 0 ? n : 540000;
}

export function agentMaxSteps(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.JAT_AGENT_MAX_STEPS ?? 50);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export interface AgentPromptInput {
  root: string;
  folder: string;
  track: string;
  region: string;
  fitOrder: string[];
}

/**
 * The headless tailoring brief. It points at repo files instead of pasting
 * them: the agent reads AGENTS.md (the procedure), job.md (the posting),
 * and content/projects.yml (the only bullet source) with workspace tools.
 */
export function buildAgentPrompt(input: AgentPromptInput): string {
  return [
    `You are tailoring a resume in the Jobs repo at ${input.root}.`,
    `Read AGENTS.md ("The main task: tailoring a resume to a posting") and follow it exactly — it is the procedure.`,
    `The posting is already saved at ${input.folder}/job.md.`,
    `Fit ranking, best project first: ${input.fitOrder.join(", ") || "none"}.`,
    `1. Write ${input.folder}/resume.typ using the summary/skills/projects levers (track "${input.track}", region "${input.region}").`,
    `2. Compile until it is exactly one page: typst compile --root . ${input.folder}/resume.typ ${input.folder}/chris-straka-resume.pdf (or: ja build ${input.folder}).`,
    `3. Append interview notes to ${input.folder}/notes.md under the existing template: What's missing (posting requirements the bullet library doesn't cover), Interview prep (what to expect, grounded in the posting), Notes (anything else worth knowing).`,
    `Hard rules: every bullet id must already exist in content/projects.yml — never invent experience or ids. Never edit content/ or templates/. Work only inside ${input.folder}/.`,
  ].join("\n");
}

export interface AgentResult {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<AgentResult>;

const OUTPUT_CAP = 32768;
const cap = (s: string): string => (s.length > OUTPUT_CAP ? s.slice(-OUTPUT_CAP) : s);

export function defaultSpawn(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<AgentResult> {
  return new Promise((resolve) => {
    let finished = false;
    let stdout = "";
    let stderr = "";
    const done = (timedOut: boolean, code: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, timedOut, stdout, stderr });
    };
    const child = spawn(bin, args, { cwd: opts.cwd });
    child.stdout.on("data", (d: Buffer) => {
      stdout = cap(stdout + d.toString());
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = cap(stderr + d.toString());
    });
    child.on("error", (err) => {
      stderr = cap(`${stderr}${String(err)}`);
      done(false, null);
    });
    child.on("close", (code) => done(false, code));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(true, null);
    }, opts.timeoutMs);
  });
}

export interface TailorRun {
  draftWritten: boolean;
  /** Library-known bullet ids referenced inside bullets:(...) groups. */
  bullets: number;
  notesWritten: boolean;
  raw: string;
}

/** Count ids the library knows, scoped to bullets:(...) so prose can't inflate it. */
export function countDraftBullets(resumeTyp: string, knownBullets: string[]): number {
  const known = new Set(knownBullets);
  const hits = new Set<string>();
  for (const group of resumeTyp.matchAll(/bullets:\s*\(([^)]*)\)/g)) {
    for (const m of group[1].matchAll(/"([^"]+)"/g)) {
      if (known.has(m[1])) hits.add(m[1]);
    }
  }
  return hits.size;
}

export async function runAgentTailor(opts: {
  root: string;
  folder: string;
  track: string;
  region: string;
  fitOrder: string[];
  knownBullets: string[];
  onStage: (stage: string) => void;
  spawnFn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
}): Promise<TailorRun> {
  const env = opts.env ?? process.env;
  const prompt = buildAgentPrompt({
    root: opts.root,
    folder: opts.folder,
    track: opts.track,
    region: opts.region,
    fitOrder: opts.fitOrder,
  });
  opts.onStage("agent");
  const bin = env.JAT_AGENT_BIN ?? "muse";
  const args = [
    "exec",
    "--yolo",
    "--workspace",
    opts.root,
    "--model",
    agentModel(env),
    "--max-model-steps",
    String(agentMaxSteps(env)),
    "--no-session-log",
    prompt,
  ];
  const r = await (opts.spawnFn ?? defaultSpawn)(bin, args, {
    cwd: opts.root,
    timeoutMs: agentTimeoutMs(env),
  });
  const raw = `${r.stdout}\n${r.stderr}`.slice(-4000);
  if (r.exitCode !== 0) return { draftWritten: false, bullets: 0, notesWritten: false, raw };
  let bullets: number;
  try {
    bullets = countDraftBullets(
      readFileSync(path.join(opts.root, opts.folder, "resume.typ"), "utf8"),
      opts.knownBullets,
    );
  } catch {
    return { draftWritten: false, bullets: 0, notesWritten: false, raw };
  }
  let notesWritten = false;
  try {
    const notes = readFileSync(path.join(opts.root, opts.folder, "notes.md"), "utf8");
    notesWritten = notes.includes("## Interview prep") || notes.includes("## What's missing");
  } catch {
    // Missing or unreadable notes — notesWritten stays false.
  }
  return { draftWritten: bullets > 0, bullets, notesWritten, raw };
}
