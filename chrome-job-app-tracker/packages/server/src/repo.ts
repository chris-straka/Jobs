import path from "node:path";

/**
 * The Jobs repo root. Override with REPO_ROOT (the server test-suite does).
 * Default assumes this checkout layout: <root>/chrome-job-app-tracker/packages/server/src.
 */
export function repoRoot(): string {
  return process.env.REPO_ROOT ?? path.resolve(import.meta.dir, "../../../..");
}

export function serverPort(): number {
  return Number(process.env.PORT ?? 8765);
}
