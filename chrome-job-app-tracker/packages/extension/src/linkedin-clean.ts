/**
 * LinkedIn declutter: hides algorithmic discovery modules ("People also
 * viewed", "People you may know", "You might like", "Add to your feed"),
 * Premium upsell cards, and loading skeletons on LinkedIn pages.
 * Shared-free like extract.ts so the content bundle stays tiny; popup.ts
 * imports the settings helpers too.
 *
 * LinkedIn hashes its CSS classes, so modules are found by heading text
 * (or, for the upsell, its CTA link), not selectors. Headings are matched
 * as prefixes because the row often carries a trailing "Show all" control
 * inside the same heading element. English copy only — other locales keep
 * their modules.
 */

export const LINKEDIN_CLEAN_KEY = "linkedinClean";

export type LinkedInCleanGroup =
  | "peopleAlsoViewed"
  | "peopleYouMayKnow"
  | "youMightLike"
  | "followSuggestions"
  | "premiumUpsell"
  | "loadingSkeletons";

export interface LinkedInCleanSettings {
  peopleAlsoViewed: boolean;
  peopleYouMayKnow: boolean;
  youMightLike: boolean;
  followSuggestions: boolean;
  premiumUpsell: boolean;
  loadingSkeletons: boolean;
}

export const LINKEDIN_CLEAN_GROUPS: { id: LinkedInCleanGroup; label: string }[] = [
  { id: "peopleAlsoViewed", label: "People also viewed" },
  { id: "peopleYouMayKnow", label: "People you may know" },
  { id: "youMightLike", label: "You might like" },
  { id: "followSuggestions", label: "Add to your feed" },
  { id: "premiumUpsell", label: "“Try Premium” upsells" },
  { id: "loadingSkeletons", label: "Loading skeletons" },
];

const GROUP_IDS: LinkedInCleanGroup[] = [
  "peopleAlsoViewed",
  "peopleYouMayKnow",
  "youMightLike",
  "followSuggestions",
  "premiumUpsell",
  "loadingSkeletons",
];

export const DEFAULT_LINKEDIN_CLEAN: LinkedInCleanSettings = {
  peopleAlsoViewed: true,
  peopleYouMayKnow: true,
  youMightLike: true,
  followSuggestions: true,
  premiumUpsell: true,
  loadingSkeletons: true,
};

/** Stored settings win per key; anything unreadable falls back to hiding. */
export function parseLinkedInCleanSettings(raw: unknown): LinkedInCleanSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    peopleAlsoViewed: typeof o.peopleAlsoViewed === "boolean" ? o.peopleAlsoViewed : true,
    peopleYouMayKnow: typeof o.peopleYouMayKnow === "boolean" ? o.peopleYouMayKnow : true,
    youMightLike: typeof o.youMightLike === "boolean" ? o.youMightLike : true,
    followSuggestions: typeof o.followSuggestions === "boolean" ? o.followSuggestions : true,
    premiumUpsell: typeof o.premiumUpsell === "boolean" ? o.premiumUpsell : true,
    loadingSkeletons: typeof o.loadingSkeletons === "boolean" ? o.loadingSkeletons : true,
  };
}

/** linkedin.com and its subdomains — never linkedin.com.evil.com. */
export function isLinkedInHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  return h === "linkedin.com" || h.endsWith(".linkedin.com");
}

