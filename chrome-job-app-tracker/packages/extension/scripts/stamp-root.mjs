// Stamp the Jobs checkout root for the popup (copy commands, host install).
// Machine-local and gitignored; rewritten on every build.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
writeFileSync(path.join(extDir, "repo-root.txt"), `${path.resolve(extDir, "..", "..", "..")}\n`);
