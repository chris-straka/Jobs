import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts");

function run(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync("bun", [entry, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

describe("japp", () => {
  it("prints help with all subcommands", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    for (const cmd of ["add", "build", "list", "status", "server", "probe"]) {
      expect(r.out).toContain(cmd);
    }
  });

  it("rejects unknown commands", () => {
    const r = run("frobnicate");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("unknown command");
  });

  it("lists an empty tracker without failing", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-cli-"));
    try {
      const r = run("--root", dir, "list");
      expect(r.status).toBe(0);
      expect(r.out).toContain("no applications yet");
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });
});
