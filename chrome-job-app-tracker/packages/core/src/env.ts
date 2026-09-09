import { readFileSync } from "node:fs";

/**
 * Load a `.env` file without overriding real environment variables.
 * Comment lines, `export` prefixes, and single/double quotes handled.
 */
export function loadEnvFile(file: string): void {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(t);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    process.env[m[1]] ??= v;
  }
}
