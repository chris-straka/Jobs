import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const e2eDir = path.dirname(fileURLToPath(import.meta.url));
export const pkgDir = path.resolve(e2eDir, "..");
/** Jobs repo root (extension package lives three levels down). */
export const jobsRoot = path.resolve(pkgDir, "..", "..", "..");

export const JD =
  "Backend engineer. Kafka event streaming, Docker deployments, distributed systems, " +
  "Postgres, gRPC. ".repeat(10);

/** Temp Jobs repo: content + templates copied (Typst will not follow symlinks
 *  outside --root). No scripts needed — the server operates via @jat/core. */
export async function mkFixtureRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "jat-e2e-"));
  await mkdir(path.join(dir, "applications"), { recursive: true });
  await cp(path.join(jobsRoot, "content"), path.join(dir, "content"), { recursive: true });
  await cp(path.join(jobsRoot, "templates"), path.join(dir, "templates"), { recursive: true });
  const { rm } = await import("node:fs/promises");
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
};

/** Serve a directory over 127.0.0.1 on an ephemeral port. */
export async function startStatic(root: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    void (async () => {
      const file = path.normalize(path.join(root, (req.url ?? "/").split("?")[0]));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "text/plain" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export interface CaptureServer {
  url: string;
  stop: () => void;
}

/** Spawn the real capture server (Bun runs its TS directly) and read back its port. */
/** Model credential names the e2e child must never inherit (stays offline). */
const SECRET_KEYS = [
  "MODEL_API_URL",
  "MODEL_API_KEY",
  "MODEL_NAME",
  "META_BASE_URL",
  "META_API_KEY",
  "META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE",
];

export async function startCaptureServer(repoRoot: string): Promise<CaptureServer> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: "0",
    REPO_ROOT: repoRoot,
    JAT_AUTO_DRAFT: "0",
  };
  // Empty beats absent: the child loads chrome-job-app-tracker/.env with ??=,
  // so only present-but-empty keys keep the file from re-enabling the model.
  for (const k of SECRET_KEYS) env[k] = "";
  const child: ChildProcess = spawn("bun", [path.join(pkgDir, "..", "server", "src", "index.ts")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("capture server did not start")), 15000);
    let out = "";
    const onData = (d: Buffer): void => {
      out += d.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`capture server exited with ${code}: ${out.slice(-500)}`));
    });
  });
  return { url, stop: () => child.kill() };
}
