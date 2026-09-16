function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const GENERIC = new Set([
  "jobs",
  "job",
  "job-boards",
  "boards",
  "careers",
  "career",
  "apply",
  "application",
  "openings",
  "listings",
  "positions",
  "search",
  "embed",
  "view",
  "www",
  "en-us",
  "en",
  "us",
  "o",
  "p",
  "d",
  "v",
  "j",
  "companies",
]);

const PATH_ATS =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com|pinpointhq\.com)$/;
const HOST_ATS =
  /(myworkdayjobs\.com|breezy\.hr|recruitee\.com|teamtailor\.com|applytojob\.com|bamboohr\.com|icims\.com|paylocity\.com)$/;
const AGGREGATORS =
  /(linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com|dice\.com|monster\.com|wellfound\.com|builtin\.com|otta\.com|simplyhired\.com)$/;
const SUFFIX = new Set([
  "com",
  "io",
  "co",
  "net",
  "org",
  "ai",
  "dev",
  "inc",
  "xyz",
  "uk",
  "us",
  "ca",
  "de",
  "fr",
]);

export { slug };

/**
 * One false-positive entry: a bare host mutes the whole host
 * (`example.com`), while `example.com/dashboard` mutes only that path
 * and its children (`/dashboard`, `/dashboard/`, `/dashboard/x` — never
 * `/dashboard-jobs` or `/jobs/1`). Always lowercase, no scheme, port,
 * query, hash, or trailing slash; root paths collapse to the bare host.
 *
 * @param raw host, host+path, or full URL
 * @returns normalized entry, or `null` when no usable host can be read
 */
export function normalizeFalsePositiveEntry(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let t = raw.trim();
  if (!t || /\s/.test(t)) return null;
  // Strip a scheme when present; only http(s) entries carry paths.
  const scheme = t.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return null;
    t = scheme[2];
  }
  // Host ends at the first /, ? (schemeless `host?x` form), or #.
  const hostEnd = t.search(/[/?#]/);
  let host = (hostEnd === -1 ? t : t.slice(0, hostEnd)).toLowerCase().replace(/\.$/, "");
  // A port identifies the visit, never the scope — drop it.
  const colon = host.indexOf(":");
  if (colon !== -1) host = host.slice(0, colon);
  if (!host || /[%/:]/.test(host) || !/^[a-z0-9.-]+$/.test(host)) return null;
  let path = hostEnd === -1 ? "" : t.slice(hostEnd);
  // Query and hash never scope a mute.
  const pathEnd = path.search(/[?#]/);
  if (pathEnd !== -1) path = path.slice(0, pathEnd);
  path = path.toLowerCase().replace(/\/+$/, "");
  if (!path) return host;
  if (!path.startsWith("/")) path = `/${path}`;
  return `${host}${path}`;
}

/**
 * Lowercased, deduped, sorted entries — stable on disk for clean diffs.
 * Garbage inputs drop out; legacy bare hosts pass through untouched.
 */
export function normalizeFalsePositiveEntries(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(normalizeFalsePositiveEntry).filter((e): e is string => e !== null))].sort();
}

/** Split a normalized entry into its host and optional path prefix. */
function splitFalsePositiveEntry(entry: string): { host: string; path: string | null } {
  const slash = entry.indexOf("/");
  if (slash === -1) return { host: entry, path: null };
  return { host: entry.slice(0, slash), path: entry.slice(slash) };
}

/**
 * Whether a URL falls under any entry. Bare-host entries cover the whole
 * host; path entries cover that path and its children only. Pure entry
 * matching — built-in denials (aggregators) live with the caller.
 *
 * @param rawUrl full page URL
 * @param denyList normalized or raw entries (each normalized before compare)
 */
export function isDeniedUrl(rawUrl: string, denyList: string[]): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const path = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return denyList.some((raw) => {
    const entry = normalizeFalsePositiveEntry(raw);
    if (!entry) return false;
    const { host: eHost, path: ePath } = splitFalsePositiveEntry(entry);
    if (host !== eHost) return false;
    if (ePath === null) return true;
    return path === ePath || path.startsWith(`${ePath}/`);
  });
}

/**
 * Host from a pasted posting URL or a bare host. A scheme is prepended when
 * missing, so `example.com/jobs/1` and full URLs both resolve; the port is
 * dropped, matching the pill's own `location.hostname` reports. Null when
 * no host can be read.
 *
 * @param raw pasted URL or typed host
 */
export function hostFromUrlOrHost(raw: string): string | null {
  const t = raw.trim();
  // Pre-parse: some URL implementations (Chromium) percent-encode spaces
  // instead of throwing, so whitespace must be rejected before parsing.
  if (!t || /\s/.test(t)) return null;
  // `://` marks a real scheme: without it `example.com:8080/path` would
  // parse `example.com:` as the scheme instead of a host with a port.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t) ? t : `https://${t}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host.includes("%") || /[\s/:]/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Query params that identify the visit, never the posting. */
const TRACKING_PARAM =
  /^(utm_.*|fbclid|gclid|gclsrc|msclkid|mc_.*|igshid|_ga|_gl|vero_.*|mkt_.*|trk|trkInfo|li_fat_id|yclid|wbraid|gbraid|srsltid)$/i;

/**
 * Posting identity: scheme/host case, `www.`, fragments, tracking params,
 * and trailing slashes all collapse, remaining params sort. Both sides of
 * a lookup canonicalize, so `?utm_source=x` and `#apply` never fork one
 * posting into two. Unparseable input passes through untouched.
 */
export function canonicalPostingUrl(raw: string): string {
  const t = raw.trim();
  let url: URL;
  try {
    url = new URL(t);
  } catch {
    return t;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return t;
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

/**
 * Guess the company from a posting URL. A hint for prompts, never a default
 * the user can't see — every caller shows it editable (or as a guess label)
 * and still requires an explicit answer.
 *
 * @param rawUrl the posting URL
 * @returns slug guess, or `""` on aggregators/unparseable URLs (refuses to guess)
 */
export function guessCompany(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase();
  const segs = url.pathname
    .split("/")
    .map(slug)
    .filter((s) => s.length > 0);
  const isId = (s: string): boolean => /^[0-9]+$/.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}/.test(s);
  const useful = (s: string): boolean => !GENERIC.has(s) && !isId(s);

  if (PATH_ATS.test(host)) return segs.find(useful) ?? "";
  if (HOST_ATS.test(host))
    return (
      host
        .split(".")
        .map(slug)
        .find((s) => !GENERIC.has(s)) ?? ""
    );
  if (AGGREGATORS.test(host)) return "";
  const rest = host
    .split(".")
    .map(slug)
    .filter((s) => !SUFFIX.has(s) && !GENERIC.has(s));
  return rest[rest.length - 1] ?? "";
}

/**
 * Filesystem slug for `applications/YYYY-MM-DD_<company>_<role>/`.
 *
 * @param company free-text company name
 * @param role free-text role title
 * @param date `YYYY-MM-DD`
 */
export function appFolder(date: string, company: string, role: string): string {
  return `${date}_${slug(company)}_${slug(role)}`;
}
