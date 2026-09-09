import { spawn, type ChildProcess } from "node:child_process";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
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

/** Temp Jobs repo: real add-job/build.sh (copied — they resolve ROOT from $0),
 *  content + templates copied (Typst will not follow symlinks outside --root). */
export async function mkFixtureRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "jat-e2e-"));
  await mkdir(path.join(dir, "bin"), { recursive: true });
  for (const f of ["add-job", "build.sh"]) {
    await copyFile(path.join(jobsRoot, "bin", f), path.join(dir, "bin", f));
    await chmod(path.join(dir, "bin", f), 0o755);
  }
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
export async function startCaptureServer(repoRoot: string): Promise<CaptureServer> {
  const child: ChildProcess = spawn("bun", [path.join(pkgDir, "..", "server", "src", "index.ts")], {
    env: { ...process.env, PORT: "0", REPO_ROOT: repoRoot },
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
