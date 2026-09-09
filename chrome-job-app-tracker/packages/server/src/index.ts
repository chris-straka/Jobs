import { writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {
  CaptureRequest,
  CaptureResponse,
  HealthResponse,
  ResolveResponse,
  StatusRequest,
  StatusResponse,
  analyzeFit,
} from "@jat/shared";
import { loadTrackerEnv, repoRoot, serverPort } from "./repo.js";
import { loadLibrary } from "./library.js";

export { runProbe } from "./probe.js";
import { scaffold, verifyBuild } from "./capture.js";
import { autoDraftEnabled, buildResumeTyp } from "./draft.js";
import { resolveByUrl, setStatus } from "./status.js";
import { suggest } from "./model.js";

const BODY_LIMIT = 2 * 1024 * 1024;

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
 * Routes: `GET /health`, `POST /api/capture` (Zod-validated), `OPTIONS`
 * preflight. A capture scaffolds via `bin/add-job`, scores fit against the
 * bullet library, verifies with `bin/build.sh`, and optionally asks the
 * model. Failures surface as 400 (bad payload) or 500 (scaffold failed);
 * nothing is ever written except through `bin/add-job`.
 */
export function startServer(opts: { port?: number; root?: string } = {}): http.Server {
  const root = opts.root ?? repoRoot();
  const server = http.createServer((req, res) => {
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
        json(res, 200, ResolveResponse.parse({ folder: await resolveByUrl(root, u) }));
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
        const r = setStatus(root, parsed.data.folder, parsed.data.status);
        if (!r.ok) {
          json(res, 500, { error: r.output });
          return;
        }
        json(res, 200, StatusResponse.parse(parsed.data));
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
        try {
          const { folder } = scaffold(root, parsed.data);
          const library = await loadLibrary(root);
          const fit = analyzeFit(parsed.data.description, library);
          let build = verifyBuild(root, folder);
          const model = await suggest(parsed.data.description, library);
          const draft = { written: false, summary: null as string | null };
          if (autoDraftEnabled() && !model.disabled && model.summary && model.bullets.length > 0) {
            try {
              await writeFile(
                path.join(root, folder, "resume.typ"),
                buildResumeTyp({
                  track: parsed.data.track,
                  region: parsed.data.region,
                  summary: model.summary,
                  bullets: model.bullets,
                  fitOrder: fit.projects.map((p) => p.id),
                }),
              );
              build = verifyBuild(root, folder);
              draft.written = true;
              draft.summary = model.summary;
            } catch {
              draft.written = false;
            }
          }
          json(
            res,
            200,
            CaptureResponse.parse({
              folder,
              buildOk: build.ok,
              buildOutput: build.output,
              fit,
              model,
              draft,
            }),
          );
        } catch (err) {
          json(res, 500, { error: String(err) });
        }
        return;
      }
      json(res, 404, { error: "not found" });
    })();
  });
  const port = opts.port ?? serverPort();
  server.listen(port, "127.0.0.1");
  server.on("listening", () => {
    const addr = server.address();
    const actual = typeof addr === "object" && addr ? addr.port : port;
    console.log(`job capture server on http://127.0.0.1:${actual} (root ${root})`);
  });
  return server;
}

if (import.meta.main) {
  loadTrackerEnv();
  startServer();
}
