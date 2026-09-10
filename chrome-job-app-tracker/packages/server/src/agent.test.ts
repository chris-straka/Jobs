import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentEnabled,
  agentMaxSteps,
  agentModel,
  agentReasoningEffort,
  agentTimeoutMs,
  buildAgentPrompt,
  childEnv,
  countDraftBullets,
  defaultSpawn,
  resolveBin,
  runAgentTailor,
  stageFromEvent,
} from "./agent.js";

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("agent tailoring", () => {
  it("reads env config with spark defaults", () => {
    expect(agentEnabled({})).toBe(true);
    expect(agentEnabled({ JAT_AGENT: "0" })).toBe(false);
    expect(agentModel({})).toBe("muse-spark-1.3-contributor");
    expect(agentModel({ JAT_AGENT_MODEL: "x" })).toBe("x");
    expect(agentTimeoutMs({})).toBe(540000);
    expect(agentTimeoutMs({ JAT_AGENT_TIMEOUT_MS: "nope" })).toBe(540000);
    expect(agentMaxSteps({})).toBe(50);
    expect(agentReasoningEffort({})).toBe(null);
    expect(agentReasoningEffort({ JAT_AGENT_REASONING_EFFORT: "medium" })).toBe("medium");
    expect(agentReasoningEffort({ JAT_AGENT_REASONING_EFFORT: "extreme" })).toBe(null);
  });

  it("passes reasoning effort only when explicitly set", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-effort-"));
    tmpDirs.push(tmp);
    const folder = "applications/2026-09-09_acme_x";
    await mkdir(path.join(tmp, folder), { recursive: true });
    await writeFile(path.join(tmp, folder, "notes.md"), "# Acme — X\n");
    const seen: string[][] = [];
    const base = {
      root: tmp,
      folder,
      track: "swe",
      region: "ca",
      fitOrder: ["telemetry"],
      knownBullets: ["arch"],
      onStage: () => {},
    };
    const run = async (env: NodeJS.ProcessEnv): Promise<void> => {
      await runAgentTailor({
        ...base,
        env,
        spawnFn: async (_bin, args) => {
          seen.push(args);
          return { exitCode: 0, timedOut: false, stdout: "done", stderr: "" };
        },
      });
    };
    await run({});
    await run({ JAT_AGENT_REASONING_EFFORT: "low" });
    expect(seen[0]).not.toContain("--reasoning-effort");
    const i = seen[1].indexOf("--reasoning-effort");
    expect(i).toBeGreaterThan(-1);
    expect(seen[1][i + 1]).toBe("low");
  });

  it("resolves the binary beyond a stripped PATH", async () => {
    expect(resolveBin("/opt/custom/muse", {})).toBe("/opt/custom/muse");
    expect(resolveBin("definitely-not-a-real-bin", { PATH: "" })).toBe("definitely-not-a-real-bin");
    // A bare name found via PATH wins without falling through.
    const dir = await mkdtemp(path.join(tmpdir(), "jat-bin-"));
    tmpDirs.push(dir);
    await writeFile(path.join(dir, "jat-fake-muse"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    expect(resolveBin("jat-fake-muse", { PATH: dir })).toBe(path.join(dir, "jat-fake-muse"));
  });

  it("scrubs secrets from the child env but keeps a working PATH", () => {
    const out = childEnv({
      PATH: "/usr/bin",
      HOME: "/Users/c",
      USER: "c",
      MODEL_API_KEY: "secret",
      META_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      JAT_AGENT_MAX_STEPS: "50",
      LANG: "en_US.UTF-8",
    });
    expect(out.MODEL_API_KEY).toBeUndefined();
    expect(out.META_API_KEY).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.HOME).toBe("/Users/c");
    expect(out.JAT_AGENT_MAX_STEPS).toBe("50");
    expect(out.PATH ?? "").toContain("/usr/bin");
    expect(out.PATH ?? "").toContain(".local/bin");
  });

  it("spawned children cannot see parent secrets", async () => {
    process.env.PARENT_SECRET_VALUE = "parent-secret-value";
    try {
      const r = await defaultSpawn(
        "/bin/sh",
        ["-c", 'echo "PATH=$PATH KEY=$PARENT_SECRET_VALUE"'],
        {
          cwd: "/tmp",
          timeoutMs: 10000,
        },
      );
      expect(r.exitCode).toBe(0);
      expect(r.stdout).not.toContain("parent-secret-value");
      expect(r.stdout).toContain(".local/bin");
    } finally {
      delete process.env.PARENT_SECRET_VALUE;
    }
  });

  it("briefs the repo files instead of pasting the library", () => {
    const prompt = buildAgentPrompt({
      root: "/jobs",
      folder: "applications/2026-09-09_acme_x",
      track: "swe",
      region: "ca",
      fitOrder: ["telemetry", "dbmodel"],
    });
    expect(prompt).toContain("applications/2026-09-09_acme_x/job.md");
    expect(prompt).toContain("telemetry, dbmodel");
    expect(prompt).toContain("never invent");
    expect(prompt).toContain("content/invariants.yml");
    expect(prompt).toContain("Work only inside applications/2026-09-09_acme_x/.");
    expect(prompt).not.toContain("Architected an event-driven");
  });

  it("counts only library ids inside bullets groups", () => {
    const typ = `#resume(track: "swe", summary: "Uses arch and observability daily.",
      projects: ((id: "telemetry", bullets: ("arch", "sql",)),))`;
    expect(countDraftBullets(typ, ["arch", "sql", "observability"])).toBe(2);
    expect(countDraftBullets("no groups here", ["arch"])).toBe(0);
  });

  it("verifies agent output and reports stages", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-agent-"));
    tmpDirs.push(tmp);
    const folder = "applications/2026-09-09_acme_x";
    await mkdir(path.join(tmp, folder), { recursive: true });
    await writeFile(path.join(tmp, folder, "notes.md"), "# Acme — X\n");
    const stages: string[] = [];
    const run = await runAgentTailor({
      root: tmp,
      folder,
      track: "swe",
      region: "ca",
      fitOrder: ["telemetry"],
      knownBullets: ["arch", "sql"],
      onStage: (s) => void stages.push(s),
      env: {},
      spawnFn: async (bin, args) => {
        expect(bin.endsWith("/muse")).toBe(true);
        expect(args).not.toContain("--yolo");
        expect(args).toContain("--approval-mode");
        expect(args).toContain("never");
        expect(args).toContain("--disable-web-tools");
        expect(args).toContain(tmp);
        await writeFile(
          path.join(tmp, folder, "resume.typ"),
          '(id: "telemetry", bullets: ("arch", "sql",))',
        );
        await writeFile(
          path.join(tmp, folder, "notes.md"),
          "# Acme — X\n\n## Interview prep\n\nPrep.\n",
        );
        return { exitCode: 0, timedOut: false, stdout: "done", stderr: "" };
      },
    });
    expect(stages).toEqual(["agent"]);
    expect(run).toEqual({ draftWritten: true, bullets: 2, notesWritten: true, raw: "done\n" });
  });

  it("reports cancelled instead of verifying when aborted", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-cancel-"));
    tmpDirs.push(tmp);
    const stages: string[] = [];
    const ac = new AbortController();
    ac.abort();
    const run = await runAgentTailor({
      root: tmp,
      folder: "applications/2026-09-09_acme_x",
      track: "swe",
      region: "ca",
      fitOrder: [],
      knownBullets: [],
      onStage: (s) => void stages.push(s),
      env: {},
      signal: ac.signal,
      spawnFn: () => new Promise(() => {}),
    });
    expect(run).toEqual({ draftWritten: false, bullets: 0, notesWritten: false, raw: "cancelled by user" });
    // The run started (agent stage) then cancelled before any tool stages.
    expect(stages).toEqual(["agent"]);
  });

  it("aborts a live child on signal", async () => {
    const ac = new AbortController();
    const pending = defaultSpawn("sleep", ["30"], {
      cwd: tmpdir(),
      timeoutMs: 60000,
      signal: ac.signal,
    });
    await new Promise((r) => setTimeout(r, 200));
    ac.abort();
    const r = await pending;
    expect(r.exitCode).toBe(-1);
    expect(r.timedOut).toBe(false);
  });

  it("refuses to spawn when already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await defaultSpawn("sleep", ["30"], {
      cwd: tmpdir(),
      timeoutMs: 5000,
      signal: ac.signal,
    });
    expect(r).toEqual({ exitCode: -1, timedOut: false, stdout: "", stderr: "cancelled" });
  });

  it("maps observed event shapes to stages, ignoring reminders", () => {
    const proposed = (task_kind: string): unknown => ({
      payload: { kind: "x", event: { kind: "proposed", task_kind } },
    });
    expect(stageFromEvent({ payload: { kind: "run_started" } })).toBe("agent");
    expect(stageFromEvent(proposed("tool.read_file"))).toBe("agent-read");
    expect(stageFromEvent(proposed("tool.write_file"))).toBe("agent-write");
    expect(stageFromEvent(proposed("tool.edit_file"))).toBe("agent-write");
    expect(stageFromEvent(proposed("tool.bash"))).toBe("agent-run");
    expect(stageFromEvent(proposed("model.meta.response"))).toBe("agent-think");
    expect(stageFromEvent(proposed("reminder.agent.skill-reminder"))).toBeNull();
    expect(stageFromEvent(proposed("tool.unknown_future"))).toBeNull();
    expect(stageFromEvent({})).toBeNull();
    expect(stageFromEvent(null)).toBeNull();
  });

  it("streams deltas into raw text and event stages", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-agent-json-"));
    tmpDirs.push(tmp);
    const folder = "applications/2026-09-09_acme_x";
    await mkdir(path.join(tmp, folder), { recursive: true });
    await writeFile(path.join(tmp, folder, "notes.md"), "# Acme — X\n");
    const stages: string[] = [];
    const run = await runAgentTailor({
      root: tmp,
      folder,
      track: "swe",
      region: "ca",
      fitOrder: [],
      knownBullets: ["arch"],
      onStage: (s) => void stages.push(s),
      env: {},
      spawnFn: async (_bin, _args, opts) => {
        // A --json stdout: deltas become raw, tool events become stages.
        opts.onJsonLine?.({ payload: { kind: "run_output_delta", text: "tailoring " } });
        opts.onJsonLine?.({
          payload: { kind: "x", event: { kind: "proposed", task_kind: "tool.write_file" } },
        });
        opts.onJsonLine?.({ payload: { kind: "run_output_delta", text: "done" } });
        await writeFile(path.join(tmp, folder, "resume.typ"), '(bullets: ("arch",))');
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    });
    expect(run.raw).toBe("tailoring done");
    expect(stages).toEqual(["agent", "agent-write"]);
    expect(run.draftWritten).toBe(true);
  });

  it("reports failure when the agent exits nonzero", async () => {
    const run = await runAgentTailor({
      root: "/nonexistent",
      folder: "applications/x",
      track: "swe",
      region: "ca",
      fitOrder: [],
      knownBullets: [],
      onStage: () => {},
      env: {},
      spawnFn: async () => ({ exitCode: 1, timedOut: false, stdout: "", stderr: "boom" }),
    });
    expect(run.draftWritten).toBe(false);
    expect(run.notesWritten).toBe(false);
    expect(run.raw).toContain("boom");
  });
});
