import http from "node:http";
import { CaptureRequest, CaptureResponse, analyzeFit } from "@jat/shared";
import { repoRoot, serverPort } from "./repo.js";
import { loadLibrary } from "./library.js";
import { scaffold, verifyBuild } from "./capture.js";
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
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

export function startServer(opts: { port?: number; root?: string } = {}): http.Server {
  const root = opts.root ?? repoRoot();
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, { ok: true });
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
          const build = verifyBuild(root, folder);
          const model = await suggest(parsed.data.description, library);
          json(
            res,
            200,
            CaptureResponse.parse({
              folder,
              buildOk: build.ok,
              buildOutput: build.output,
              fit,
              model,
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
  server.listen(opts.port ?? serverPort());
  return server;
}

if (import.meta.main) {
  const port = serverPort();
  startServer({ port });
  console.log(`job capture server on http://127.0.0.1:${port} (root ${repoRoot()})`);
}
