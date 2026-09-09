import {
  APPLY_TEXT,
  isDenied,
  pickDescription,
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

function largestDiv(): PageCandidate | null {
  let best: { el: Element; len: number } | null = null;
  for (const el of document.querySelectorAll("div")) {
    const len = (el.textContent ?? "").length;
    if (len > 500 && (!best || len > best.len)) best = { el, len };
  }
  return best ? { source: "largest-div", text: best.el.textContent ?? "" } : null;
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
  const candidates: PageCandidate[] = SELECTORS.flatMap((sel) =>
    [...document.querySelectorAll(sel)].map((el) => ({
      source: sel,
      text: el.textContent ?? "",
    })),
  );
  const div = largestDiv();
  if (div) candidates.push(div);
  return {
    title: document.title,
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
  const pill = document.createElement("div");
  pill.id = PILL_ID;
  pill.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;" +
    "background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;padding:10px 12px;" +
    "font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)";
  pill.innerHTML = html;
  for (const [label, fn] of Object.entries(actions)) {
    pill.querySelector(`[data-act='${label}']`)?.addEventListener("click", fn);
  }
  document.body.appendChild(pill);
}

function reminderPill(reasons: string[]): void {
  showPill(
    `<div><b>Save this job?</b> (${reasons.join(" + ")})<br/>` +
      `Click the extension icon to capture it.</div>` +
      `<div style="margin-top:8px;display:flex;gap:8px">` +
      `<button data-act="no">Not a posting</button>` +
      `<button data-act="x">✕</button></div>`,
    {
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
    reminderPill(verdict.reasons);
    try {
      await chrome.runtime.sendMessage({ type: "JAT_SHOW_BADGE" });
    } catch {
      // background unreachable (tests, restricted pages) — pill is enough
    }
  }
  watchApplyClicks();
})();
