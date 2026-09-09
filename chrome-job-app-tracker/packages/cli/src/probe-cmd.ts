import path from "node:path";
import { loadEnvFile } from "@jat/core";
import { runProbe } from "@jat/server";

/** Same `.env` lookup as `server`, then the shared probe. */
export async function probeCommand(root: string): Promise<void> {
  loadEnvFile(path.join(root, "chrome-job-app-tracker", ".env"));
  loadEnvFile(path.join(root, ".env"));
  process.exit(await runProbe());
}
