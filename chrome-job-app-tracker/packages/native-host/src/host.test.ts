import { afterAll, describe, expect, it } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleCommand, hostEnv, readMessages } from "./host.js";

const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

function fixtureEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    JAT_JOBS_ROOT: "/tmp/jat-nonexistent",
    JAT_TRACKER_DIR: "/tmp/jat-nonexistent",
    JAT_PORT: "18765",
    ...extra,
  };
}

describe("handleCommand", () => {
  it("pings and rejects unknown commands", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-host-"));
    tmpDirs.push(tmp);
    const env = hostEnv(
      fixtureEnv({ JAT_PID_FILE: path.join(tmp, "s.pid"), JAT_LOG_FILE: path.join(tmp, "s.log") }),
    );
    expect(await handleCommand({ cmd: "ping" }, env)).toEqual({ ok: true });
    expect(await handleCommand({ cmd: "frobnicate" }, env)).toEqual({
      ok: false,
      reason: "unknown cmd",
    });
    expect(await handleCommand({ cmd: "status" }, env)).toEqual({ ok: true, running: false });
  });
});

describe("readMessages", () => {
  it("frames length-prefixed JSON, split across chunks", async () => {
    const a = Buffer.from(JSON.stringify({ cmd: "ping" }));
    const ha = Buffer.alloc(4);
    ha.writeUInt32LE(a.length, 0);
    const wire = Buffer.concat([ha, a]);
    async function* chunks(): AsyncGenerator<Uint8Array> {
      yield wire.subarray(0, 2);
      yield wire.subarray(2, 7);
      yield wire.subarray(7);
    }
    const got: unknown[] = [];
    for await (const m of readMessages(chunks())) got.push(m);
    expect(got).toEqual([{ cmd: "ping" }]);
  });
});

function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Speak the native protocol to a live host process. */
async function transact(child: ChildProcess, msg: unknown, timeoutMs = 15000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no reply from host")), timeoutMs);
    let buf = Buffer.alloc(0);
    const onData = (d: Buffer): void => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 4) {
        const n = buf.readUInt32LE(0);
        if (buf.length >= 4 + n) {
          clearTimeout(timer);
          child.stdout?.off("data", onData);
          resolve(JSON.parse(buf.subarray(4, 4 + n).toString("utf8")));
        }
      }
    };
    child.stdout?.on("data", onData);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stdin?.write(frame(msg));
  });
}

describe("host process", () => {
  it("starts the real server detached, reports status, stops it", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "jat-host-"));
    tmpDirs.push(tmp);
    const tracker = path.resolve(pkgDir, "..", "..");
    const child = spawn("bun", [path.join(pkgDir, "src", "host.ts")], {
      env: {
        ...process.env,
        JAT_JOBS_ROOT: tmp,
        JAT_TRACKER_DIR: tracker,
        JAT_PORT: "18765",
        JAT_PID_FILE: path.join(tmp, "s.pid"),
        JAT_LOG_FILE: path.join(tmp, "s.log"),
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    try {
      expect(await transact(child, { cmd: "ping" })).toEqual({ ok: true });
      const started = (await transact(child, { cmd: "start" }, 30000)) as {
        ok: boolean;
        pid: number;
      };
      expect(started.ok).toBe(true);

      // The server answers while the one-shot host for `start` is long gone.
      let up = false;
      for (let i = 0; i < 50 && !up; i++) {
        try {
          const r = await fetch("http://127.0.0.1:18765/health");
          up = r.ok;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      expect(up).toBe(true);

      expect(await transact(child, { cmd: "status" })).toEqual({
        ok: true,
        running: true,
        pid: started.pid,
      });
      expect(await transact(child, { cmd: "stop" })).toEqual({ ok: true, running: false });
      expect(await transact(child, { cmd: "status" })).toEqual({ ok: true, running: false });
    } finally {
      child.kill();
    }
  }, 120000);
});
