import { afterAll, describe, expect, it } from "bun:test";
import { chmod, cp, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { repoRoot } from "./repo.js";
import { loadLibrary } from "./library.js";
import { scaffold, verifyBuild } from "./capture.js";
import { modelConfigFromEnv, suggest } from "./model.js";
import { startServer } from "./index.js";

const REAL_ROOT = repoRoot();
const JD =
  "Backend engineer. Kafka event streaming, Docker deployments, distributed systems, " +
  "Postgres, gRPC. ".repeat(10);

const fixtures: string[] = [];
afterAll(async () => {
  await Promise.all(fixtures.map((d) => rm(d, { recursive: true, force: true })));
});

/** Temp repo: real add-job/build.sh (copied — they resolve ROOT from $0),
 *  content + templates copied (Typst will not follow symlinks outside --root). */
async function mkFixture(): Promise<string> {
  const tmp = await mkdtemp(path.join(tmpdir(), "jat-"));
  fixtures.push(tmp);
  await mkdir(path.join(tmp, "bin"), { recursive: true });
  for (const f of ["add-job", "build.sh"]) {
    await copyFile(path.join(REAL_ROOT, "bin", f), path.join(tmp, "bin", f));
    await chmod(path.join(tmp, "bin", f), 0o755);
  }
  await cp(path.join(REAL_ROOT, "content"), path.join(tmp, "content"), { recursive: true });
  await cp(path.join(REAL_ROOT, "templates"), path.join(tmp, "templates"), { recursive: true });
  return tmp;
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

describe("loadLibrary", () => {
  it("parses the real bullet library", async () => {
    const lib = await loadLibrary(REAL_ROOT);
    const telemetry = lib.find((p) => p.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry!.bullets.length).toBeGreaterThan(5);
  });
});

describe("verifyBuild", () => {
  it("passes through a stub runner with an absolute folder", () => {
    const seen: string[][] = [];
    const run = (cmd: string, args: string[]) => {
      seen.push([cmd, ...args]);
      return { status: 0, stdout: "ok" };
    };
    expect(verifyBuild("/r", "applications/x", run).ok).toBe(true);
    expect(seen).toEqual([["/r/bin/build.sh", "/r/applications/x"]]);
    expect(verifyBuild("/r", "applications/x", () => ({ status: 1, stdout: "boom" }))).toEqual({
      ok: false,
      output: "boom",
    });
  });
});

describe("model", () => {
  it("is disabled without env config and never calls the network", async () => {
    expect(modelConfigFromEnv({})).toBeNull();
    const lib = await loadLibrary(REAL_ROOT);
    const s = await suggest(JD, lib, null);
    expect(s).toEqual({ disabled: true, summary: null, bullets: [], gaps: [], raw: null });
  });
});

describe("capture end to end", () => {
  it("scaffolds a fixture application and compiles it", async () => {
    const tmp = await mkFixture();
    const req = {
      url: "https://example.com/jobs/42",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe" as const,
      region: "uk" as const,
      description: JD,
    };
    const { folder } = scaffold(tmp, req);
    expect(folder).toMatch(/^applications\/\d{4}-\d{2}-\d{2}_acme_backend-engineer$/);
    for (const f of ["job.md", "resume.typ", "notes.md"]) {
      expect(await exists(path.join(tmp, folder, f))).toBe(true);
    }
    const csv = await readFile(path.join(tmp, "applications.csv"), "utf8");
    expect(csv).toContain('"draft"');

    const library = await loadLibrary(tmp);
    const { analyzeFit } = await import("@jat/shared");
    const fit = analyzeFit(JD, library);
    expect(fit.projects).toHaveLength(3);
    expect(fit.projects[0].id).toBe("telemetry");

    const build = verifyBuild(tmp, folder);
    expect(build.ok).toBe(true);
  }, 120000);

  it("serves POST /api/capture over HTTP", async () => {
    const tmp = await mkFixture();
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/api/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/jobs/43",
          company: "Acme",
          role: "Backend Engineer",
          track: "swe",
          region: "uk",
          description: JD,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { folder: string; buildOk: boolean };
      expect(body.folder).toMatch(/^applications\//);
      expect(body.buildOk).toBe(true);
    } finally {
      server.close();
    }
  }, 120000);
});
