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
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

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
  console.log(
    paint(
      `${"date".padEnd(10)} ${"company".padEnd(12)} ${"role".padEnd(24)} ${"track".padEnd(5)} ${"region".padEnd(6)} ${"status".padEnd(12)} ${"job".padEnd(12)} ${"pdf".padEnd(7)}`,
      "bold",
    ),
  );
  for (const r of shown) {
    console.log(
      `${r.date.padEnd(10)} ${r.company.slice(0, 12).padEnd(12)} ${r.role.slice(0, 24).padEnd(24)} ` +
        `${r.track.padEnd(5)} ${r.region.padEnd(6)}` +
        `${paint(r.status.padEnd(12), stageColor(r.status))}` +
        `${paint(r.jobStatus.padEnd(12), stageColor(r.jobStatus))}` +
        `${paint(r.pdf.padEnd(7), pdfColor(r.pdf))}`,
    );
  }
  const relevant = stage
    ? warnings.filter((w) => shown.some((r) => w.startsWith(`${r.folder}:`)))
    : warnings;
  if (relevant.length > 0) {
    console.log("");
    for (const w of relevant) console.log(paint(`! ${w}`, "yellow"));
  }
}
