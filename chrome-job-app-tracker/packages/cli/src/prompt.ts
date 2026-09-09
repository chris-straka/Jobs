import { createInterface } from "node:readline/promises";

export function die(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Prompt on the terminal. Dies when there is no terminal (piped/CI). */
export async function ask(prompt: string, hint = ""): Promise<string> {
  if (!process.stdin.isTTY) die(`no terminal to prompt on — pass ${prompt} as a flag`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const suffix = hint ? ` (guess: ${hint})` : "";
    const reply = await rl.question(`${prompt}${suffix}: `);
    if (!reply.trim()) die(`${prompt} is required`);
    return reply;
  } finally {
    rl.close();
  }
}

/** Read piped stdin to EOF (add-job's `-d -` / pipe behavior). */
export async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  return `${lines.join("\n")}\n`;
}

/** Interactive paste: instructions on stderr, text until Ctrl-D. */
export async function readPaste(): Promise<string> {
  if (!process.stdin.isTTY) return readStdin();
  console.error(`
Paste the full job description, then press Ctrl-D on a blank line.
Keep it verbatim: it's the record of what you were asked for, and it's what
the agent reads to tailor the resume.
`);
  return readStdin();
}
