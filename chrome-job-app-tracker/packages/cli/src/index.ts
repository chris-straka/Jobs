import { parseArgs } from "node:util";
import { allResumes, buildResumes } from "@jat/core";
import { AppStatus } from "@jat/shared";
import { addCommand } from "./add.js";
import { listCommand } from "./list-cmd.js";
import { statusCommand } from "./status-cmd.js";
import { serverCommand } from "./server-cmd.js";
import { probeCommand } from "./probe-cmd.js";
import { die } from "./prompt.js";
import pkg from "../package.json" with { type: "json" };

const COMMANDS = ["add", "build", "list", "status", "server", "probe"] as const;

function sparse(): string {
  return `ja v${(pkg as { version: string }).version} — one CLI for the Jobs repo

  add       scaffold an application folder
  build     compile resumes (default: all)
  list      tracker table + drift warnings
  status    move an application (csv + job.md)
  server    start the local capture server
  probe     verify the model wiring

ja --help for flags and defaults.`;
}

function help(): string {
  return `ja v${(pkg as { version: string }).version} — one CLI for the Jobs repo

Usage: ja [--root DIR] <command> [args]   (default root: $REPO_ROOT or cwd)

  add [url] [-c company] [-R role] [-t swe|csa] [-a us|ca|uk] [-d file|-]
      scaffold applications/YYYY-MM-DD_company_role/ (missing flags are prompted)
  build [targets...]
      compile resumes, fail on >1 page or TODO bullets (default: all)
  list
      tracker table with pdf state and csv/job.md drift warnings
  status <folder> <draft|applied|interviewing|offer|rejected|withdrawn>
      move csv + job.md together
  server [--port N]
      start the local capture server, loopback only (default port: $PORT or 8765)
  probe
      verify the model wiring with a tiny completion

Run from the repo root, or pass --root. ja <command> --help for detail.`;
}

function rootFrom(argv: string[]): { root: string; rest: string[] } {
  const idx = argv.indexOf("--root");
  if (idx !== -1) {
    const root = argv[idx + 1];
    if (!root) die("--root needs a value");
    return { root, rest: [...argv.slice(0, idx), ...argv.slice(idx + 2)] };
  }
  return { root: process.env.REPO_ROOT ?? process.cwd(), rest: argv };
}

async function main(): Promise<void> {
  const { root, rest } = rootFrom(process.argv.slice(2));
  const [cmd, ...args] = rest;
  if (!cmd) {
    console.log(sparse());
    return;
  }
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(help());
    return;
  }
  switch (cmd) {
    case "add":
      await addCommand(root, args);
      return;
    case "build": {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { help: { type: "boolean", short: "h" } },
      });
      if (values.help) {
        console.log("Usage: ja build [resume.typ|folder]...\n\nNo args builds everything.");
        return;
      }
      const targets = positionals.length > 0 ? positionals : allResumes(root);
      if (targets.length === 0) {
        console.log("no applications yet — nothing to build");
        return;
      }
      const report = buildResumes(root, targets);
      for (const line of report.lines) console.log(line);
      if (!report.ok) process.exit(1);
      return;
    }
    case "list":
      await listCommand(root);
      return;
    case "status": {
      const [folder, status] = args;
      if (!folder || !status) die("usage: ja status <folder> <status>");
      const parsed = AppStatus.safeParse(status);
      if (!parsed.success) die(`status must be one of: ${AppStatus.options.join(" ")}`);
      await statusCommand(root, folder, parsed.data);
      return;
    }
    case "server": {
      const { values } = parseArgs({
        args,
        allowPositionals: false,
        options: { port: { type: "string" }, help: { type: "boolean", short: "h" } },
      });
      if (values.help) {
        console.log(
          "Usage: ja server [--port N]\n\nLoopback only. Default port is $PORT, or 8765 when unset.",
        );
        return;
      }
      await serverCommand(root, values.port ? Number(values.port) : undefined);
      return;
    }
    case "probe":
      await probeCommand(root);
      return;
    default:
      die(`unknown command '${cmd}' (expected one of: ${COMMANDS.join(", ")})`);
  }
}

await main();
