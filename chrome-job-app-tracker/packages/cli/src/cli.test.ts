import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.ts");
const trackerRoot = path.resolve(path.dirname(entry), "..", "..", "..");

function run(...args: string[]): { status: number | null; out: string } {
  const r = spawnSync("bun", [entry, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

function runWithEnv(env: Record<string, string>, ...args: string[]) {
  const r = spawnSync("bun", [entry, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

describe("ja", () => {
  it("prints help with all subcommands", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    for (const cmd of [
      "add",
      "build",
      "list",
      "status",
      "server",
      "probe",
      "extension",
      "install-host",
    ]) {
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
    for (const cmd of [
      "add",
      "build",
      "list",
      "status",
      "server",
      "probe",
      "extension",
      "install-host",
    ]) {
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
      expect(r.out).toContain("UK");
      expect(r.out).not.toContain("\x1b[");
      expect(r.out.startsWith("\n")).toBe(true);
      expect(r.out.endsWith("\n\n")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("copies list to the clipboard via a PATH shim", async () => {
    const { mkdtemp, mkdir, rm, writeFile, chmod, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-clip-"));
    try {
      await writeFile(
        path.join(dir, "applications.csv"),
        "date,company,role,track,region,status,url,folder\n" +
          '"2026-09-01","Acme","Engineer","swe","uk","applied","https://x","2026-09-01_acme_engineer"\n' +
          '"2026-09-02","Beta","Analyst","csa","us","rejected","https://y","2026-09-02_beta_analyst"\n',
      );
      const bin = path.join(dir, "bin");
      await mkdir(bin);
      const pasted = path.join(dir, "paste.txt");
      await writeFile(path.join(bin, "pbcopy"), `#!/bin/sh\ncat > '${pasted}'\n`);
      await chmod(path.join(bin, "pbcopy"), 0o755);
      const r = runWithEnv(
        { PATH: `${bin}:${process.env.PATH}` },
        "--root",
        dir,
        "list",
        "clipboard",
      );
      expect(r.status).toBe(0);
      expect(r.out).toContain("copied 2 applications to clipboard");
      const text = await readFile(pasted, "utf8");
      expect(text).toContain("Acme");
      expect(text).toContain("Beta");
      expect(text).toContain("track");
      expect(text).not.toContain("\x1b[");
      const bad = run("--root", dir, "list", "frobnicate");
      expect(bad.status).not.toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blanks the job column when job.md agrees with the tracker", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-drift-"));
    try {
      await writeFile(
        path.join(dir, "applications.csv"),
        "date,company,role,track,region,status,url,folder\n" +
          '"2026-09-01","Acme","Engineer","swe","uk","applied","https://x","2026-09-01_acme_engineer"\n',
      );
      await mkdir(path.join(dir, "2026-09-01_acme_engineer"));
      await writeFile(
        path.join(dir, "2026-09-01_acme_engineer", "job.md"),
        "---\nstatus: applied\n---\n\nposting\n",
      );
      const r = run("--root", dir, "list");
      expect(r.status).toBe(0);
      const row = r.out.split("\n").find((l) => l.includes("Acme"));
      expect(row?.match(/applied/g)).toHaveLength(1);
      const head = r.out.split("\n").find((l) => l.includes("job.md"));
      expect(head!.indexOf("pdf")).toBeLessThan(head!.indexOf("job.md"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("exports a load-ready extension folder", async () => {
    const { mkdtemp, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-ext-"));
    try {
      const help = run("extension", "--help");
      expect(help.status).toBe(0);
      expect(help.out).toContain("Load unpacked");
      const r = run("--root", trackerRoot, "extension", "--out", dir);
      expect(r.status).toBe(0);
      expect(r.out).toContain(dir);
      for (const f of [
        "manifest.json",
        "popup.html",
        "dist/popup.js",
        "dist/background.js",
        "dist/content.js",
        "icons/icon16.png",
      ]) {
        expect(existsSync(path.join(dir, f))).toBe(true);
      }
      const stamped = await readFile(path.join(dir, "repo-root.txt"), "utf8");
      expect(stamped.trim()).toBe(path.dirname(trackerRoot));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds the extension in place when --out is omitted", async () => {
    const { readFile } = await import("node:fs/promises");
    const r = run("--root", trackerRoot, "extension");
    expect(r.status).toBe(0);
    expect(r.out).toContain("built in place");
    expect(r.out).not.toContain("Downloads");
    const ext = path.join(trackerRoot, "packages", "extension");
    for (const f of ["dist/popup.js", "dist/background.js", "dist/content.js"]) {
      expect(existsSync(path.join(ext, f))).toBe(true);
    }
    const stamped = await readFile(path.join(ext, "repo-root.txt"), "utf8");
    expect(stamped.trim()).toBe(path.dirname(trackerRoot));
  });

  it("stays up in watch mode and exports", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { spawn } = await import("node:child_process");
    const dir = await mkdtemp(path.join(tmpdir(), "jat-extw-"));
    const out = path.join(dir, "out");
    try {
      const child = spawn(
        "bun",
        [entry, "--root", trackerRoot, "extension", "--out", out, "--watch"],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      try {
        const deadline = Date.now() + 30000;
        while (!existsSync(path.join(out, "manifest.json"))) {
          if (Date.now() > deadline) throw new Error("watch mode never exported");
          if (child.exitCode !== null) throw new Error(`watch mode exited: ${child.exitCode}`);
          await new Promise((r) => setTimeout(r, 200));
        }
        expect(existsSync(path.join(out, "dist", "popup.js"))).toBe(true);
      } finally {
        child.kill();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("install-host documents itself and detects the loaded extension", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { browserDirs, detectExtensionId } = await import("./install-host-cmd.js");
    const help = run("install-host", "--help");
    expect(help.status).toBe(0);
    expect(help.out).toContain("--id");

    const home = await mkdtemp(path.join(tmpdir(), "jat-home-"));
    try {
      const cand = path.join(home, "ext");
      await mkdir(cand, { recursive: true });
      const profile = path.join(
        home,
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
        "Default",
      );
      await mkdir(profile, { recursive: true });
      await writeFile(
        path.join(profile, "Secure Preferences"),
        JSON.stringify({ extensions: { settings: { abc123: { path: cand } } } }),
      );
      const found = detectExtensionId([cand], browserDirs(home));
      expect(found).toEqual({ id: "abc123", browser: "brave" });
      expect(detectExtensionId([path.join(home, "missing")], browserDirs(home))).toBeNull();

      const empty = await mkdtemp(path.join(tmpdir(), "jat-noroot-"));
      try {
        const bad = run("--root", empty, "install-host", "--id", "x");
        expect(bad.status).not.toBe(0);
        expect(bad.out).toContain("no native host checkout");
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ensureHost skips when the host is installed, nudges when nothing is loaded", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { ensureHost, hostInstalled } = await import("./install-host-cmd.js");

    const home = await mkdtemp(path.join(tmpdir(), "jat-host-"));
    try {
      const cand = path.join(home, "ext");
      await mkdir(cand, { recursive: true });
      const browserDir = path.join(
        home,
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
      );
      await mkdir(path.join(browserDir, "Default"), { recursive: true });
      await writeFile(
        path.join(browserDir, "Default", "Secure Preferences"),
        JSON.stringify({ extensions: { settings: { abc123: { path: cand } } } }),
      );
      await mkdir(path.join(browserDir, "NativeMessagingHosts"), { recursive: true });
      await writeFile(
        path.join(browserDir, "NativeMessagingHosts", "com.jobs.jat.json"),
        JSON.stringify({ allowed_origins: ["chrome-extension://abc123/"] }),
      );

      expect(hostInstalled(home, "abc123", "brave")).toBe(true);
      expect(hostInstalled(home, "other-id", "brave")).toBe(false);
      expect(hostInstalled(home, "abc123", "chrome")).toBe(false);

      expect(ensureHost("/nonexistent-tracker", [cand], home)).toContain("skipped");
      expect(ensureHost("/nonexistent-tracker", [path.join(home, "missing")], home)).toContain(
        "no extension copy found",
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("predicts the id Chrome assigns an unpacked extension", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { predictId, unpackedExtensionId } = await import("./install-host-cmd.js");

    // Verified against a real Brave Secure Preferences entry.
    expect(unpackedExtensionId("/Users/c/Downloads/jat-extension")).toBe(
      "ehakjaheegcognpdefheaoiamijogjfi",
    );
    const a = unpackedExtensionId("/some/path");
    expect(a).toMatch(/^[a-p]{32}$/);
    expect(unpackedExtensionId("/some/path")).toBe(a);
    expect(unpackedExtensionId("/other/path")).not.toBe(a);

    const home = await mkdtemp(path.join(tmpdir(), "jat-predict-"));
    try {
      const cand = path.join(home, "ext");
      await mkdir(cand, { recursive: true });
      expect(predictId([path.join(home, "missing"), cand])?.path).toBe(cand);
      expect(predictId([path.join(home, "missing")])).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
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
