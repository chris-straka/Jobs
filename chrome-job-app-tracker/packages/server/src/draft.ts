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
/** Density overrides, applied before cutting bullets (per AGENTS.md). */
export interface DraftKnobs {
  leading?: string;
  bulletGap?: string;
  sectionGap?: string;
  projectGap?: string;
}

/** The tightened knobs a hand tailor would reach for first. */
export const TIGHT_KNOBS: Required<DraftKnobs> = {
  leading: "0.40em",
  bulletGap: "5pt",
  sectionGap: "14pt",
  projectGap: "11pt",
};

function knobLines(knobs?: DraftKnobs): string {
  if (!knobs) return "";
  const args: string[] = [];
  if (knobs.leading) args.push(`  leading: ${knobs.leading},`);
  if (knobs.bulletGap) args.push(`  bullet-gap: ${knobs.bulletGap},`);
  if (knobs.sectionGap) args.push(`  section-gap: ${knobs.sectionGap},`);
  if (knobs.projectGap) args.push(`  project-gap: ${knobs.projectGap},`);
  return args.length > 0 ? `${args.join("\n")}\n` : "";
}

export function buildResumeTyp(input: DraftInput, knobs?: DraftKnobs): string {
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
${knobLines(knobs)})`;
}

/**
 * Trim primitive for the fit loop: drops the last bullet of the
 * lowest-ranked project holding more than one, else drops the whole
 * lowest-ranked project. Never drops the final bullet.
 */
export function dropOneBullet(bullets: BulletRef[], fitOrder: string[]): BulletRef[] {
  if (bullets.length <= 1) return bullets;
  const rank = (p: string): number => {
    const i = fitOrder.indexOf(p);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const projects = [...new Set(bullets.map((b) => b.project))].sort((a, b) => rank(b) - rank(a));
  for (const p of projects) {
    const ids = bullets.filter((b) => b.project === p);
    if (ids.length > 1) {
      const drop = ids[ids.length - 1];
      return bullets.filter((b) => b !== drop);
    }
  }
  // Descending rank: projects[0] is the lowest fit — drop it whole.
  const dropProject = projects[0];
  const kept = bullets.filter((b) => b.project !== dropProject);
  return kept.length > 0 ? kept : bullets;
}

/** Auto-draft is the point of capture: opt out with `JAT_AUTO_DRAFT=0`. */
export function autoDraftEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JAT_AUTO_DRAFT !== "0";
}
