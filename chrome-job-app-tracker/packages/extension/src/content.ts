import {
  APPLY_TEXT,
  cleanText,
  isDenied,
  pickDescription,
  pickTitle,
  postingSignals,
  type PageCandidate,
} from "./extract.js";

const SELECTORS = [
  "article",
  "main",
  "[role='main']",
  "[class*='job-description']",
  "[class*='jobDescription']",
  "[id*='job-description']",
  "[data-testid*='description']",
];

const PILL_ID = "jat-pill";

const STATIC_SCRUB = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  // Page chrome, never posting prose: landmarks, asides, and controls
  // (buttons, dropdowns, submit inputs).
  "header",
  "footer",
  "nav",
  "aside",
  "button",
  "select",
  '[role="banner"]',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="search"]',
  '[role="button"]',
  'input[type="submit"]',
  'input[type="button"]',
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[aria-label*="cookie" i]',
];

/** Single class/id part that marks a container as site chrome. */
const CHROME_PART =
  /^(nav|menu|sidebar|aside|footer|header|banner|breadcrumb|pagination|pager|toolbar|modal|dialog|overlay|popup|lightbox|login|signin|signup|register|subscribe|newsletter|alert|alerts|filter|filters|search|social|share|related|similar|recommended|sponsored|ad|ads)$/;

/** Posting containers win over chrome-looking parts (job-search, job-alerts aside). */
const POSTING_HINT = /descrip|posting|content|detail|main|article/i;

/**
 * A div-soup container looks like chrome when any class/id part says so
 * (site-header, top-nav, job-alerts) unless the name marks posting content.
 */
function isChromeContainer(el: Element): boolean {
  const names = [
    el.id,
    ...(typeof el.className === "string" ? el.className.split(/\s+/) : []),
  ].filter((n) => n.length > 0);
  return names.some((name) => {
    if (POSTING_HINT.test(name)) return false;
    return name.split(/[-_]|(?=[A-Z])/).some((part) => CHROME_PART.test(part.toLowerCase()));
  });
}

/**
 * Whether the user could see this element when reading the page. Anything
 * failing here is invisible ink — display:none subtrees, hidden attributes,
 * zero-area or off-viewport boxes, transparency. Those are exactly the
 * carriers a prompt-injecting posting would use, and exactly what the user
 * cannot catch by reading. Visible prose stays, whatever it says: telling
 * "Note to AI assistants" apart from "Note to applicants" is the sandbox's
 * and the verifier's job, not the scraper's. Sub-legible type (see
 * MIN_READABLE_PX) is handled separately in visibleText: it drops the
 * element's own text but keeps normally-sized children, so font-size:0
 * whitespace-trick containers survive.
 */
function isRendered(el: Element): boolean {
  if (el.hasAttribute("hidden")) return false;
  const rects = el.getClientRects();
  if (rects.length === 0) return false;
  let onScreen = false;
  for (const r of rects) {
    if (r.right >= 0 && r.left <= window.innerWidth) {
      onScreen = true;
      break;
    }
  }
  if (!onScreen) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

/**
 * Sub-legible type floor in px. Text rendered below this cannot be read at
 * 100% zoom — the user could not catch it by reading — while legit fine
 * print (EEO, salary footnotes, req ids) runs 9px and up. Computed style
 * resolves em/rem/% to px, so relative sizes are covered; unparsable values
 * fail open (text kept).
 */
const MIN_READABLE_PX = 5;

function tinyText(el: Element): boolean {
  const px = parseFloat(getComputedStyle(el).fontSize);
  return Number.isFinite(px) && px < MIN_READABLE_PX;
}

/**
 * Visible text of one candidate subtree, walked live so hidden descendants
 * prune exactly where layout says they do. Scripts, styles, and
 * chrome-named containers contribute nothing; the root itself is exempt
 * from the chrome check (it was selected as a candidate, not filtered).
 */
const SCRUB_SELECTOR = STATIC_SCRUB.join(",");

function visibleText(el: Element, isRoot: boolean): string {
  // Same structural scrub as before, evaluated live per element.
  if (el.matches(SCRUB_SELECTOR)) return "";
  const tag = el.tagName.toLowerCase();
  if (
    !isRoot &&
    (tag === "div" ||
      tag === "section" ||
      tag === "header" ||
      tag === "footer" ||
      tag === "ul" ||
      tag === "form") &&
    isChromeContainer(el)
  ) {
    return "";
  }
  if (!isRendered(el)) return "";
  // The element's own direct text in sub-legible type is unreadable ink;
  // children re-evaluate with their own sizes on recursion.
  const illegible = tinyText(el);
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!illegible) out += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) out += visibleText(node as Element, false);
  }
  return out;
}

