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
  | "loadingSkeletons"
  | "navHome"
  | "navNetwork"
  | "navBusiness"
  | "linkedinNews"
  | "promotedAds"
  | "homeFeed";

export interface LinkedInCleanSettings {
  peopleAlsoViewed: boolean;
  peopleYouMayKnow: boolean;
  youMightLike: boolean;
  followSuggestions: boolean;
  premiumUpsell: boolean;
  loadingSkeletons: boolean;
  navHome: boolean;
  navNetwork: boolean;
  navBusiness: boolean;
  linkedinNews: boolean;
  promotedAds: boolean;
  homeFeed: boolean;
}

export const LINKEDIN_CLEAN_GROUPS: { id: LinkedInCleanGroup; label: string }[] = [
  { id: "peopleAlsoViewed", label: "People also viewed" },
  { id: "peopleYouMayKnow", label: "People you may know" },
  { id: "youMightLike", label: "You might like" },
  { id: "followSuggestions", label: "Add to your feed" },
  { id: "premiumUpsell", label: "“Try Premium” upsells" },
  { id: "loadingSkeletons", label: "Loading skeletons" },
  { id: "navHome", label: "Home nav button" },
  { id: "navNetwork", label: "My Network nav button" },
  { id: "navBusiness", label: "For Business nav menu" },
  { id: "linkedinNews", label: "LinkedIn News" },
  { id: "promotedAds", label: "Promoted ads" },
  { id: "homeFeed", label: "Home feed column" },
];

const GROUP_IDS: LinkedInCleanGroup[] = [
  "peopleAlsoViewed",
  "peopleYouMayKnow",
  "youMightLike",
  "followSuggestions",
  "premiumUpsell",
  "loadingSkeletons",
  "navHome",
  "navNetwork",
  "navBusiness",
  "linkedinNews",
  "promotedAds",
  "homeFeed",
];

export const DEFAULT_LINKEDIN_CLEAN: LinkedInCleanSettings = {
  peopleAlsoViewed: true,
  peopleYouMayKnow: true,
  youMightLike: true,
  followSuggestions: true,
  premiumUpsell: true,
  loadingSkeletons: true,
  navHome: true,
  navNetwork: false,
  navBusiness: true,
  linkedinNews: true,
  promotedAds: true,
  homeFeed: true,
};

/**
 * Stored settings win per key; anything unreadable falls back to the
 * default. My Network is the one default-off group: the button stays so
 * connection invites (often recruiters) still surface.
 */
export function parseLinkedInCleanSettings(raw: unknown): LinkedInCleanSettings {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    peopleAlsoViewed: typeof o.peopleAlsoViewed === "boolean" ? o.peopleAlsoViewed : true,
    peopleYouMayKnow: typeof o.peopleYouMayKnow === "boolean" ? o.peopleYouMayKnow : true,
    youMightLike: typeof o.youMightLike === "boolean" ? o.youMightLike : true,
    followSuggestions: typeof o.followSuggestions === "boolean" ? o.followSuggestions : true,
    premiumUpsell: typeof o.premiumUpsell === "boolean" ? o.premiumUpsell : true,
    loadingSkeletons: typeof o.loadingSkeletons === "boolean" ? o.loadingSkeletons : true,
    navHome: typeof o.navHome === "boolean" ? o.navHome : true,
    navNetwork: typeof o.navNetwork === "boolean" ? o.navNetwork : false,
    navBusiness: typeof o.navBusiness === "boolean" ? o.navBusiness : true,
    linkedinNews: typeof o.linkedinNews === "boolean" ? o.linkedinNews : true,
    promotedAds: typeof o.promotedAds === "boolean" ? o.promotedAds : true,
    homeFeed: typeof o.homeFeed === "boolean" ? o.homeFeed : true,
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
  { group: "linkedinNews", re: /^linkedin news\b/i },
  // Exact: celebration posts ("Promoted to Staff") must never match.
  { group: "promotedAds", re: /^promoted(\s*•+)?$/i },
];

