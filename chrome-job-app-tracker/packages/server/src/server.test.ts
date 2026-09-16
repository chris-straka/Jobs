import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { DEFAULT_IDLE_TIMEOUT_MS, idleTimeoutMs, startServer } from "./index.js";

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
  "JAT_AGENT",
  "JAT_AGENT_MODEL",
  "JAT_AGENT_BIN",
  "JAT_AGENT_TIMEOUT_MS",
  "JAT_AGENT_MAX_STEPS",
  "JAT_IDLE_TIMEOUT_MS",
];
const savedEnv = new Map<string, string | undefined>();
beforeAll(() => {
  for (const k of SECRET_KEYS) {
    savedEnv.set(k, process.env[k]);
    delete process.env[k];
  }
  // Only "0" disables the agent path: absent means enabled, which would
  // spawn a real headless agent in the HTTP tests.
  process.env.JAT_AGENT = "0";
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
    expect(s).toEqual({
      disabled: true,
      summary: null,
      bullets: [],
      gaps: [],
      notes: null,
      raw: null,
    });
  });

  it("parses bullets, gaps, and notes, dropping unknown ids", async () => {
    const lib = loadLibrary(REAL_ROOT);
    const canned = {
      summary: "Backend engineer.",
      bullets: [
        { project: "telemetry", id: "arch" },
        { project: "telemetry", id: "nope" },
        { project: "nope", id: "arch" },
        { project: "dbmodel", id: "sql" },
      ],
      gaps: ["Angular", 7],
      notes:
        "## What's missing\n\nAngular.\n\n## Interview prep\n\nLeetCode.\n\n## Notes\n\nApply fast.\n",
    };
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(canned) } }] }),
    })) as unknown as typeof fetch;
    try {
      const s = await suggest(JD, lib, { url: "http://model.test", key: "k", model: "m" });
      expect(s.disabled).toBe(false);
      expect(s.summary).toBe("Backend engineer.");
      expect(s.bullets).toEqual([
        { project: "telemetry", id: "arch" },
        { project: "dbmodel", id: "sql" },
      ]);
      expect(s.gaps).toEqual(["Angular"]);
      expect(s.notes).toContain("## Interview prep");
    } finally {
      globalThis.fetch = prevFetch;
    }
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

  describe("idle shutdown", () => {
    it("reads the timeout from the environment", () => {
      expect(idleTimeoutMs({})).toBe(DEFAULT_IDLE_TIMEOUT_MS);
      expect(idleTimeoutMs({ JAT_IDLE_TIMEOUT_MS: "60000" })).toBe(60000);
      expect(idleTimeoutMs({ JAT_IDLE_TIMEOUT_MS: "0" })).toBe(0);
      expect(idleTimeoutMs({ JAT_IDLE_TIMEOUT_MS: "nope" })).toBe(DEFAULT_IDLE_TIMEOUT_MS);
      expect(idleTimeoutMs({ JAT_IDLE_TIMEOUT_MS: "-5" })).toBe(DEFAULT_IDLE_TIMEOUT_MS);
    });

    it("closes an idle server", async () => {
      const tmp = await mkFixture();
      let shut = false;
      const server = startServer({
        port: 0,
        root: tmp,
        idleTimeoutMs: 50,
        onIdleShutdown: () => {
          shut = true;
        },
      });
      try {
        const deadline = Date.now() + 5000;
        while (!shut && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(shut).toBe(true);
        expect(server.listening).toBe(false);
      } finally {
        if (server.listening) server.close();
      }
    });

    it("defers while requests keep arriving", async () => {
      const tmp = await mkFixture();
      let shut = false;
      const server = startServer({
        port: 0,
        root: tmp,
        idleTimeoutMs: 300,
        onIdleShutdown: () => {
          shut = true;
        },
      });
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;
        // Touch every ~100ms for ~500ms: the 300ms timer must never fire.
        for (let i = 0; i < 5; i++) {
          expect((await fetch(`${base}/health`)).status).toBe(200);
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(shut).toBe(false);
        expect(server.listening).toBe(true);
        // Then go quiet: shutdown follows.
        const deadline = Date.now() + 5000;
        while (!shut && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(shut).toBe(true);
        expect(server.listening).toBe(false);
      } finally {
        if (server.listening) server.close();
      }
    });
  });

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

  it("persists the ineligible list round-trip canonicalized", async () => {
    const tmp = await mkFixture();
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(`${base}/api/ineligible`)).json()).toEqual({
        ineligible: [],
      });
      const posted = await fetch(`${base}/api/ineligible`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ineligible: ["https://www.example.com/jobs/1/?utm_source=x", "not a url"],
        }),
      });
      expect(posted.status).toBe(200);
      expect(await posted.json()).toEqual({ ineligible: ["https://example.com/jobs/1"] });
      const raw = await readFile(path.join(tmp, ".jat", "ineligible.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ ineligible: ["https://example.com/jobs/1"] });
      const bad = await fetch(`${base}/api/ineligible`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ineligible: "nope" }),
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
        draft: { written: boolean; summary: null; bullets: number; elapsedMs: number };
        notes: { written: boolean };
      };
      expect(body.folder).toMatch(/^applications\//);
      expect(body.buildOk).toBe(true);
      // No model credentials in tests: nothing to draft with.
      expect(body.draft).toEqual({
        written: false,
        summary: null,
        bullets: 0,
        elapsedMs: expect.any(Number),
      });
      expect(body.notes).toEqual({ written: false });
      const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
        ok: boolean;
        root: string;
      };
      expect(health).toEqual({ ok: true, root: tmp });
    } finally {
      server.close();
    }
  }, 120000);

  it("trims a 9-bullet draft to one page and writes model notes", async () => {
    const tmp = await mkFixture();
    const canned = {
      summary: "Backend engineer with Kafka and SQL experience.",
      bullets: [
        { project: "telemetry", id: "arch" },
        { project: "telemetry", id: "api-relay" },
        { project: "telemetry", id: "ai-pipeline" },
        { project: "telemetry", id: "ci" },
        { project: "telemetry", id: "terraform" },
        { project: "telemetry", id: "observability" },
        { project: "dbmodel", id: "sql" },
        { project: "dbmodel", id: "integrity" },
        { project: "hci", id: "prototypes" },
      ],
      gaps: ["Angular"],
      notes:
        "## What's missing\n\nAngular.\n\n## Interview prep\n\nSystem design.\n\n## Notes\n\nApply fast.\n",
    };
    process.env.MODEL_API_URL = "http://model.test";
    process.env.MODEL_API_KEY = "k";
    const prevFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: unknown) => {
      if (String(url).startsWith("http://model.test")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(canned) } }] }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      }
      return prevFetch(url as string, init as RequestInit);
    }) as typeof fetch;
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      // Unknown clients have no stage.
      const missing = await fetch(`${base}/api/progress?client=nope`);
      expect(missing.status).toBe(404);
      const res = await fetch(`${base}/api/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/jobs/44",
          company: "Acme",
          role: "Backend Engineer",
          track: "swe",
          region: "uk",
          description: JD,
          clientId: "test-client-1",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        folder: string;
        buildOk: boolean;
        draft: { written: boolean; bullets: number };
        notes: { written: boolean };
      };
      expect(body.buildOk).toBe(true);
      expect(body.draft.written).toBe(true);
      // Nine suggested, fewer kept: the loop cut to fit one page.
      expect(body.draft.bullets).toBeLessThan(9);
      expect(body.draft.bullets).toBeGreaterThanOrEqual(4);
      expect(body.notes).toEqual({ written: true });
      const notesMd = await readFile(path.join(tmp, body.folder, "notes.md"), "utf8");
      expect(notesMd).toContain("# Acme — Backend Engineer");
      expect(notesMd).toContain("## Interview prep");
      // Finished captures leave no stage behind.
      const gone = await fetch(`${base}/api/progress?client=test-client-1`);
      expect(gone.status).toBe(404);
    } finally {
      server.close();
      globalThis.fetch = prevFetch;
      delete process.env.MODEL_API_URL;
      delete process.env.MODEL_API_KEY;
    }
  }, 120000);

  it("rolls back the scaffold when the agent binary fails", async () => {
    const tmp = await mkFixture();
    const failBin = path.join(tmp, "fake-muse-fail");
    await writeFile(failBin, "#!/bin/sh\necho 'agent timed out' >&2\nexit 1\n", { mode: 0o755 });
    delete process.env.JAT_AGENT;
    process.env.JAT_AGENT_BIN = failBin;
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const payload = {
        url: "https://example.com/jobs/45",
        company: "Acme",
        role: "Backend Engineer",
        track: "swe",
        region: "uk",
        description: JD,
        clientId: "rollback-1",
      };
      const post = (): Promise<Response> =>
        fetch(`${base}/api/capture`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      const res = await post();
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("tailoring failed");
      expect(body.error).toContain("agent timed out");
      expect(body.error).toContain("nothing saved");
      // Folder and tracker row are gone…
      expect(await readdir(path.join(tmp, "applications"))).toEqual([]);
      const csv = await readFile(path.join(tmp, "applications.csv"), "utf8");
      expect(csv.trim()).toBe("date,company,role,track,region,status,url,folder");
      // …so retrying starts clean instead of hitting a duplicate.
      expect((await post()).status).toBe(500);
    } finally {
      server.close();
      delete process.env.JAT_AGENT_BIN;
      process.env.JAT_AGENT = "0";
    }
  }, 120000);

  it("kills a running agent on cancel and rolls the folder back", async () => {
    const tmp = await mkFixture();
    const hangBin = path.join(tmp, "fake-muse-hang");
    await writeFile(hangBin, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    delete process.env.JAT_AGENT;
    process.env.JAT_AGENT_BIN = hangBin;
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const cancelPayload = (clientId: string): Promise<Response> =>
        fetch(`${base}/api/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientId }),
        });
      // Unknown clients and bad bodies never touch a run.
      expect((await cancelPayload("nope")).status).toBe(404);
      const bad = await fetch(`${base}/api/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(bad.status).toBe(400);
      // Start a capture that hangs in the agent, then kill it. The run
      // registers after scaffold/fit/build, so poll until cancel lands.
      const capture = fetch(`${base}/api/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/jobs/46",
          company: "Acme",
          role: "Backend Engineer",
          track: "swe",
          region: "uk",
          description: JD,
          clientId: "cancel-1",
        }),
      });
      let killed = false;
      const deadline = Date.now() + 90000;
      while (!killed && Date.now() < deadline) {
        const r = await cancelPayload("cancel-1");
        if (r.status === 200) {
          expect(await r.json()).toEqual({ cancelled: true });
          killed = true;
        } else {
          expect(r.status).toBe(404);
          await new Promise((r2) => setTimeout(r2, 200));
        }
      }
      expect(killed).toBe(true);
      const res = await capture;
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toContain("cancelled by user");
      expect(body.error).toContain("nothing saved");
      expect(await readdir(path.join(tmp, "applications"))).toEqual([]);
      const csv = await readFile(path.join(tmp, "applications.csv"), "utf8");
      expect(csv.trim()).toBe("date,company,role,track,region,status,url,folder");
    } finally {
      server.close();
      delete process.env.JAT_AGENT_BIN;
      process.env.JAT_AGENT = "0";
    }
  }, 120000);

  it("keeps the save when the agent binary succeeds", async () => {
    const tmp = await mkFixture();
    const okBin = path.join(tmp, "fake-muse-ok");
    await writeFile(
      okBin,
      [
        "#!/bin/sh",
        'FOLDER=$(ls -d "$JAT_FAKE_ROOT"/applications/*/ | head -1)',
        "cat > \"${FOLDER}resume.typ\" <<'TYP'",
        '#import "../../templates/lib.typ": resume',
        "",
        "#resume(",
        '  track: "swe",',
        '  region: "uk",',
        '  summary: "Backend engineer.",',
        "  projects: (",
        '    (id: "telemetry", bullets: ("arch",)),',
        "  ),",
        ")",
        "TYP",
        "printf '# X\\n\\n## Interview prep\\n\\nPrep.\\n' >> \"${FOLDER}notes.md\"",
        "echo done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    delete process.env.JAT_AGENT;
    process.env.JAT_AGENT_BIN = okBin;
    process.env.JAT_FAKE_ROOT = tmp;
    const server = startServer({ port: 0, root: tmp });
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const res = await fetch(`${base}/api/capture`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com/jobs/46",
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
        draft: { written: boolean; bullets: number };
        notes: { written: boolean };
      };
      expect(body.buildOk).toBe(true);
      expect(body.draft).toMatchObject({ written: true, bullets: 1 });
      expect(body.notes).toEqual({ written: true });
      const typ = await readFile(path.join(tmp, body.folder, "resume.typ"), "utf8");
      expect(typ).toContain('"arch"');
    } finally {
      server.close();
      delete process.env.JAT_AGENT_BIN;
      delete process.env.JAT_FAKE_ROOT;
      process.env.JAT_AGENT = "0";
    }
  }, 120000);
});
