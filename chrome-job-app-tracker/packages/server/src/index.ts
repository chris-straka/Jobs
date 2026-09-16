import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  CancelRequest,
  CancelResponse,
  CaptureRequest,
  CaptureResponse,
  HealthResponse,
  OpenRequest,
  OpenResponse,
  ResolveResponse,
  StatusRequest,
  StatusResponse,
  analyzeFit,
} from "@jat/shared";
import { loadTrackerEnv, repoRoot, serverPort } from "./repo.js";

export { runProbe } from "./probe.js";
import {
  DuplicateApplication,
  addApplication,
  buildResumes,
  findByUrl,
  isPageOverflow,
  loadInvariants,
  loadLibrary,
  openApplicationFolder,
  parseIneligible,
  readApplicationStatus,
  readIneligible,
  parseFalsePositives,
  readFalsePositives,
  readSavedDescription,
  removeApplication,
  setApplicationStatus,
  writeFalsePositives,
  writeIneligible,
} from "@jat/core";
import type { BulletRef, ModelSuggestion } from "@jat/shared";
import { agentEnabled, runAgentTailor } from "./agent.js";
import { autoDraftEnabled, buildResumeTyp, dropOneBullet, TIGHT_KNOBS } from "./draft.js";
import { suggest } from "./model.js";

const BODY_LIMIT = 2 * 1024 * 1024;

/**
 * Live capture stages for the popup's progress poll. Entries are deleted
 * when their capture finishes; stale ones (crashed client) age out on read.
 */
const progress = new Map<string, { stage: string; at: number }>();
/** In-flight agent runs by clientId, so POST /api/cancel can kill them. */
const runs = new Map<string, AbortController>();
const PROGRESS_TTL_MS = 10 * 60 * 1000;

/**
 * Idle auto-shutdown so a forgotten server doesn't sit forever. The timer
 * resets on every request and never fires mid-capture (in-flight requests,
 * agent runs, and fresh progress stages all defer it). `0` disables it.
 */
export const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;

export function idleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.JAT_IDLE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_IDLE_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_IDLE_TIMEOUT_MS;
  return n;
}

function formatIdle(ms: number): string {
  if (ms <= 0) return "off";
  if (ms % 3600000 === 0) return `${ms / 3600000}h`;
  if (ms % 60000 === 0) return `${ms / 60000}m`;
  return `${Math.round(ms / 1000)}s`;
}

function setStage(clientId: string | undefined, stage: string): void {
  if (!clientId) return;
  progress.set(clientId, { stage, at: Date.now() });
}

function takeStage(clientId: string | undefined): void {
  if (!clientId) return;
  progress.delete(clientId);
}

