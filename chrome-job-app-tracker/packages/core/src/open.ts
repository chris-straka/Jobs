import { existsSync } from "node:fs";
import path from "node:path";
import { defaultRunner, type Runner } from "./build.js";

export type OpenVia = "code" | "finder";

/**
 * Open a tracked application folder in VS Code when the `code` CLI is on
 * PATH, otherwise in Finder (`open`). The lookup runs under the augmented
 * tool PATH, so servers spawned outside a shell still find a
 * homebrew-installed `code`.
 *
 * @throws when the folder is missing or neither opener launches
 */
export function openApplicationFolder(
  root: string,
  folder: string,
  run: Runner = defaultRunner,
): { via: OpenVia } {
  const dir = path.join(root, folder);
  if (!existsSync(dir)) throw new Error(`no such folder: ${folder}`);
  const found = run("sh", ["-c", "command -v code"]);
  const via: OpenVia = found.status === 0 && found.output.trim() !== "" ? "code" : "finder";
  const launched = run(via === "code" ? "code" : "open", [dir]);
  if (launched.status !== 0) {
    throw new Error(`could not open ${folder} (${via} exited ${launched.status ?? "?"})`);
  }
  return { via };
}
