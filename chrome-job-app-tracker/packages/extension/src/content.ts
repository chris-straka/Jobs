import { pickDescription, type PageCandidate } from "./extract.js";

const SELECTORS = [
  "article",
  "main",
  "[role='main']",
  "[class*='job-description']",
  "[class*='jobDescription']",
  "[id*='job-description']",
  "[data-testid*='description']",
];

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

// Kept dependency-free (no shared imports) so the content bundle stays tiny.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "JAT_GET_POSTING") sendResponse({ ok: true, posting: readPosting() });
});
