import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppStatus } from "@jat/shared";
import { formatRow, parseCsv, type AppRow } from "./csv.js";

function jobStatus(jobMd: string): string | null {
  const m = /^status:\s*(\S+)/m.exec(jobMd);
  return m ? m[1] : null;
}

/**
 * Move an application to a new status in BOTH places that track it
 * (`applications.csv` and `job.md` front-matter) so they cannot drift.
 * CSV rows stay all-quoted with `\n` endings; the header is kept verbatim.
 *
 * @returns the previous status
 * @throws when the folder, `job.md` status line, or CSV row is missing
 */
export function setApplicationStatus(
  root: string,
  folder: string,
  status: AppStatus,
): { old: string } {
  const dir = path.join(root, folder);
  if (!existsSync(dir)) throw new Error(`no such folder: ${folder}`);
  const jobPath = path.join(dir, "job.md");
  if (!existsSync(jobPath)) throw new Error(`${folder} has no job.md`);

  const job = readFileSync(jobPath, "utf8");
  const m = /^status:\s*(\S+)/m.exec(job);
  if (!m) throw new Error(`${folder}/job.md has no 'status:' front-matter line`);
  const old = m[1];
  const start = m.index + m[0].length - old.length;
  writeFileSync(jobPath, `${job.slice(0, start)}${status}${job.slice(m.index + m[0].length)}`);

  const csvPath = path.join(root, "applications.csv");
  const raw = readFileSync(csvPath, "utf8");
  const nl = raw.indexOf("\n");
  const header = nl === -1 ? raw : raw.slice(0, nl);
  const { rows } = parseCsv(raw);
  const row = rows.find((r) => r.folder === folder);
  if (!row) throw new Error(`${folder} has no row in applications.csv`);
  row.status = status;
  const body = rows.map((r: AppRow) => formatRow(r)).join("\n");
  writeFileSync(csvPath, `${header}\n${body}\n`);
  return { old };
}

export type PdfState = "ok" | "stale" | "missing" | "no-typ";

export interface ListedApp extends AppRow {
  jobStatus: string;
  pdf: PdfState;
}

/**
 * Tracker rows joined with on-disk checks. Mirrors `bin/list`: pdf state
 * plus a warning per stale pdf, missing artifact, or csv/job.md drift.
 */
export function listApplications(root: string): { rows: ListedApp[]; warnings: string[] } {
  const csvPath = path.join(root, "applications.csv");
  if (!existsSync(csvPath)) return { rows: [], warnings: [] };
  const { rows } = parseCsv(readFileSync(csvPath, "utf8"));

  const out: ListedApp[] = [];
  const warnings: string[] = [];
  for (const r of rows) {
    const typ = path.join(root, r.folder, "resume.typ");
    const pdf = path.join(root, r.folder, "chris-straka-resume.pdf");
    const job = path.join(root, r.folder, "job.md");

    let pdfState: PdfState;
    if (!existsSync(typ)) {
      pdfState = "no-typ";
    } else if (!existsSync(pdf)) {
      pdfState = "missing";
      warnings.push(`${r.folder}: resume.pdf missing — run job-app build ${r.folder}`);
    } else if (statSync(typ).mtimeMs > statSync(pdf).mtimeMs) {
      pdfState = "stale";
      warnings.push(`${r.folder}: resume.typ newer than pdf — rebuild before sending`);
    } else {
      pdfState = "ok";
    }

    let current = "-";
    try {
      const found = jobStatus(readFileSync(job, "utf8"));
      if (found) current = found;
      else warnings.push(`${r.folder}: job.md has no status line`);
    } catch {
      warnings.push(`${r.folder}: job.md missing`);
    }
    if (current !== "-" && current !== r.status) {
      warnings.push(`${r.folder}: status drift (csv=${r.status}, job.md=${current})`);
    }
    out.push({ ...r, jobStatus: current, pdf: pdfState });
  }
  return { rows: out, warnings };
}
