import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addApplication,
  buildResumes,
  findByUrl,
  loadLibrary,
  setApplicationStatus,
} from "@jat/core";
import { repoRoot } from "./repo.js";
import { buildResumeTyp } from "./draft.js";
import { modelConfigFromEnv, suggest } from "./model.js";
import { startServer } from "./index.js";

const REAL_ROOT = repoRoot();
const JD =
  "Backend engineer. Kafka event streaming, Docker deployments, distributed systems, " +
  "Postgres, gRPC. ".repeat(10);

const fixtures: string[] = [];

// Model credential names the suite must never see: a developer `.env` may
// exist on disk, and the HTTP e2e calls suggest() with live config.
const SECRET_KEYS = [
  "MODEL_API_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "META_BASE_URL",
  "META_API_KEY",
  "META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE",
  "JAT_AUTO_DRAFT",
];
const savedEnv = new Map<string, string | undefined>();
beforeAll(() => {
  for (const k of SECRET_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
});
afterAll(async () => {
  for (const k of SECRET_KEYS) {
    const v = savedEnv.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await Promise.all(fixtures.map((d) => rm(d, { recursive: true, force: true })));
});

/** Temp repo: content + templates copied (Typst will not follow symlinks
 *  outside --root). No scripts needed — @jat/core operates in-process. */
async function mkFixture(): Promise<string> {
  const tmp = await mkdtemp(path.join(tmpdir(), "jat-"));
  fixtures.push(tmp);
  await mkdir(path.join(tmp, "applications"), { recursive: true });
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
  it("parses the real bullet library", () => {
    const lib = loadLibrary(REAL_ROOT);
    const telemetry = lib.find((p) => p.id === "telemetry");
    expect(telemetry).toBeDefined();
    expect(telemetry!.bullets.length).toBeGreaterThan(5);
  });
});

describe("build wiring", () => {
  it("resolves folders against the repo root", async () => {
    const tmp = await mkFixture();
    const { folder } = addApplication(tmp, {
      url: "https://example.com/jobs/98",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe",
      region: "uk",
      description: JD,
    });
    await writeFile(path.join(tmp, folder, "chris-straka-resume.pdf"), "fake /Count 1 pdf");
    const seen: string[][] = [];
    const r = buildResumes(tmp, [folder], (cmd, args) => {
      seen.push([cmd, ...args]);
      return { status: 0, output: "ok" };
    });
    expect(r.ok).toBe(true);
    expect(seen[0][0]).toBe("typst");
    expect(seen[0]).toContain(path.join(tmp, folder, "resume.typ"));
  });

  it("compiles generated drafts, including one-bullet projects", async () => {
    const tmp = await mkFixture();
    const { folder } = addApplication(tmp, {
      url: "https://example.com/jobs/99",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe",
      region: "uk",
      description: JD,
    });
    await writeFile(
      path.join(tmp, folder, "resume.typ"),
      buildResumeTyp({
        track: "swe",
        region: "uk",
        summary: "Backend engineer.",
        bullets: [
          { project: "telemetry", id: "arch" },
          { project: "telemetry", id: "store-forward" },
          { project: "dbmodel", id: "sql" },
        ],
        fitOrder: ["telemetry", "dbmodel"],
      }),
    );
    const r = buildResumes(tmp, [folder]);
    expect(r.ok).toBe(true);
  });
});

describe("model", () => {
  it("is disabled without env config and never calls the network", async () => {
    expect(modelConfigFromEnv({})).toBeNull();
    const lib = loadLibrary(REAL_ROOT);
    const s = await suggest(JD, lib, null);
    expect(s).toEqual({ disabled: true, summary: null, bullets: [], gaps: [], raw: null });
  });

  it("accepts META_* aliases and defaults the contributor model", () => {
    expect(
      modelConfigFromEnv({
        META_BASE_URL: "https://api.meta.ai/v1",
        META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "k",
      }),
    ).toEqual({
      url: "https://api.meta.ai/v1",
      key: "k",
      model: "muse-spark-1.3-contributor",
    });
    expect(modelConfigFromEnv({ MODEL_API_URL: "u", MODEL_API_KEY: "k", MODEL_NAME: "m" })).toEqual(
      { url: "u", key: "k", model: "m" },
    );
  });
});

describe("resolve + status", () => {
  it("finds a captured URL and moves it to applied", async () => {
    const tmp = await mkFixture();
    const req = {
      url: "https://example.com/jobs/99",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe" as const,
      region: "uk" as const,
      description: JD,
    };
    const { folder } = addApplication(tmp, req);
    expect(findByUrl(tmp, "https://example.com/jobs/99")).toBe(folder);
    expect(findByUrl(tmp, "https://example.com/jobs/unknown")).toBeNull();

    expect(setApplicationStatus(tmp, folder, "applied")).toEqual({ old: "draft" });
    const job = await readFile(path.join(tmp, folder, "job.md"), "utf8");
    expect(job).toContain("status: applied");
    const csv = await readFile(path.join(tmp, "applications.csv"), "utf8");
    expect(csv).toContain('"applied"');
  });

  it("moves status over HTTP", async () => {
    const tmp = await mkFixture();
    const { folder } = addApplication(tmp, {
      url: "https://example.com/jobs/100",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe" as const,
      region: "uk" as const,
      description: JD,
    });
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const resolved = await (
        await fetch(`${base}/api/resolve?url=${encodeURIComponent("https://example.com/jobs/100")}`)
      ).json();
      expect(resolved).toEqual({ folder, description: JD.trim(), status: "draft" });
      const changed = await fetch(`${base}/api/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder, status: "applied" }),
      });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toEqual({ folder, status: "applied" });
      const bad = await fetch(`${base}/api/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folder: "../escape", status: "applied" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      server.close();
    }
  }, 120000);

  it("persists false positives round-trip normalized", async () => {
    const tmp = await mkFixture();
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(`${base}/api/ignore`)).json()).toEqual({
        falsePositives: [],
      });
      const posted = await fetch(`${base}/api/ignore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ falsePositives: ["B.com ", "b.com"] }),
      });
      expect(posted.status).toBe(200);
      expect(await posted.json()).toEqual({ falsePositives: ["b.com"] });
      const raw = await readFile(path.join(tmp, ".jat", "ignore.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ falsePositives: ["b.com"] });
      const legacy = await fetch(`${base}/api/ignore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fpReported: ["B.com "], fpHosts: ["C.com"] }),
      });
      expect(legacy.status).toBe(200);
      expect(await legacy.json()).toEqual({ falsePositives: ["b.com", "c.com"] });
      const bad = await fetch(`${base}/api/ignore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ falsePositives: "nope" }),
      });
      expect(bad.status).toBe(400);
    } finally {
      server.close();
    }
  }, 120000);

  it("returns 409 with the folder on duplicate saves", async () => {
    const tmp = await mkFixture();
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const payload = {
        url: "https://example.com/jobs/100",
        company: "Acme",
        role: "Backend Engineer",
        track: "swe",
        region: "uk",
        description: JD,
      };
      const post = (): Promise<Response> =>
        fetch(`${base}/api/capture`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      const first = (await (await post()).json()) as { folder?: unknown };
      expect(typeof first.folder).toBe("string");
      const folder = first.folder as string;
      expect(folder).toMatch(/^applications\//);
      const secondRes = await post();
      expect(secondRes.status).toBe(409);
      const second = (await secondRes.json()) as { error?: string; folder?: string };
      expect(second.error).toContain("already exists");
      expect(second.folder).toBe(folder);
    } finally {
      server.close();
    }
  }, 120000);
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
    const { folder } = addApplication(tmp, req);
    expect(folder).toMatch(/^applications\/\d{4}-\d{2}-\d{2}_acme_backend-engineer$/);
    for (const f of ["job.md", "resume.typ", "notes.md"]) {
      expect(await exists(path.join(tmp, folder, f))).toBe(true);
    }
    const csv = await readFile(path.join(tmp, "applications.csv"), "utf8");
    expect(csv).toContain('"draft"');

    const library = loadLibrary(tmp);
    const { analyzeFit } = await import("@jat/shared");
    const fit = analyzeFit(JD, library);
    expect(fit.projects).toHaveLength(3);
    expect(fit.projects[0].id).toBe("telemetry");

    const build = buildResumes(tmp, [folder]);
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
      const body = (await res.json()) as {
        folder: string;
        buildOk: boolean;
        draft: { written: boolean; summary: null };
      };
      expect(body.folder).toMatch(/^applications\//);
      expect(body.buildOk).toBe(true);
      // No model credentials in tests: nothing to draft with.
      expect(body.draft).toEqual({ written: false, summary: null });
      const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
        ok: boolean;
        root: string;
      };
      expect(health).toEqual({ ok: true, root: tmp });
    } finally {
      server.close();
    }
  }, 120000);
});
