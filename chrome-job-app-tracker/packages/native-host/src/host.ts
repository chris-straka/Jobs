/**
 * Native-messaging host: the one local process Chrome is allowed to speak to.
 *
 * Chrome spawns this per message (`sendNativeMessage`) and speaks the native
 * protocol over stdio: uint32LE length + JSON. It starts/stops the capture
 * server as a detached child tracked by pidfile, so the server outlives us.
 *
 * Configuration comes from the environment (baked in by `install.sh`):
 *   JAT_JOBS_ROOT    Jobs repo the server writes into
 *   JAT_TRACKER_DIR  chrome-job-app-tracker checkout
 *   JAT_PORT         server port (default 8765)
 *   JAT_PID_FILE     where the server pid lives (default os.tmpdir())
 *   JAT_LOG_FILE     server stdout/stderr (default os.tmpdir())
 *
 * Protocol in:  { cmd: "ping" | "status" | "start" | "stop" }
 * Protocol out: { ok: true, ... } / { ok: false, reason: string }
 */
import { spawn } from "node:child_process";
import { openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface HostEnv {
  jobsRoot: string;
  trackerDir: string;
  port: string;
  pidFile: string;
  logFile: string;
  bun: string;
}

export function hostEnv(env: NodeJS.ProcessEnv = process.env): HostEnv {
  const trackerDir = env.JAT_TRACKER_DIR ?? path.resolve(import.meta.dir, "..", "..");
  const jobsRoot = env.JAT_JOBS_ROOT ?? path.resolve(trackerDir, "..");
  const tmp = tmpdir();
  return {
    jobsRoot,
    trackerDir,
    port: env.JAT_PORT ?? "8765",
    pidFile: env.JAT_PID_FILE ?? path.join(tmp, "jat-server.pid"),
    logFile: env.JAT_LOG_FILE ?? path.join(tmp, "jat-server.log"),
    bun: env.JAT_BUN ?? "bun",
  };
}

function readPid(pidFile: string): number | null {
  try {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function handleCommand(
  msg: { cmd?: unknown },
  env: HostEnv,
  deps: {
    spawnServer?: typeof spawn;
    waitMs?: number;
  } = {},
): Promise<Record<string, unknown>> {
  switch (msg.cmd) {
    case "ping":
      return { ok: true };
    case "status": {
      const pid = readPid(env.pidFile);
      return pid ? { ok: true, running: true, pid } : { ok: true, running: false };
    }
    case "start": {
      const running = readPid(env.pidFile);
      if (running) return { ok: true, already: true, pid: running };
      const logFd = openSync(env.logFile, "a");
      const spawnFn = deps.spawnServer ?? spawn;
      const child = spawnFn(
        env.bun,
        [path.join(env.trackerDir, "packages", "server", "src", "index.ts")],
        {
          cwd: env.trackerDir,
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: { ...process.env, PORT: env.port, REPO_ROOT: env.jobsRoot },
        },
      );
      child.unref();
      const pid = child.pid;
      if (!pid) return { ok: false, reason: "spawn failed" };
      // Confirm it survives our exit before claiming success.
      for (let i = 0; i < 20; i++) {
        await sleep(deps.waitMs ?? 100);
        try {
          process.kill(pid, 0);
          writeFileSync(env.pidFile, String(pid));
          return { ok: true, pid };
        } catch {
          continue;
        }
      }
      return { ok: false, reason: "server died immediately — see log" };
    }
    case "stop": {
      const pid = readPid(env.pidFile);
      if (!pid) {
        try {
          unlinkSync(env.pidFile);
        } catch {
          // already gone
        }
        return { ok: true, running: false };
      }
      try {
        process.kill(pid);
      } catch {
        return { ok: false, reason: "kill failed" };
      }
      for (let i = 0; i < 20; i++) {
        await sleep(deps.waitMs ?? 100);
        if (readPid(env.pidFile) === null) {
          try {
            unlinkSync(env.pidFile);
          } catch {
            // raced away
          }
          return { ok: true, running: false };
        }
      }
      return { ok: false, reason: "process would not die" };
    }
    default:
      return { ok: false, reason: "unknown cmd" };
  }
}

const HEADER = 4;

/** Read length-prefixed JSON messages from stdin (Chrome native protocol). */
export async function* readMessages(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<unknown, void, void> {
  let buf = Buffer.alloc(0);
  for await (const chunk of stream) {
    buf = Buffer.concat([buf, Buffer.from(chunk)]);
    while (buf.length >= HEADER) {
      const n = buf.readUInt32LE(0);
      if (buf.length < HEADER + n) break;
      yield JSON.parse(buf.subarray(HEADER, HEADER + n).toString("utf8"));
      buf = buf.subarray(HEADER + n);
    }
  }
}

/** Write one length-prefixed JSON reply to stdout. */
export function writeMessage(value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const head = Buffer.alloc(HEADER);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

if (import.meta.main) {
  const env = hostEnv();
  for await (const msg of readMessages(Bun.stdin.stream() as AsyncIterable<Uint8Array>)) {
    writeMessage(await handleCommand((msg ?? {}) as { cmd?: unknown }, env));
  }
}
