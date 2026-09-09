import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts");

function run(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync("bun", [entry, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

describe("ja", () => {
  it("prints help with all subcommands", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    for (const cmd of ["add", "build", "list", "status", "server", "probe"]) {
      expect(r.out).toContain(cmd);
    }
  });

  it("documents flag defaults in subcommand help", () => {
    const add = run("add", "--help");
    expect(add.status).toBe(0);
    for (const flag of [
      "-c company",
      "-R role",
      "-t swe|csa",
      "-a us|ca|uk",
      "-d file|-",
      "--root DIR",
    ]) {
      expect(add.out).toContain(flag);
    }
    expect(add.out).not.toContain("-r us|ca|uk");
    const server = run("server", "--help");
    expect(server.status).toBe(0);
    expect(server.out).toContain("8765");
  });

  it("shows a sparse menu with no args and the full menu with --help", () => {
    const bare = run();
    expect(bare.status).toBe(0);
    for (const cmd of ["add", "build", "list", "status", "server", "probe"]) {
      expect(bare.out).toContain(cmd);
    }
    expect(bare.out).toContain("full flags and defaults");
    expect(bare.out).toContain("Create a new job application");
    expect(bare.out).toContain("applications\n");
    expect(bare.out).toContain("README.md\n");
    expect(bare.out.startsWith("\n")).toBe(true);
    expect(bare.out.endsWith("\n\n")).toBe(true);
    expect(bare.out).not.toContain("8765");
    expect(bare.out).not.toContain("one CLI");
    const full = run("--help");
    expect(full.out).toContain("8765");
    expect(full.out).toContain("-a us|ca|uk");
    expect(full.out.length).toBeGreaterThan(bare.out.length);
  });

  it("explains status with an example", () => {
    const r = run("status", "--help");
    expect(r.status).toBe(0);
    expect(r.out).toContain("ja status applications/");
    expect(r.out).toContain("interviewing");
  });

  it("filters list by status and stays plain when piped", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-list-"));
    try {
      await writeFile(
        path.join(dir, "applications.csv"),
        "date,company,role,track,region,status,url,folder\n" +
          '"2026-09-01","Acme","Engineer","swe","uk","applied","https://x","2026-09-01_acme_engineer"\n' +
          '"2026-09-02","Beta","Analyst","csa","us","rejected","https://y","2026-09-02_beta_analyst"\n',
      );
      const help = run("list", "--help");
      expect(help.status).toBe(0);
      expect(help.out).toContain("--status");
      const bad = run("--root", dir, "list", "--status", "hired");
      expect(bad.status).not.toBe(0);
      const r = run("--root", dir, "list", "--status", "applied");
      expect(r.status).toBe(0);
      expect(r.out).toContain("Acme");
      expect(r.out).not.toContain("Beta");
      expect(r.out).not.toContain("\x1b[");
      expect(r.out.startsWith("\n")).toBe(true);
      expect(r.out.endsWith("\n\n")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
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