function largestDiv(): PageCandidate | null {
  const survivors: Element[] = [];
  for (const el of document.querySelectorAll("div")) {
    // Cheap gates first: length, then script carriers, then layout.
    if ((el.textContent ?? "").length <= 500) continue;
    if (el.querySelector("script, style, noscript")) continue;
    if (!isRendered(el)) continue;
    survivors.push(el);
  }
  let best: { text: string } | null = null;
  for (const el of survivors) {
    const text = visibleText(el, true);
    if (text.length > 500 && (!best || text.length > best.text.length)) best = { text };
  }
  return best ? { source: "largest-div", text: best.text } : null;
}

export interface Posting {
  title: string;
  url: string;
  description: string;
}

/**
 * Reads the visible posting: collects text under posting-like selectors plus
 * a largest-div fallback, then delegates the pick to {@link pickDescription}.
 *
 * @returns title, URL, and description of the current tab
 */
export function readPosting(): Posting {
  // Candidates come from the live document; each survivor contributes
  // only the text layout says is visible.
  const candidates: PageCandidate[] = SELECTORS.flatMap((sel) =>
    [...document.querySelectorAll(sel)]
      .filter(isRendered)
      .map((el) => ({ source: sel, text: visibleText(el, true) })),
  );
  const div = largestDiv();
  if (div) candidates.push(div);
  const og = document.querySelector("meta[property='og:title']")?.getAttribute("content") ?? "";
  const h1 =
    [...document.querySelectorAll("h1")]
      .filter(isRendered)
      .map((h) => cleanText(h.textContent ?? ""))
      .find((t) => t.length >= 4) ?? "";
  return {
    title: pickTitle(h1, og, document.title),
    url: location.href,
    description: pickDescription(document.title, candidates),
  };
}

function hasApplyButton(): boolean {
  for (const el of document.querySelectorAll("button, a, [role='button'], input[type='submit']")) {
    const label = (el.textContent ?? (el as HTMLInputElement).value ?? "").trim();
    if (label.length > 0 && label.length < 60 && APPLY_TEXT.test(label)) return true;
  }
  return false;
}

function removePill(): void {
  document.getElementById(PILL_ID)?.remove();
}

/** Fixed-position pill. `actions` is button label → handler. */
function showPill(html: string, actions: Record<string, () => void>): void {
  removePill();
  const dark =
    typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
  const pill = document.createElement("div");
  pill.id = PILL_ID;
  pill.style.cssText =
    "position:fixed;right:16px;top:16px;z-index:2147483647;max-width:340px;" +
    `background:${dark ? "#1e1e1e" : "#fff"};color:${dark ? "#e8e8e8" : "#111"};` +
    `border:1px solid ${dark ? "#555" : "#ccc"};border-radius:14px;padding:12px 14px;` +
    "font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)";
  const btn =
    `background:${dark ? "#3a3a3a" : "#f0f0f0"};color:${dark ? "#e8e8e8" : "#111"};` +
    `border:1px solid ${dark ? "#555" : "#ccc"};border-radius:9px;` +
    "padding:4px 12px;font:inherit;cursor:pointer";
  pill.innerHTML = `<style>#${PILL_ID} button{${btn}}</style>` + html;
  for (const [label, fn] of Object.entries(actions)) {
    // preventDefault for anchors (they carry href for the pointer cursor).
    pill.querySelector(`[data-act='${label}']`)?.addEventListener("click", (e) => {
      e.preventDefault();
      fn();
    });
  }
  document.body.appendChild(pill);
}

type PillMode = "untracked" | "draft" | "applied";

function markAppliedAction(): void {
  void chrome.runtime
    .sendMessage({ type: "JAT_MARK_APPLIED", url: location.href })
    .then((r: unknown) => {
      const ok = (r as { ok?: boolean } | null)?.ok === true;
      showPill(ok ? `<div>Marked applied ✓</div>` : `<div>Not tracked yet — save it first.</div>`, {
        x: removePill,
      });
    });
}

/**
 * Tracked but not yet applied: False positive gives way to Mark applied.
 * Tracked and applied: neither — just Open and dismiss.
 */
