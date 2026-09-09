import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { addApplication, allResumes } from "@jat/core";
import { AppStatus, guessCompany } from "@jat/shared";
import { ask, die, readPaste, readStdin } from "./prompt.js";

export function addHelp(): string {
  return `Usage: ja add [job-url] [-c company] [-R role] [-t swe|csa] [-a us|ca|uk]
               [-d file|-] [--root DIR]

Creates applications/YYYY-MM-DD_company_role/ containing:
  job.md      the posting, verbatim
  resume.typ  wired to your track and region; everything else defaults
  notes.md    recruiter, referral, interview log
...and appends a row to applications.csv.

Flag defaults — every value is required, so a missing flag prompts and an
empty answer aborts instead of guessing:
  job-url       default: prompt (required — empty aborts)
  -c company    default: prompt (required; the URL guess is only a hint)
  -R role       default: prompt (required)
  -t swe|csa    default: prompt (required)
  -a us|ca|uk   default: prompt (required)
  -d file|-     default: stdin when piped, else paste + Ctrl-D
  --root DIR    default: $REPO_ROOT or current directory

The description is read last.`;
}

export async function addCommand(root: string, argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      c: { type: "string" },
      R: { type: "string" },
      t: { type: "string" },
      a: { type: "string" },
      d: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(addHelp());
    return;
  }
  let url = positionals[0] ?? "";
  let company = values.c ?? "";
  let role = values.R ?? "";
  let track = values.t ?? "";
  let region = values.a ?? "";
  const descFile = values.d;

  if (!url) url = await ask("Job URL");
  if (!company) company = await ask("Company", guessCompany(url));
  if (!role) role = await ask("Role title");
  if (!track) track = await ask("Track (swe|csa)");
  if (!region) region = await ask("Region (us|ca|uk)");

  let description: string;
  if (descFile === "-") {
    description = await readStdin();
  } else if (descFile) {
    if (!existsSync(descFile)) die(`no such file: ${descFile}`);
    description = readFileSync(descFile, "utf8");
  } else if (!process.stdin.isTTY) {
    description = await readStdin();
  } else {
    description = await readPaste();
  }

  let folder: string;
  try {
    ({ folder } = addApplication(root, { url, company, role, track, region, description }));
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
  console.log(`\ncreated ${folder}`);
  console.log(`  job.md  ${description.length} chars`);
  console.log(`
next — tailor it with whichever agent you're in:
  claude "tailor ${folder}/resume.typ to job.md"
  codex  "tailor ${folder}/resume.typ to job.md"
then:
  ja build ${folder}`);
}

export { allResumes, AppStatus };
