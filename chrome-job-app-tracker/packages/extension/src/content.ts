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
    return name
      .split(/[-_]|(?=[A-Z])/)
      .some((part) => CHROME_PART.test(part.toLowerCase()));
  });
}

/**
 * Detached, scrubbed copy of the page; candidates read from this, so no
 * site-specific strings are needed anywhere — landmarks, chrome-named
 * containers, and controls are gone structurally.
 */
function scrubbedRoot(): Element {
  const clone = document.documentElement.cloneNode(true) as Element;
  clone.querySelectorAll(STATIC_SCRUB.join(",")).forEach((n) => n.remove());
  for (const el of clone.querySelectorAll("div, section, header, footer, ul, form")) {
    if (isChromeContainer(el)) el.remove();
  }
  return clone;
}

/** Candidate text; the root comes pre-scrubbed. */
function scrubbedText(el: Element): string {
  return el.textContent ?? "";
}

function largestDiv(root: Element): PageCandidate | null {
  let best: { el: Element; len: number } | null = null;
  for (const el of root.querySelectorAll("div")) {
    const len = (el.textContent ?? "").length;
    if (len > 500 && (!best || len > best.len)) best = { el, len };
  }
  return best ? { source: "largest-div", text: scrubbedText(best.el) } : null;
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
  const root = scrubbedRoot();
  const candidates: PageCandidate[] = SELECTORS.flatMap((sel) =>
    [...root.querySelectorAll(sel)].map((el) => ({
      source: sel,
      text: scrubbedText(el),
    })),
  );
  const div = largestDiv(root);
  if (div) candidates.push(div);
  const og = document.querySelector("meta[property='og:title']")?.getAttribute("content") ?? "";
  const h1 =
    [...document.querySelectorAll("h1")]
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
    pill.querySelector(`[data-act='${label}']`)?.addEventListener("click", fn);
  }
  document.body.appendChild(pill);
}

function reminderPill(): void {
  showPill(
    `<div style="display:flex;gap:8px">` +
      `<button data-act="open">Open</button>` +
      `<button data-act="no">False positive</button>` +
      `<button data-act="x">✕</button></div>`,
    {
      // The popup opens with the form prefilled; the background owns the
      // openPopup call because content scripts cannot open it directly.
      open: () => {
        removePill();
        void chrome.runtime.sendMessage({ type: "JAT_OPEN_POPUP" }).catch(() => {});
      },
      no: () => {
        void chrome.runtime
          .sendMessage({ type: "JAT_FP_REPORT", host: location.hostname })
          .then(removePill);
      },
      x: removePill,
    },
  );
}

function appliedPill(): void {
  showPill(
    `<div><b>Just applied?</b> Mark it in the tracker.</div>` +
      `<div style="margin-top:8px;display:flex;gap:8px">` +
      `<button data-act="yes">Mark applied ✓</button>` +
      `<button data-act="x">✕</button></div>`,
    {
      yes: () => {
        void chrome.runtime
          .sendMessage({ type: "JAT_MARK_APPLIED", url: location.href })
          .then((r: unknown) => {
            const ok = (r as { ok?: boolean } | null)?.ok === true;
            showPill(
              ok ? `<div>Marked applied ✓</div>` : `<div>Not tracked yet — save it first.</div>`,
              {
                x: removePill,
              },
            );
          });
      },
      x: removePill,
    },
  );
}

async function denied(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(["fpHosts"]);
    const hosts = Array.isArray(stored.fpHosts) ? stored.fpHosts : [];
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
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "JAT_GET_POSTING") sendResponse({ ok: true, posting: readPosting() });
});

void (async () => {
  if (await denied()) return;
  const posting = readPosting();
  const verdict = postingSignals({
    hasApplyButton: hasApplyButton(),
    descriptionLength: posting.description.length,
    title: posting.title,
  });
  if (verdict.isPosting) {
    reminderPill();
    try {
      await chrome.runtime.sendMessage({ type: "JAT_SHOW_BADGE" });
    } catch {
      // background unreachable (tests, restricted pages) — pill is enough
    }
  }
  watchApplyClicks();
})();
