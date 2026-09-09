export interface PageCandidate {
  source: string;
  text: string;
}

export interface PostingSignals {
  hasApplyButton: boolean;
  descriptionLength: number;
  title: string;
}

export interface SignalResult {
  isPosting: boolean;
  reasons: string[];
}

/** Collapse whitespace — posting text arrives with layout noise. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Matches clickable apply controls: "Apply now", "Easy Apply", "Submit application". */
export const APPLY_TEXT = /appl(y|ication)|submit.*application|easy apply/i;

/**
 * Heuristic page classifier. Each signal is weak alone (your old extension
 * proved that) — a page counts as a posting on an apply button plus
 * substance, or on any two signals agreeing.
 *
 * @param s observable page signals
 * @returns verdict plus the reasons, so false positives stay debuggable
 */
export function postingSignals(s: PostingSignals): SignalResult {
  const reasons: string[] = [];
  if (s.hasApplyButton) reasons.push("apply button");
  if (s.descriptionLength >= 800) reasons.push("long description");
  if (/job|career|hiring|posting|engineer|analyst|developer/i.test(s.title))
    reasons.push("posting-like title");
  const isPosting = (s.hasApplyButton && s.descriptionLength >= 200) || reasons.length >= 2;
  return { isPosting, reasons };
}

/**
 * @param host lowercase hostname, e.g. from `new URL(url).hostname`
 * @param denyHosts hosts the user flagged via "Not a posting"
 * @returns true when the pill must stay hidden on this host
 */
export function isDenied(host: string, denyHosts: string[]): boolean {
  const h = host.toLowerCase();
  return denyHosts.some((d) => d.toLowerCase() === h);
}

/**
 * Pure pick: longest substantial candidate wins, title as fallback.
 *
 * @param title `document.title`, used when no candidate is substantial
 * @param candidates raw text grabs with their source selector
 * @returns whitespace-collapsed posting text (or title)
 */
export function pickDescription(title: string, candidates: PageCandidate[]): string {
  const texts = candidates
    .map((c) => cleanText(c.text))
    .filter((t) => t.length >= 200)
    .sort((a, b) => b.length - a.length);
  return texts[0] ?? cleanText(title);
}
