import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ensureHost } from "./install-host-cmd.js";
import { die } from "./prompt.js";

export function extensionHelp(): string {
  return `Usage: ja extension [--out DIR] [--watch]

Rebuilds the extension bundle and copies a load-ready folder to
~/Downloads/jat-extension (or --out). Load it at chrome://extensions
with Developer mode on, via Load unpacked. The repo stays the source
of truth — deleting the copy only unloads it until you re-run this.
Also ensures the native-messaging host is installed for the loaded
extension, skipping when it is already set up.
--watch keeps the copy in sync on every save; Chrome still needs a
manual Reload plus a tab reload to pick changes up.`;
}

const EXPORT_FILES = ["manifest.json", "popup.html", "dist", "icons"];

function buildAndExport(tracker: string, ext: string, out: string, jobsRoot: string): void {
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
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of EXPORT_FILES) {
    const src = path.join(ext, f);
    if (!existsSync(src)) die(`extension build incomplete — missing ${f}`);
    cpSync(src, path.join(out, f), { recursive: true });
  }
  writeFileSync(path.join(out, "repo-root.txt"), `${jobsRoot}\n`);
}

export async function extensionCommand(root: string, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      out: { type: "string" },
      watch: { type: "boolean", short: "w" },
      help: { type: "boolean", short: "h" },
    },
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
  const out = values.out ?? path.join(homedir(), "Downloads", "jat-extension");
  // Stamp the Jobs root so the popup builds runnable commands without the host.
  const jobsRoot = existsSync(path.join(root, "chrome-job-app-tracker", "package.json"))
    ? root
    : path.dirname(root);
  const candidates = [...new Set([ext, out, path.join(homedir(), "Downloads", "jat-extension")])];
  const hostStatus = (): void => {
    console.log(ensureHost(tracker, candidates));
  };
  if (!values.watch) {
    buildAndExport(tracker, ext, out, jobsRoot);
    console.log(
      `extension ready: ${out}\nload it at chrome://extensions (Developer mode → Load unpacked)`,
    );
    hostStatus();
    return;
  }
  console.log(`watching ${ext} → ${out} (Ctrl-C to stop)`);
  buildAndExport(tracker, ext, out, jobsRoot);
  console.log(`extension ready: ${out}`);
  hostStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reexport = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      buildAndExport(tracker, ext, out, jobsRoot);
      console.log(`re-exported: ${out}`);
    }, 300);
  };
  watch(path.join(ext, "src"), { recursive: true }, reexport);
  for (const f of ["popup.html", "manifest.json"]) watch(path.join(ext, f), reexport);
  await new Promise(() => {});
}
