import path from "node:path";
import { loadEnvFile } from "@jat/core";
import { startServer } from "@jat/server";

/**
 * Serve the Jobs repo over loopback. Loads `<root>/chrome-job-app-tracker/.env`
 * (or `<root>/.env` when root already is the tracker) without overriding
 * exported variables.
 */
export async function serverCommand(root: string, port?: number): Promise<void> {
  loadEnvFile(path.join(root, "chrome-job-app-tracker", ".env"));
  loadEnvFile(path.join(root, ".env"));
  startServer({ root, port });
  // Keep the process alive while the server listens.
  await new Promise(() => {});
}
