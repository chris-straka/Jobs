import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { die } from "./prompt.js";

export function extensionHelp(): string {
  return `Usage: ja extension [--out DIR]

Rebuilds the extension bundle and copies a load-ready folder to
~/Downloads/jat-extension (or --out). Load it at chrome://extensions
with Developer mode on, via Load unpacked. The repo stays the source
of truth — deleting the copy only unloads it until you re-run this.`;
}

const EXPORT_FILES = ["manifest.json", "popup.html", "dist", "icons"];

export async function extensionCommand(root: string, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: { out: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(extensionHelp());
    return;
  }
  const tracker = existsSync(path.join(root, "chrome-job-app-tracker", "package.json"))
    ? path.join(root, "chrome-job-app-tracker")
    : root;
  const ext = path.join(tracker, "packages", "extension");
  if (!existsSync(path.join(ext, "package.json"))) die(`no extension checkout under ${tracker}`);
  const build = spawnSync("bun", ["run", "--filter", "@jat/extension", "build"], {
    cwd: tracker,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (build.error || build.status !== 0) {
    die(
      `extension build failed — run it by hand in ${tracker}${build.error ? " (bun not found?)" : `:\n${build.stderr}`}`,
    );
  }
  const out = values.out ?? path.join(homedir(), "Downloads", "jat-extension");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of EXPORT_FILES) {
    const src = path.join(ext, f);
    if (!existsSync(src)) die(`extension build incomplete — missing ${f}`);
    cpSync(src, path.join(out, f), { recursive: true });
  }
  console.log(
    `extension ready: ${out}\nload it at chrome://extensions (Developer mode → Load unpacked)`,
  );
}