function reminderPill(mode: PillMode): void {
  const buttons =
    `<button data-act="open">Open</button>` +
    (mode === "draft"
      ? `<button data-act="mark">Mark applied ✓</button>`
      : mode === "untracked"
        ? `<button data-act="no">False positive</button>`
        : "") +
    `<button data-act="x">✕</button>`;
  showPill(`<div style="display:flex;gap:8px">${buttons}</div>`, {
    // The background routes Open (tracked folder vs popup form) because
    // content scripts can open neither directly. The posting rides along:
    // the popup cannot always read the tab itself, so the pill hands over
    // the exact text its verdict used. The pill stays up — only False
    // positive and ✕ dismiss it.
    open: () => {
      const posting = cachedPosting ?? readPosting();
      void chrome.runtime
        .sendMessage({
          type: "JAT_OPEN",
          url: location.href,
          posting: { title: posting.title, description: posting.description },
        })
        .catch(() => {});
    },
    mark: markAppliedAction,
    no: () => {
      void chrome.runtime
        .sendMessage({ type: "JAT_FP_REPORT", host: location.hostname, url: location.href })
        .then((r: unknown) => {
          // A tracked posting can never be a false positive: the report is
          // refused, and the pill says what it is instead of vanishing.
          if ((r as { ok?: boolean } | null)?.ok === true) {
            showPill(
              `<div style="display:flex;gap:8px;align-items:center">` +
                `<span>Added to the <a href="#" data-act="dash">List</a> ✓</span>` +
                `<button data-act="undo">Undo</button>` +
                `<button data-act="x">✕</button></div>`,
              {
                dash: () => {
                  void chrome.runtime.sendMessage({ type: "JAT_OPEN_DASHBOARD" }).catch(() => {});
                },
                undo: () => {
                  clearFpConfirmTimer();
                  void chrome.runtime
                    .sendMessage({ type: "JAT_FP_UNREPORT", host: location.hostname })
                    .then((u: unknown) => {
                      if ((u as { ok?: boolean } | null)?.ok === true) {
                        reminderPill(pillMode);
                      }
                    });
                },
                x: () => {
                  clearFpConfirmTimer();
                  removePill();
                },
              },
            );
            armFpConfirmTimer();
          } else {
            showPill(`<div>Already saved ✓ — can't mute a tracked posting.</div>`, {
              x: removePill,
            });
          }
        });
    },
    x: removePill,
  });
}

function appliedPill(): void {
  showPill(
    `<div><b>Just applied?</b> Mark it in the tracker.</div>` +
      `<div style="margin-top:8px;display:flex;gap:8px">` +
      `<button data-act="yes">Mark applied ✓</button>` +
      `<button data-act="x">✕</button></div>`,
    {
      yes: markAppliedAction,
      x: removePill,
    },
  );
}

async function denied(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(["falsePositives", "fpReported", "fpHosts"]);
    const hosts = ["falsePositives", "fpReported", "fpHosts"].flatMap((k) =>
      Array.isArray(stored[k]) ? stored[k] : [],
    );
    return isDenied(
      location.hostname,
      hosts.filter((h): h is string => typeof h === "string"),
    );
  } catch {
    return false;
  }
}

function watchApplyClicks(): void {
  // Capture phase: notice the click before the page navigates away.
  document.addEventListener(
    "click",
    (ev) => {
      const t = ev.target as Element | null;
      const hit = t?.closest?.("button, a, [role='button'], input[type='submit']");
      const label = (hit?.textContent ?? (hit as HTMLInputElement | null)?.value ?? "").trim();
      if (hit && label.length > 0 && label.length < 60 && APPLY_TEXT.test(label)) {
        window.setTimeout(appliedPill, 800);
      }
    },
    true,
  );
}

// Kept dependency-free (no shared imports) so the content bundle stays tiny.
let cachedPosting: Posting | null = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // The verdict-time posting: the pill and the popup then always agree.
  if (msg?.type === "JAT_GET_POSTING") {
    sendResponse({ ok: true, posting: cachedPosting ?? readPosting() });
  }
});

/** Last rendered reminder variant, so Undo can put it back. */
let pillMode: PillMode = "untracked";

/**
 * Mute-confirm auto-dismiss. The toast is a receipt, not a workspace: it
 * clears itself after a few seconds, long enough to hit Undo. Any manual
 * dismissal clears the timer first so it can't remove a later pill.
 */
const FP_CONFIRM_MS = 5000;
let fpConfirmTimer: number | undefined;

function clearFpConfirmTimer(): void {
  window.clearTimeout(fpConfirmTimer);
  fpConfirmTimer = undefined;
}

function armFpConfirmTimer(): void {
  clearFpConfirmTimer();
  fpConfirmTimer = window.setTimeout(removePill, FP_CONFIRM_MS);
}

void (async () => {
  if (await denied()) return;
  const posting = readPosting();
  cachedPosting = posting;
  const verdict = postingSignals({
    hasApplyButton: hasApplyButton(),
    descriptionLength: posting.description.length,
    title: posting.title,
  });
  if (verdict.isPosting) {
    try {
      const s = (await chrome.runtime.sendMessage({
        type: "JAT_PILL_STATE",
        url: location.href,
      })) as { tracked?: boolean; applied?: boolean } | null;
      if (s?.tracked) pillMode = s.applied ? "applied" : "draft";
    } catch {
      // background unreachable (tests, restricted pages) — plain pill
    }
    reminderPill(pillMode);
    try {
      await chrome.runtime.sendMessage({ type: "JAT_SHOW_BADGE" });
    } catch {
      // background unreachable (tests, restricted pages) — pill is enough
    }
  }
  watchApplyClicks();
})();
