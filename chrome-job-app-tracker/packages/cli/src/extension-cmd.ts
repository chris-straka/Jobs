import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { ensureHost } from "./install-host-cmd.js";
import { die } from "./prompt.js";

export function extensionHelp(): string {
  return `Usage: ja extension [--out DIR] [--watch]

Rebuilds the extension bundle in place and stamps repo-root.txt, so the
checkout copy at packages/extension is load-ready: load that folder at
chrome://extensions with Developer mode on, via Load unpacked, and hit
Reload there after rebuilding. --out DIR additionally copies a
load-ready folder to DIR. Also ensures the native-messaging host is
installed for the loaded extension, skipping when it is already set up.
--watch rebuilds on every save; Chrome still needs a manual Reload
plus a tab reload to pick changes up.`;
}

const EXPORT_FILES = ["manifest.json", "popup.html", "dashboard.html", "dist", "icons"];

function buildExtension(tracker: string): void {
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
}

function exportCopy(ext: string, out: string, jobsRoot: string): void {
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
  const out = values.out ?? null;
  // Stamp the Jobs root so the popup builds runnable commands without the host.
  const jobsRoot = existsSync(path.join(root, "chrome-job-app-tracker", "package.json"))
    ? root
    : path.dirname(root);
  const candidates = [
    ...new Set(
      [ext, path.join(homedir(), "Downloads", "jat-extension"), ...(out ? [out] : [])].map((c) =>
        path.normalize(c),
      ),
    ),
  ];
  const hostStatus = (): void => {
    console.log(`${ensureHost(tracker, candidates)}\n`);
  };
  // Rebuild dist in place; with --out, also refresh the exported copy.
  const refresh = (): void => {
    buildExtension(tracker);
    if (out) {
      exportCopy(ext, out, jobsRoot);
    } else {
      writeFileSync(path.join(ext, "repo-root.txt"), `${jobsRoot}\n`);
    }
  };
  const dir = out ?? ext;
  const readyBlock = `\nExtension rebuilt — load it in Chrome:\n\n  Go to chrome://extensions → Developer mode → Load unpacked (or Reload) with this folder:\n\n  ${dir}\n`;
  if (!values.watch) {
    refresh();
    console.log(readyBlock);
    hostStatus();
    return;
  }
  console.log(`watching ${ext}${out ? ` → ${out}` : " (in place)"} (Ctrl-C to stop)`);
  refresh();
  console.log(readyBlock);
  hostStatus();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reexport = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      refresh();
      console.log(`rebuilt: ${out ?? ext}`);
    }, 300);
  };
  watch(path.join(ext, "src"), { recursive: true }, reexport);
  for (const f of ["popup.html", "manifest.json"]) watch(path.join(ext, f), reexport);
  await new Promise(() => {});
}