function readStage(clientId: unknown): string | null {
  if (typeof clientId !== "string" || !clientId) return null;
  const now = Date.now();
  for (const [k, v] of progress) {
    if (now - v.at > PROGRESS_TTL_MS) progress.delete(k);
  }
  return progress.get(clientId)?.stage ?? null;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        reject(new Error("body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, value: unknown): void {
  // Single-user localhost service: allow the popup (or any local page) to call it.
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(value));
}

/**
 * Starts the capture service on loopback only (never exposed to the LAN).
 *
 * Routes: `GET /health`, `POST /api/capture` (Zod-validated),
 * `GET /api/progress?client=` (live capture stages),
 * `POST /api/cancel` (kill a running capture by clientId), `OPTIONS`
 * preflight, plus resolve/status. A capture scaffolds via `@jat/core`
 * (the same code `ja` runs), scores fit against the bullet library,
 * verifies the build, and optionally asks the model. Failures surface as
 * 400 (bad payload) or 500 (scaffold failed).
 */
export function startServer(
  opts: {
    port?: number;
    root?: string;
    idleTimeoutMs?: number;
    onIdleShutdown?: () => void;
  } = {},
): http.Server {
  const root = opts.root ?? repoRoot();
  // The real server runs as `bun src/index.ts` (import.meta.main); library
  // callers (tests, embedders) opt in by passing idleTimeoutMs explicitly,
  // so an armed timer can never surprise them.
  const idleMs = opts.idleTimeoutMs ?? (import.meta.main ? idleTimeoutMs() : 0);
  let inFlight = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
    if (idleMs <= 0) return;
    idleTimer = setTimeout(onIdle, idleMs);
  }
  function onIdle(): void {
    idleTimer = undefined;
    // Never die mid-capture: an open request, a registered agent run, or
    // a fresh progress stage means someone is still working.
    if (inFlight > 0 || runs.size > 0) {
      armIdle();
      return;
    }
    const now = Date.now();
    let fresh = false;
    for (const [k, v] of progress) {
      if (now - v.at > PROGRESS_TTL_MS) progress.delete(k);
      else fresh = true;
    }
    if (fresh) {
      armIdle();
      return;
    }
    console.log(`job capture server idle for ${formatIdle(idleMs)} — shutting down`);
    try {
      server.close();
    } finally {
      opts.onIdleShutdown?.();
    }
  }
  const server = http.createServer((req, res) => {
    armIdle();
    inFlight += 1;
    res.on("close", () => {
      inFlight -= 1;
    });
    void (async () => {
      if (req.method === "OPTIONS") {
        json(res, 204, null);
        return;
      }
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, HealthResponse.parse({ ok: true, root }));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/resolve")) {
        const u = new URL(req.url, "http://127.0.0.1").searchParams.get("url") ?? "";
        const folder = findByUrl(root, u);
        json(
          res,
          200,
          ResolveResponse.parse({
            folder,
            description: folder ? readSavedDescription(root, folder) : null,
            status: folder ? readApplicationStatus(root, folder) : null,
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/api/status") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = StatusRequest.safeParse(body);
        if (!parsed.success) {
          json(res, 400, { error: "invalid status change", issues: parsed.error.issues });
          return;
        }
        try {
          setApplicationStatus(root, parsed.data.folder, parsed.data.status);
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        json(res, 200, StatusResponse.parse(parsed.data));
        return;
      }
      if (req.method === "POST" && req.url === "/api/open") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = OpenRequest.safeParse(body);
        if (!parsed.success) {
          json(res, 400, { error: "invalid open request", issues: parsed.error.issues });
          return;
        }
        try {
          const { via } = openApplicationFolder(root, parsed.data.folder);
          json(res, 200, OpenResponse.parse({ via }));
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      if (req.method === "GET" && req.url === "/api/ignore") {
        json(res, 200, readFalsePositives(root));
        return;
      }
      if (req.method === "POST" && req.url === "/api/ignore") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = parseFalsePositives(body);
        if (!parsed) {
          json(res, 400, { error: "invalid false positives" });
          return;
        }
        try {
          writeFalsePositives(root, parsed);
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        json(res, 200, readFalsePositives(root));
        return;
      }
      if (req.method === "GET" && req.url === "/api/ineligible") {
        json(res, 200, readIneligible(root));
        return;
      }
      if (req.method === "POST" && req.url === "/api/ineligible") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = parseIneligible(body);
        if (!parsed) {
          json(res, 400, { error: "invalid ineligible list" });
          return;
        }
        try {
          writeIneligible(root, parsed);
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
          return;
        }
        json(res, 200, readIneligible(root));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/progress")) {
        const client = new URL(req.url, "http://127.0.0.1").searchParams.get("client");
        const stage = readStage(client);
        if (!stage) {
          json(res, 404, { error: "unknown capture" });
          return;
        }
        json(res, 200, { stage });
        return;
      }
      if (req.method === "POST" && req.url === "/api/cancel") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = CancelRequest.safeParse(body);
        if (!parsed.success) {
          json(res, 400, { error: "invalid cancel", issues: parsed.error.issues });
          return;
        }
        // Aborting resolves the run as cancelled; the capture handler's
        // atomic-save rollback then removes the folder, so cancel leaves
        // nothing behind. Unknown client means the run already finished
        // (or never existed) — say so instead of claiming the kill.
        const run = runs.get(parsed.data.clientId);
        if (!run) {
          json(res, 404, { error: "unknown capture" });
          return;
        }
        run.abort();
        json(res, 200, CancelResponse.parse({ cancelled: true }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/capture") {
        let body: unknown;
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const parsed = CaptureRequest.safeParse(body);
        if (!parsed.success) {
          json(res, 400, { error: "invalid capture", issues: parsed.error.issues });
          return;
        }
        const clientId = parsed.data.clientId;
        const started = Date.now();
        try {
          setStage(clientId, "scaffold");
          const { folder } = addApplication(root, parsed.data);
          try {
            const library = loadLibrary(root);
            const invariants = loadInvariants(root);
            setStage(clientId, "fit");
            const fit = analyzeFit(parsed.data.description, library);
            setStage(clientId, "build");
            let build = buildResumes(root, [folder]);
            const draft = {
              written: false,
              summary: null as string | null,
              bullets: 0,
              elapsedMs: 0,
            };
            const notes = { written: false };
            let model: ModelSuggestion;
            if (agentEnabled() && autoDraftEnabled()) {
              // Headless agent does the whole tailoring loop; the server
              // only verifies what it left behind.
              model = {
                disabled: false,
                summary: null,
                bullets: [],
                gaps: [],
                notes: null,
                raw: null,
              };
              const known: string[] = [];
              for (const p of library) for (const b of p.bullets) known.push(b.id);
              // Registered for POST /api/cancel: aborting resolves the run
              // as cancelled, and the atomic-save check below rolls back
              // the folder. Unregistered as soon as the run settles.
              const agentRun = new AbortController();
              if (clientId) runs.set(clientId, agentRun);
              let run;
              try {
                run = await runAgentTailor({
                  root,
                  folder,
                  track: parsed.data.track,
                  region: parsed.data.region,
                  fitOrder: fit.projects.map((p) => p.id),
                  knownBullets: known,
                  onStage: (s) => setStage(clientId, s),
                  signal: agentRun.signal,
                });
              } finally {
                if (clientId) runs.delete(clientId);
              }
              build = buildResumes(root, [folder]);
              draft.written = run.draftWritten;
              draft.bullets = run.bullets;
              notes.written = run.notesWritten;
              model.raw = run.raw;
            } else {
              setStage(clientId, "model");
              model = await suggest(parsed.data.description, library, undefined, invariants);
            }
            if (
              autoDraftEnabled() &&
              !agentEnabled() &&
              !model.disabled &&
              model.summary &&
              model.bullets.length > 0
            ) {
              setStage(clientId, "draft");
              const fitOrder = fit.projects.map((p) => p.id);
              const base = {
                track: parsed.data.track,
                region: parsed.data.region,
                summary: model.summary,
                fitOrder,
              };
              try {
                // Knobs before cuts (per AGENTS.md): the tightened draft
                // first, then one bullet at a time off the weakest project.
                let bullets: BulletRef[] = model.bullets;
                await writeFile(
                  path.join(root, folder, "resume.typ"),
                  buildResumeTyp({ ...base, bullets }),
                );
                build = buildResumes(root, [folder]);
                if (isPageOverflow(build)) {
                  setStage(clientId, "fit-page");
                  await writeFile(
                    path.join(root, folder, "resume.typ"),
                    buildResumeTyp({ ...base, bullets }, TIGHT_KNOBS),
                  );
                  build = buildResumes(root, [folder]);
                }
                while (isPageOverflow(build) && bullets.length > 4) {
                  bullets = dropOneBullet(bullets, fitOrder);
                  await writeFile(
                    path.join(root, folder, "resume.typ"),
                    buildResumeTyp({ ...base, bullets }, TIGHT_KNOBS),
                  );
                  build = buildResumes(root, [folder]);
                }
                draft.written = true;
                draft.summary = model.summary;
                draft.bullets = bullets.length;
              } catch (err) {
                draft.written = false;
                console.error(
                  `auto-draft failed for ${folder}:`,
                  err instanceof Error ? err.message : err,
                );
              }
            }
            if (autoDraftEnabled() && !agentEnabled() && !model.disabled && model.notes) {
              setStage(clientId, "notes");
              try {
                const notesPath = path.join(root, folder, "notes.md");
                const template = await readFile(notesPath, "utf8");
                await writeFile(notesPath, `${template}\n${model.notes.trim()}\n`);
                notes.written = true;
              } catch (err) {
                console.error(
                  `notes failed for ${folder}:`,
                  err instanceof Error ? err.message : err,
                );
              }
            }
            // Atomic save: when tailoring was attempted, a capture that
            // can't produce a tailored, compiling resume leaves nothing
            // behind — no folder, no tracker row — so the next save starts
            // clean instead of hitting a duplicate. Untouched otherwise:
            // without tailoring the scaffold stands and reports its build.
            const tailoringAttempted =
              (agentEnabled() && autoDraftEnabled()) || (autoDraftEnabled() && !model.disabled);
            const usable = !tailoringAttempted || (draft.written && build.ok);
            if (!usable) {
              const reason =
                (model.raw ?? "")
                  .split("\n")
                  .map((l) => l.trim())
                  .find((l) => l.length > 0) ?? "no output";
              try {
                removeApplication(root, folder);
              } catch (err) {
                console.error(
                  `rollback failed for ${folder}:`,
                  err instanceof Error ? err.message : err,
                );
              }
              takeStage(clientId);
              json(res, 500, {
                error: `tailoring failed — ${reason.slice(0, 200)}; nothing saved`,
              });
              return;
            }
            draft.elapsedMs = Date.now() - started;
            takeStage(clientId);
            json(
              res,
              200,
              CaptureResponse.parse({
                folder,
                buildOk: build.ok,
                buildOutput: build.lines.join("\n"),
                fit,
                model,
                draft,
                notes,
              }),
            );
          } catch (err) {
            takeStage(clientId);
            throw err;
          }
        } catch (err) {
          // Same date/company/role as a tracked application: point at it
          // instead of failing — the popup shows its saved state.
          if (err instanceof DuplicateApplication) {
            json(res, 409, { error: err.message, folder: err.folder });
          } else {
            json(res, 500, { error: String(err) });
          }
        }
        return;
      }
      json(res, 404, { error: "not found" });
    })();
  });
  const port = opts.port ?? serverPort();
  server.listen(port, "127.0.0.1");
  armIdle();
  server.on("listening", () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(
      `job capture server on http://127.0.0.1:${actual} (root ${root}) (idle-shutdown ${formatIdle(idleMs)})`,
    );
  });
  return server;
}

if (import.meta.main) {
  loadTrackerEnv();
  startServer({ onIdleShutdown: () => process.exit(0) });
}
