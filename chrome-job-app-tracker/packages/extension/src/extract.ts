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

/** Aggregators never get the pill — hiring.cafe links out, it isn't a posting. */
const BUILT_IN_DENIED = /(hiring\.cafe|hiringcafe\.com)$/;

/**
 * @param host lowercase hostname, e.g. from `new URL(url).hostname`
 * @param denyHosts hosts the user flagged via "Not a posting"
 * @returns true when the pill must stay hidden on this host
 */
export function isDenied(host: string, denyHosts: string[]): boolean {
  const h = host.toLowerCase();
  return BUILT_IN_DENIED.test(h) || denyHosts.some((d) => d.toLowerCase() === h);
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

const ROLE_WORDS =
  /engineer|developer|analyst|designer|manager|intern|student|scientist|specialist|consultant|architect|administrator|coordinator|assistant|devops/i;

/**
 * Pure title clean: a trailing " | Site" / " - Site" suffix goes only when
 * another segment names the role, so both "Role | Company" and
 * "Company - Role" resolve to the role.
 */
export function cleanTitle(raw: string): string {
  const t = cleanText(raw);
  const segs = t
    .split(/\s+[|\-–—]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segs.length < 2) return t;
  return segs.find((s) => ROLE_WORDS.test(s)) ?? segs[0];
}

/** Pure title pick: first h1 wins, then og:title, then document.title. */
export function pickTitle(h1: string, og: string, docTitle: string): string {
  const raw = [h1, og, docTitle].map(cleanText).find((t) => t.length > 0) ?? "";
  return cleanTitle(raw);
}

/**
 * Track from the posting itself: analyst work is CSA, everything else SWE.
 * A prefill guess, not a verdict — the field stays editable in resume.typ.
 */
export function detectTrack(title: string, description: string): "swe" | "csa" {
  return /analyst/i.test(`${title} ${description}`) ? "csa" : "swe";
}

const REGION_SIGNALS: { region: "us" | "ca" | "uk"; patterns: RegExp[] }[] = [
  {
    region: "ca",
    patterns: [
      /canada|canadian/i,
      /\btoronto\b|\bvancouver\b|\bcalgary\b|\bedmonton\b|\bottawa\b|\bmontreal\b|\bwinnipeg\b|\bhalifax\b/i,
      /\bontario\b|\bquebec\b|\balberta\b|british columbia|\bmanitoba\b|\bsaskatchewan\b|nova scotia|new brunswick/i,
    ],
  },
  {
    region: "us",
    patterns: [
      /united states|\bu\.?s\.?a\.?\b/i,
      /\bcalifornia\b|\btexas\b|\bflorida\b|\billinois\b|\bcolorado\b|\bmassachusetts\b/i,
      /\bnew york\b|\bseattle\b|\baustin\b|\bboston\b|\bchicago\b|\bdenver\b|\batlanta\b/i,
    ],
  },
  {
    region: "uk",
    patterns: [
      /united kingdom|\bbritain\b|\bengland\b|\bscotland\b|\bwales\b/i,
      /\blondon\b|\bmanchester\b|\bedinburgh\b|\bbirmingham\b|\bleeds\b|\bglasgow\b/i,
    ],
  },
];

/**
 * Region prefill from URL suffix (.ca/.uk fast path) then posting-text
 * scoring. Bare "us" never matches — it's a pronoun. Ties and silence
 * return "" and the caller falls back to the default.
 */
export function guessRegion(rawUrl: string, text: string): "us" | "ca" | "uk" | "" {
  let host = "";
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    // unparseable — score the text only
  }
  if (/\.ca$/.test(host)) return "ca";
  if (/\.co\.uk$|\.uk$/.test(host)) return "uk";
  const scores = { us: 0, ca: 0, uk: 0 };
  for (const { region, patterns } of REGION_SIGNALS) {
    for (const p of patterns) if (p.test(text)) scores[region]++;
  }
  const ranked = (Object.keys(scores) as ("us" | "ca" | "uk")[]).sort(
    (a, b) => scores[b] - scores[a],
  );
  if (scores[ranked[0]] === 0 || scores[ranked[0]] === scores[ranked[1]]) return "";
  return ranked[0];
}
