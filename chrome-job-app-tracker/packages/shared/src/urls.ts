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
