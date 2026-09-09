import { setApplicationStatus } from "@jat/core";
import type { AppStatus } from "@jat/shared";
import { die } from "./prompt.js";

export async function statusCommand(root: string, folder: string, status: AppStatus): Promise<void> {
  try {
    const { old } = setApplicationStatus(root, folder, status);
    console.log(`${folder}: ${old} -> ${status} (job.md + applications.csv)`);
  } catch (err) {
    die(err instanceof Error ? err.message : String(err));
  }
}
