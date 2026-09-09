import { frequencies, tokenize } from "./keywords.js";
import type { FitReport } from "./schemas.js";

export interface LibraryBullet {
  id: string;
  text: string;
}

export interface LibraryProject {
  id: string;
  name: string;
  bullets: LibraryBullet[];
}

const TOP_PROJECTS = 3;
const TOP_GAPS = 20;

/**
 * Deterministic fit: which library projects cover the posting's vocabulary,
 * and which posting keywords appear nowhere in the library (gaps).
 * No model involved — same input always yields same output.
 */
export function analyzeFit(description: string, library: LibraryProject[]): FitReport {
  const jdFreq = frequencies(description);
  const jdTokens = new Set(jdFreq.map(([t]) => t));

  const libraryTokens = new Set<string>();
  const scored = library.map((p) => {
    const projectTokens = new Set<string>();
    for (const b of p.bullets) for (const t of tokenize(b.text)) projectTokens.add(t);
    for (const t of projectTokens) libraryTokens.add(t);
    const matched = [...jdTokens].filter((t) => projectTokens.has(t)).sort();
    return {
      id: p.id,
      name: p.name,
      score: jdTokens.size === 0 ? 0 : Math.round((matched.length / jdTokens.size) * 1000) / 1000,
      matched,
    };
  });
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const gaps = jdFreq
    .filter(([t]) => !libraryTokens.has(t))
    .slice(0, TOP_GAPS)
    .map(([t]) => t);

  return {
    projects: scored.slice(0, TOP_PROJECTS),
    gaps,
    libraryBullets: library.reduce((n, p) => n + p.bullets.length, 0),
  };
}
