import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { listApplications } from "@jat/core";
import { AppStatus } from "@jat/shared";
import { die } from "./prompt.js";

export function listHelp(): string {
  return `Usage: ja list [--status stage] [clipboard]

Tracker table with pdf state and csv/job.md drift warnings.
Default: every application. --status filters to one stage:
  ${AppStatus.options.join(", ")}

clipboard copies the plain-text table to the system clipboard
(pbcopy on macOS, else xclip, xsel, or wl-copy).

The job.md column stays blank while job.md agrees with the tracker;
a value there means the two have drifted (also reported below).`;
}

const ANSI: Record<string, string> = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/** Column widths shared by the header, the rule, and every row. */
const COLS = [10, 12, 24, 5, 6, 12, 7, 12];

/** Color only on a real terminal that hasn't opted out — piped output stays plain. */
function paint(text: string, color: string): string {
  if (!color || process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function stageColor(stage: string): string {
  switch (stage) {
    case "offer":
      return "green";
    case "interviewing":
      return "yellow";
    case "applied":
      return "cyan";
    case "rejected":
    case "withdrawn":
      return "red";
    default:
      return ""; // draft and anything unexpected stay plain
  }
}

function pdfColor(pdf: string): string {
  switch (pdf) {
    case "ok":
      return "green";
    case "stale":
      return "yellow";
    default:
      return "red";
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex -- the point is matching ESC
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function copyToClipboard(text: string): void {
  const tools = [
    ["pbcopy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
    ["wl-copy"],
  ];
  for (const [cmd, ...args] of tools) {
    const r = spawnSync(cmd, args, {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
    });
    if (!r.error && r.status === 0) return;
  }
  die("no clipboard tool found (tried pbcopy, xclip, xsel, wl-copy)");
}

export async function listCommand(root: string, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { status: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(listHelp());
    return;
  }
  const extra = positionals.filter((p) => p !== "clipboard");
  if (extra.length > 0) die("usage: ja list [--status stage] [clipboard]");
  let stage: string | undefined;
  if (values.status) {
    const parsed = AppStatus.safeParse(values.status);
    if (!parsed.success) die(`status must be one of: ${AppStatus.options.join(" ")}`);
    stage = parsed.data;
  }
  const { rows, warnings } = listApplications(root);
  const shown = stage ? rows.filter((r) => r.status === stage) : rows;
  if (shown.length === 0) {
    console.log(stage ? `no ${stage} applications` : "no applications yet — nothing tracked");
    return;
  }
  // Dim, never bold: bold glyphs render wider in most terminal fonts, which
  // drifts the header right of its column. Paint after padding — padding a
  // string that already holds escape codes would under-pad it.
  const lines: string[] = [""];
  const pad = (cells: string[]): string[] => cells.map((c, i) => c.padEnd(COLS[i]));
  const gap = "  ";
  const head = pad(["date", "company", "role", "track", "region", "status", "pdf", "job.md"]);
  lines.push(paint(head.join(gap), "dim"));
  lines.push(paint("─".repeat(head.join(gap).length), "dim"));
  for (const r of shown) {
    const cells = pad([
      r.date,
      r.company.slice(0, 12),
      r.role.slice(0, 24),
      r.track,
      r.region.toUpperCase(),
      r.status,
      r.pdf,
      r.jobStatus,
    ]);
    cells[0] = paint(cells[0], "magenta");
    cells[5] = paint(cells[5], stageColor(r.status));
    cells[6] = paint(cells[6], pdfColor(r.pdf));
    // Blank when job.md agrees with the tracker — a value here means drift.
    cells[7] = r.jobStatus === r.status ? " ".repeat(COLS[7]) : paint(cells[7], "red");
    lines.push(cells.join(gap));
  }
  const relevant = stage
    ? warnings.filter((w) => shown.some((r) => w.startsWith(`${r.folder}:`)))
    : warnings;
  if (relevant.length > 0) {
    lines.push("");
    for (const w of relevant) lines.push(paint(`! ${w}`, "yellow"));
  }
  lines.push("");
  if (positionals.includes("clipboard")) {
    copyToClipboard(lines.map(stripAnsi).join("\n"));
    console.log(`copied ${shown.length} application${shown.length === 1 ? "" : "s"} to clipboard`);
    return;
  }
  for (const line of lines) console.log(line);
}
