import type { BulletRef } from "@jat/shared";

export interface DraftInput {
  track: string;
  region: string;
  summary: string;
  bullets: BulletRef[];
  /** Project ids ordered by fit rank — suggested projects follow this order. */
  fitOrder: string[];
}

/** Escape for a double-quoted Typst string on one line. */
function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ").trim();
}

/**
 * Renders a starter `resume.typ` with the model-drafted summary and suggested
 * bullets grouped by project. Every id was library-filtered upstream, so the
 * renderer cannot hit an unknown bullet.
 */
export function buildResumeTyp(input: DraftInput): string {
  const groups = new Map<string, string[]>();
  for (const b of input.bullets) {
    const list = groups.get(b.project) ?? [];
    if (!list.includes(b.id)) list.push(b.id);
    groups.set(b.project, list);
  }
  const rank = (id: string): number => {
    const i = input.fitOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));

  // Trailing comma always: in Typst ("x") is a parenthesized string,
  // only ("x",) is a one-element array.
  const projects = ordered
    .map(([id, ids]) => `    (id: "${id}", bullets: (${ids.map((b) => `"${b}"`).join(", ")},)),`)
    .join("\n");

  return `#import "../../templates/lib.typ": resume

#resume(
  track: "${input.track}",
  region: "${input.region}",
  summary: "${esc(input.summary)}",
  projects: (
${projects}
  ),
)
`;
}

/** Auto-draft is the point of capture: opt out with `JAT_AUTO_DRAFT=0`. */
export function autoDraftEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JAT_AUTO_DRAFT !== "0";
}