/** Collapse whitespace so nested controls don't break the match. */
export function normalizeHeading(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const GROUP_PATTERNS: { group: LinkedInCleanGroup; re: RegExp }[] = [
  {
    group: "peopleAlsoViewed",
    re: /^(people also viewed|who your viewers also viewed|viewers also viewed|more profiles for you)\b/i,
  },
  { group: "peopleYouMayKnow", re: /^(people you may know|more suggestions for you)\b/i },
  { group: "youMightLike", re: /^(you might like|pages you might like)\b/i },
  { group: "followSuggestions", re: /^add to your feed\b/i },
  // The upsell card carries a CTA link plus a views pitch; either triggers.
  { group: "premiumUpsell", re: /^(try premium\b|get \d+[x×] more \S+ views\b)/i },
];

/** Which discovery group this heading starts, or null for real content. */
export function groupForHeading(heading: string): LinkedInCleanGroup | null {
  const text = normalizeHeading(heading);
  if (!text) return null;
  return GROUP_PATTERNS.find((p) => p.re.test(text))?.group ?? null;
}

/** Marks hidden cards so sweeps skip them and restores find them. */
export const LINKEDIN_HIDDEN_ATTR = "data-jat-linkedin-clean";

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6, [role='heading']";

/**
 * Headings plus CTA controls: the Premium upsell is found by its link, not
 * a heading. Buttons and links only ever match the short trigger texts —
 * the length cap below keeps long blobs out.
 */
const SCAN_SELECTOR = `${HEADING_SELECTOR}, a, button`;

/** Triggers are short; a match inside a long blob is a false positive. */
const MAX_HEADING_LEN = 80;

/** Page chrome is never a hide candidate, however it matches. */
const CHROME_SELECTOR = "header, nav, footer";

/**
 * Never hide the page around the module: the card must be a small leaf,
 * not a landmark or chrome, and must not swallow the main column. The
 * chrome guard is what keeps the top nav's own "Try Premium" link from
 * hiding the header.
 */
function isSafeToHide(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body" || tag === "main") return false;
  if (el.closest(CHROME_SELECTOR)) return false;
  return el.querySelector("main") === null;
}

/** Every discovery group named by headings inside this element. */
function distinctGroups(el: Element): Set<LinkedInCleanGroup> {
  const groups = new Set<LinkedInCleanGroup>();
  for (const node of el.querySelectorAll(HEADING_SELECTOR)) {
    const g = groupForHeading(normalizeHeading((node as Element).textContent ?? ""));
    if (g) groups.add(g);
  }
  return groups;
}

/** One module, not the rail: a card holds a single discovery group. */
function isSingleModule(el: Element): boolean {
  return distinctGroups(el).size <= 1;
}

/** A card carries the module's list; a bare header row does not. */
function hasSubstance(el: Element): boolean {
  if (el.querySelector("a, ul, ol")) return true;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().length >= 200;
}

/**
 * The card around a trigger (heading or CTA link). Profile modules are
 * <section>s; rail-era cards are plain divs, where the lowest substantial
 * ancestor sitting among siblings wins. Null when nothing safe is found —
 * hiding nothing beats hiding the page.
 */
function findModuleCard(heading: Element): Element | null {
  const section = heading.closest("section");
  if (section && isSafeToHide(section) && isSingleModule(section)) return section;
  let el = heading.parentElement;
  for (let i = 0; el && i < 4; i++, el = el.parentElement) {
    if (!el.parentElement || el.parentElement.children.length < 2) continue;
    if (!isSafeToHide(el) || !isSingleModule(el)) continue;
    if (hasSubstance(el)) return el;
  }
  return null;
}

/**
 * Hides every enabled discovery module under root. Idempotent: hidden
 * cards are marked and skipped on re-sweeps.
 *
 * @returns number of newly hidden cards
 */
export function sweepLinkedInClean(root: ParentNode, settings: LinkedInCleanSettings): number {
  let hidden = 0;
  const triggers =
    typeof (root as Document).querySelectorAll === "function"
      ? (root as Document).querySelectorAll(SCAN_SELECTOR)
      : [];
  for (const node of triggers) {
    const el = node as Element;
    if (el.closest(`[${LINKEDIN_HIDDEN_ATTR}]`)) continue;
    const text = normalizeHeading(el.textContent ?? "");
    if (!text || text.length > MAX_HEADING_LEN) continue;
    const group = groupForHeading(text);
    if (!group || !settings[group]) continue;
    const card = findModuleCard(el);
    if (!card || card.hasAttribute(LINKEDIN_HIDDEN_ATTR)) continue;
    (card as HTMLElement).style.display = "none";
    card.setAttribute(LINKEDIN_HIDDEN_ATTR, group);
    hidden++;
  }
  return hidden;
}

/** Re-shows cards hidden for one group, or all groups when null. */
export function restoreLinkedInClean(root: ParentNode, group: LinkedInCleanGroup | null): void {
  const sel = group === null ? `[${LINKEDIN_HIDDEN_ATTR}]` : `[${LINKEDIN_HIDDEN_ATTR}="${group}"]`;
  const cards =
    typeof (root as Document).querySelectorAll === "function"
      ? (root as Document).querySelectorAll(sel)
      : [];
  for (const node of cards) {
    const card = node as HTMLElement;
    card.style.display = "";
    card.removeAttribute(LINKEDIN_HIDDEN_ATTR);
  }
}

export function allGroupsOff(settings: LinkedInCleanSettings): boolean {
  return GROUP_IDS.every((g) => !settings[g]);
}

/**
 * Loading placeholders. Class fragments (LinkedIn hashes the rest) plus
 * aria-busy regions. Case-insensitive matching is CSS-wide and works in
 * every modern browser.
 */
export const SKELETON_SELECTOR =
  '[class*="skeleton" i], [class*="shimmer" i], [class*="ghost-" i], [aria-busy="true"]';

/** Landmarks are never skeleton candidates — only their descendants are. */
const LANDMARK_SELECTOR = "html, body, main, aside";

/** A hidden skeleton whose content arrived: links, a heading, or real text. */
function skeletonHasContent(el: Element): boolean {
  if (el.querySelector("a[href], h1, h2, h3, h4, h5, h6, [role='heading']")) return true;
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().length >= 200;
}

/**
 * Hides loading placeholders, releasing any whose content has since
 * arrived (same-node replacement) so the heading sweep can judge the real
 * module: legit content reappears, discovery content is re-hidden under
 * its own group. Skeletons can't be attributed to a group pre-load, so
 * they share one toggle instead of following the module toggles.
 */
export function sweepSkeletons(root: ParentNode, enabled: boolean): number {
  if (typeof (root as Document).querySelectorAll !== "function") return 0;
  const doc = root as Document;
  if (!enabled) {
    restoreLinkedInClean(root, "loadingSkeletons");
    return 0;
  }
  // Release first: content that arrived inside a hidden skeleton must be
  // visible (or re-hidden as discovery) before new placeholders hide.
  for (const node of doc.querySelectorAll(`[${LINKEDIN_HIDDEN_ATTR}="loadingSkeletons"]`)) {
    const el = node as Element;
    if (!(node as Element).matches?.(SKELETON_SELECTOR) || skeletonHasContent(el)) {
      (el as HTMLElement).style.display = "";
      el.removeAttribute(LINKEDIN_HIDDEN_ATTR);
    }
  }
  let hidden = 0;
  for (const node of doc.querySelectorAll(SKELETON_SELECTOR)) {
    const el = node as Element;
    if (el.closest(`[${LINKEDIN_HIDDEN_ATTR}]`)) continue;
    if (el.closest(CHROME_SELECTOR)) continue;
    if (el.matches(LANDMARK_SELECTOR)) continue;
    if (el.hasAttribute(LINKEDIN_HIDDEN_ATTR)) continue;
    // Content already there (a busy region mid-render, not a placeholder).
    if (skeletonHasContent(el)) continue;
    (el as HTMLElement).style.display = "none";
    el.setAttribute(LINKEDIN_HIDDEN_ATTR, "loadingSkeletons");
    hidden++;
  }
  return hidden;
}

/**
 * First sweep plus a coalesced observer for SPA inserts, and a storage
 * listener so popup toggles apply live without a reload. Server-free.
 *
 * @returns stop function (tests only — the content script runs for page life)
 */
export function startLinkedInClean(initial: LinkedInCleanSettings): () => void {
  let current = initial;
  const apply = (): void => {
    // Skeletons first: released content is then judged as a real module.
    sweepSkeletons(document, current.loadingSkeletons);
    sweepLinkedInClean(document, current);
  };
  apply();
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // SPA inserts land in bursts; one sweep per burst is enough.
    window.setTimeout(() => {
      queued = false;
      apply();
    }, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const onStorage = (changes: Record<string, { newValue?: unknown }>): void => {
    if (!("linkedinClean" in changes)) return;
    const next = parseLinkedInCleanSettings(changes[LINKEDIN_CLEAN_KEY]?.newValue);
    for (const g of GROUP_IDS) {
      if (current[g] && !next[g]) restoreLinkedInClean(document, g);
    }
    current = next;
    apply();
  };
  chrome.storage.onChanged.addListener(onStorage);
  return () => {
    observer.disconnect();
    chrome.storage.onChanged.removeListener(onStorage);
  };
}
