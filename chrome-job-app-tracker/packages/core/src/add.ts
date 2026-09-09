import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { appFolder } from "@jat/shared";
import { CSV_HEADER, formatRow, type AppRow } from "./csv.js";

export interface AddInput {
  url: string;
  company: string;
  role: string;
  track: string;
  region: string;
  description: string;
}

function localDate(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function resumeTyp(track: string, region: string): string {
  return `#import "../../templates/lib.typ": resume\n\n#resume(\n  track: "${track}",\n  region: "${region}",\n)\n`;
}

function jobMd(input: Required<Pick<AddInput, "company" | "role" | "track" | "region" | "url">>, date: string, description: string): string {
  return `---\ncompany: "${input.company}"\nrole: "${input.role}"\ntrack: ${input.track}\nregion: ${input.region}\nurl: "${input.url}"\nsaved: ${date}\nstatus: draft\n---\n\n${description}\n`;
}

function notesMd(company: string, role: string): string {
  return `# ${company} — ${role}\n\n- Applied:\n- Source / referral:\n- Recruiter:\n\n## Why this one\n\n## Interview log\n\n## Follow-ups\n`;
}

/**
 * Scaffold one application: dated folder, starter resume, saved posting,
 * notes, and a tracker row. Mirrors the retired `bin/add-job` exactly
 * (filenames, front-matter, all-quoted CSV).
 *
 * @throws when a field is missing/invalid, the folder exists, or the description is empty
 */
export function addApplication(
  root: string,
  input: AddInput,
  date = localDate(),
): { folder: string } {
  const url = input.url.trim();
  const company = input.company.trim();
  const role = input.role.trim();
  const track = input.track.trim();
  const region = input.region.trim();
  const description = input.description;
  if (!url) throw new Error("Job URL is required");
  if (!company) throw new Error("Company is required");
  if (!role) throw new Error("Role title is required");
  if (track !== "swe" && track !== "csa") throw new Error(`track must be 'swe' or 'csa' (got '${track}')`);
  if (region !== "us" && region !== "ca" && region !== "uk")
    throw new Error(`region must be us, ca or uk (got '${region}')`);
  if (!description || !description.trim()) throw new Error("job description was empty — nothing saved");

  const folder = `applications/${appFolder(date, company, role)}`;
  const dir = path.join(root, folder);
  if (existsSync(dir)) throw new Error(`already exists: ${folder}`);
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(dir, "resume.typ"), resumeTyp(track, region));
  writeFileSync(
    path.join(dir, "job.md"),
    jobMd({ company, role, track, region, url }, date, description),
  );
  writeFileSync(path.join(dir, "notes.md"), notesMd(company, role));

  const csvPath = path.join(root, "applications.csv");
  if (!existsSync(csvPath)) writeFileSync(csvPath, `${CSV_HEADER}\n`);
  const row: AppRow = { date, company, role, track, region, status: "draft", url, folder };
  appendFileSync(csvPath, `${formatRow(row)}\n`);
  return { folder };
}

/** Folders containing a resume, sorted — the default build set. */
export function allResumes(root: string): string[] {
  const apps = path.join(root, "applications");
  let entries: string[];
  try {
    entries = readdirSync(apps);
  } catch {
    return [];
  }
  return entries
    .filter((e) => existsSync(path.join(apps, e, "resume.typ")))
    .sort()
    .map((e) => `applications/${e}/resume.typ`);
}
