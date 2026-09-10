import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentEnabled,
  agentMaxSteps,
  agentModel,
  agentTimeoutMs,
  buildAgentPrompt,
  countDraftBullets,
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
        expect(bin).toBe("muse");
        expect(args).toContain("--yolo");
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