const NAV_PATTERNS: { group: LinkedInCleanGroup; re: RegExp }[] = [
  { group: "navHome", re: /^home$/i },
  { group: "navNetwork", re: /^my network$/i },
  { group: "navBusiness", re: /^for business$/i },
];

/** Exact nav labels; only consulted inside the top chrome. */
export function groupForNav(text: string): LinkedInCleanGroup | null {
  const t = normalizeHeading(text);
  if (!t) return null;
  return NAV_PATTERNS.find((p) => p.re.test(t))?.group ?? null;
}

/** Home feed column paths. Single-post permalinks stay visible. */
export function isFeedPath(pathname: string): boolean {
  return /^\/(feed\/?|home\/?)?$/.test(pathname);
}

/** Jobs search/detail paths, where Promoted labels mark real listings. */
export function isJobsPath(pathname: string): boolean {
  return pathname === "/jobs" || pathname.startsWith("/jobs/");
}

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
 * Headings plus CTA controls and labels: the Premium upsell is found by
 * its link, ad labels are spans. Everything only ever matches the short
 * trigger texts — the length cap below keeps long blobs out.
 */
const SCAN_SELECTOR = `${HEADING_SELECTOR}, a, button, span`;

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
/**
 * The nav item around a chrome trigger: the nearest list item, or the
 * link itself when it stands alone (the Try Premium nav link has no li).
 * Small elements only, and never a submenu container.
 */
function findNavItem(el: Element): Element | null {
  if (!el.closest("header, nav")) return null;
  const item = el.closest("li") ?? el;
  const tag = item.tagName.toLowerCase();
  if (tag !== "li" && tag !== "a" && tag !== "button" && tag !== "span") return null;
  if (item.querySelector("ul, ol")) return null;
  return item;
}

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
    // Inside the top chrome, only nav labels and the Premium CTA resolve —
    // to the nav item itself, never a climbing card.
    if (el.closest("header, nav")) {
      const navGroup =
        groupForNav(text) ?? (groupForHeading(text) === "premiumUpsell" ? "premiumUpsell" : null);
      if (!navGroup || !settings[navGroup]) continue;
      const item = findNavItem(el);
      if (!item || item.hasAttribute(LINKEDIN_HIDDEN_ATTR)) continue;
      (item as HTMLElement).style.display = "none";
      item.setAttribute(LINKEDIN_HIDDEN_ATTR, navGroup);
      hidden++;
      continue;
    }
    const group = groupForHeading(text);
    if (!group || !settings[group]) continue;
    // Promoted *job listings* carry the same label: leave jobs pages alone.
    if (
      group === "promotedAds" &&
      typeof location !== "undefined" &&
      isJobsPath(location.pathname)
    ) {
      continue;
    }
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
/**
 * Eradicator mode: the whole feed column goes, but only on feed paths —
 * and it comes back on SPA navigation elsewhere, since apply() re-runs on
 * every mutation burst.
 */
function sweepHomeFeed(root: ParentNode, enabled: boolean): void {
  if (typeof (root as Document).querySelector !== "function") return;
  const main = (root as Document).querySelector("main");
  if (!main) return;
  const marked = main.getAttribute(LINKEDIN_HIDDEN_ATTR) === "homeFeed";
  const onFeed = typeof location !== "undefined" && isFeedPath(location.pathname);
  if (enabled && onFeed && !marked) {
    (main as HTMLElement).style.display = "none";
    main.setAttribute(LINKEDIN_HIDDEN_ATTR, "homeFeed");
  } else if ((!enabled || !onFeed) && marked) {
    (main as HTMLElement).style.display = "";
    main.removeAttribute(LINKEDIN_HIDDEN_ATTR);
  }
}

export function startLinkedInClean(initial: LinkedInCleanSettings): () => void {
  let current = initial;
  const apply = (): void => {
    // Skeletons first: released content is then judged as a real module.
    sweepSkeletons(document, current.loadingSkeletons);
    sweepLinkedInClean(document, current);
    sweepHomeFeed(document, current.homeFeed);
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
