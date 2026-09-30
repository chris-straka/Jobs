import {
  LINKEDIN_CLEAN_KEY,
  isLinkedInHost,
  parseLinkedInCleanSettings,
  startLinkedInClean,
} from "./linkedin-clean.js";

// document_start entry (see manifest): the observer attaches before first
// paint, so modules hide on insert instead of flashing. documentElement
// always exists here; the sweep simply no-ops on the empty DOM and the
// observer catches everything after. Server-free, and it never throws, so
// declutter can never break capture.
if (typeof chrome !== "undefined" && chrome.runtime?.id && isLinkedInHost(location.hostname)) {
  void chrome.storage.local
    .get([LINKEDIN_CLEAN_KEY])
    .then((stored) => startLinkedInClean(parseLinkedInCleanSettings(stored[LINKEDIN_CLEAN_KEY])))
    .catch(() => {});
}
