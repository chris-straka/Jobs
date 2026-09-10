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
  opts: { cwd: string; timeoutMs: number; onJsonLine?: (obj: unknown) => void },
) => Promise<AgentResult>;

const OUTPUT_CAP = 32768;
const cap = (s: string): string => (s.length > OUTPUT_CAP ? s.slice(-OUTPUT_CAP) : s);

/**
 * Mid-run stage from one `--json` event. Observed task kinds: tool.read_file,
 * tool.write_file, tool.bash, model.meta.response (reminder.* is ignored).
 * Unknown shapes stay quiet — the popup keeps its last label.
 */
export function stageFromEvent(obj: unknown): string | null {
  if (typeof obj !== "object" || obj === null) return null;
  const payload = (obj as { payload?: unknown }).payload as
    { kind?: unknown; event?: { kind?: unknown; task_kind?: unknown } } | undefined;
  if (payload?.kind === "run_started") return "agent";
  const ev = payload?.event;
  if (!ev || ev.kind !== "proposed" || typeof ev.task_kind !== "string") return null;
  const k = ev.task_kind;
  if (k.startsWith("tool.read")) return "agent-read";
  if (k.startsWith("tool.write") || k.startsWith("tool.edit")) return "agent-write";
  if (k.startsWith("tool.bash") || k.includes("shell")) return "agent-run";
  if (k.includes("model")) return "agent-think";
  return null;
}

export function defaultSpawn(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; onJsonLine?: (obj: unknown) => void },
): Promise<AgentResult> {
  return new Promise((resolve) => {
    let finished = false;
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    const done = (timedOut: boolean, code: number | null): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, timedOut, stdout, stderr });
    };
    const child = spawn(bin, args, { cwd: opts.cwd });
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout = cap(stdout + s);
      if (!opts.onJsonLine) return;
      lineBuf += s;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("{")) continue;
        try {
          opts.onJsonLine(JSON.parse(t));
        } catch {
          // Not JSON — stdout stays the debug record.
        }
      }
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
    "--json",
    prompt,
  ];
  // Human text streamed as run_output_delta doubles as the failure record;
  // without it (crash before any delta) the raw JSONL is the fallback.
  let deltas = "";
  const onJsonLine = (obj: unknown): void => {
    if (typeof obj !== "object" || obj === null) return;
    const payload = (obj as { payload?: unknown }).payload as
      { kind?: unknown; text?: unknown } | undefined;
    if (payload?.kind === "run_output_delta" && typeof payload.text === "string") {
      deltas = cap(deltas + payload.text);
    }
    const stage = stageFromEvent(obj);
    if (stage) opts.onStage(stage);
  };
  const r = await (opts.spawnFn ?? defaultSpawn)(bin, args, {
    cwd: opts.root,
    timeoutMs: agentTimeoutMs(env),
    onJsonLine,
  });
  const raw = deltas.trim() ? deltas.slice(-4000) : `${r.stdout}\n${r.stderr}`.slice(-4000);
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
