import { parseArgs } from "node:util";
import { listApplications } from "@jat/core";
import { AppStatus } from "@jat/shared";
import { die } from "./prompt.js";

export function listHelp(): string {
  return `Usage: ja list [--status stage]

Tracker table with pdf state and csv/job.md drift warnings.
Default: every application. --status filters to one stage:
  ${AppStatus.options.join(", ")}`;
}

const ANSI: Record<string, string> = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/** Column widths shared by the header, the rule, and every row. */
const COLS = [10, 12, 24, 5, 6, 12, 12, 7];

/** Color only on a real terminal that hasn't opted out — piped output stays plain. */
function paint(text: string, color: string): string {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
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
      return "gray";
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

export async function listCommand(root: string, argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: { status: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help) {
    console.log(listHelp());
    return;
  }
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
  const pad = (cells: string[]): string[] => cells.map((c, i) => c.padEnd(COLS[i]));
  console.log("");
  const head = pad(["date", "company", "role", "track", "region", "status", "job", "pdf"]);
  console.log(paint(head.join(" "), "dim"));
  console.log(paint("─".repeat(head.join(" ").length), "dim"));
  for (const r of shown) {
    const cells = pad([
      r.date,
      r.company.slice(0, 12),
      r.role.slice(0, 24),
      r.track,
      r.region,
      r.status,
      r.jobStatus,
      r.pdf,
    ]);
    cells[5] = paint(cells[5], stageColor(r.status));
    cells[6] = paint(cells[6], stageColor(r.jobStatus));
    cells[7] = paint(cells[7], pdfColor(r.pdf));
    console.log(cells.join(" "));
  }
  const relevant = stage
    ? warnings.filter((w) => shown.some((r) => w.startsWith(`${r.folder}:`)))
    : warnings;
  if (relevant.length > 0) {
    console.log("");
    for (const w of relevant) console.log(paint(`! ${w}`, "yellow"));
  }
  console.log("");
}
