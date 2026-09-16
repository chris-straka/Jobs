import { describe, expect, it } from "bun:test";
import {
  appFolder,
  canonicalPostingUrl,
  guessCompany,
  hostFromUrlOrHost,
  isDeniedUrl,
  normalizeFalsePositiveEntries,
  normalizeFalsePositiveEntry,
  normalizeIneligibleUrls,
} from "./urls.js";

describe("guessCompany", () => {
  it("reads the company from ATS paths", () => {
    expect(guessCompany("https://job-boards.greenhouse.io/intersystems/jobs/7827897003")).toBe(
      "intersystems",
    );
  });

  it("skips numeric ids and uuids in ATS paths", () => {
    expect(guessCompany("https://job-boards.greenhouse.io/12345/jobs/678")).toBe("");
    expect(guessCompany("https://acme.ashbyhq.com/9d2f1a2b-3c4d-5e6f-7890-abcdef123456")).toBe("");
    // Company-in-subdomain forms (acme.lever.co) get no guess either: the
    // path carries no company, and guessing from the host would misfire on
    // hosts like job-boards.greenhouse.io. The user types it — safe by design.
    expect(guessCompany("https://acme.lever.co/jobs/12345")).toBe("");
  });

  it("reads the company from ATS hostnames", () => {
    expect(guessCompany("https://acme.wd1.myworkdayjobs.com/en-US/careers")).toBe("acme");
  });

  it("reads the registrable name from careers sites", () => {
    expect(guessCompany("https://careers.acme.co.uk/search")).toBe("acme");
  });

  it("refuses to guess on aggregators and garbage", () => {
    expect(guessCompany("https://www.linkedin.com/jobs/view/123")).toBe("");
    expect(guessCompany("https://www.indeed.com/viewjob?jk=abc")).toBe("");
    expect(guessCompany("not a url")).toBe("");
  });
});

describe("canonicalPostingUrl", () => {
  it("strips tracking params, fragments, www, and trailing slashes", () => {
    expect(
      canonicalPostingUrl("https://www.acme.com/jobs/123/?utm_source=linkedin&fbclid=abc#apply"),
    ).toBe("https://acme.com/jobs/123");
  });

  it("sorts surviving params and unifies scheme and host case", () => {
    expect(canonicalPostingUrl("http://ACME.com/jobs?b=2&a=1")).toBe(
      "https://acme.com/jobs?a=1&b=2",
    );
  });

  it("passes garbage through untouched", () => {
    expect(canonicalPostingUrl("not a url")).toBe("not a url");
    expect(canonicalPostingUrl("")).toBe("");
  });
});

describe("appFolder", () => {
  it("builds the dated folder name", () => {
    expect(appFolder("2026-09-09", "Acme Corp", "Backend Engineer")).toBe(
      "2026-09-09_acme-corp_backend-engineer",
    );
  });
});

describe("normalizeFalsePositiveEntry", () => {
  it("keeps paths, strips visit noise, collapses roots", () => {
    expect(normalizeFalsePositiveEntry("https://WWW.Brightnetwork.co.uk/dashboard/?x=1")).toBe(
      "www.brightnetwork.co.uk/dashboard",
    );
    expect(normalizeFalsePositiveEntry("example.com:8080/a/")).toBe("example.com/a");
    expect(normalizeFalsePositiveEntry("https://example.com/")).toBe("example.com");
    expect(normalizeFalsePositiveEntry("  New-Site.com ")).toBe("new-site.com");
  });

  it("rejects garbage with no usable host", () => {
    expect(normalizeFalsePositiveEntry("not a url!!")).toBeNull();
    expect(normalizeFalsePositiveEntry("not a host!!")).toBeNull();
    expect(normalizeFalsePositiveEntry("")).toBeNull();
    expect(normalizeFalsePositiveEntry("ftp://example.com/x")).toBeNull();
  });
});

describe("normalizeFalsePositiveEntries", () => {
  it("normalizes, dedupes, and sorts; legacy hosts pass through", () => {
    expect(
      normalizeFalsePositiveEntries([
        "HTTPS://WWW.Brightnetwork.co.uk/dashboard/",
        "a.com",
        "a.com",
        "not a host!!",
      ]),
    ).toEqual(["a.com", "www.brightnetwork.co.uk/dashboard"]);
    expect(normalizeFalsePositiveEntries("nope")).toEqual([]);
  });
});

describe("isDeniedUrl", () => {
  it("scopes path entries to their subtree", () => {
    const list = ["www.brightnetwork.co.uk/dashboard"];
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/dashboard/", list)).toBe(true);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/dashboard/x", list)).toBe(true);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/jobs/1", list)).toBe(false);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/dashboard-jobs", list)).toBe(false);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/jobs/1", ["www.brightnetwork.co.uk"])).toBe(
      true,
    );
    expect(isDeniedUrl("not a url", list)).toBe(false);
  });
});

describe("normalizeIneligibleUrls", () => {
  it("canonicalizes, dedupes, and sorts; one posting is one entry", () => {
    expect(
      normalizeIneligibleUrls([
        "https://www.example.com/jobs/1/?utm_source=x#apply",
        "https://example.com/jobs/1",
        "https://example.com/jobs/2",
      ]),
    ).toEqual(["https://example.com/jobs/1", "https://example.com/jobs/2"]);
  });

  it("drops non-urls and non-http schemes", () => {
    expect(
      normalizeIneligibleUrls(["not a url", "ftp://example.com/x", "", 42, "https://ok.com/a/"]),
    ).toEqual(["https://ok.com/a"]);
    expect(normalizeIneligibleUrls("nope")).toEqual([]);
  });
});

describe("hostFromUrlOrHost", () => {
  it("reads the host from full and schemeless URLs", () => {
    expect(hostFromUrlOrHost("https://jobs.example.com/post/123?utm_source=x")).toBe(
      "jobs.example.com",
    );
    expect(hostFromUrlOrHost("example.com/jobs/1")).toBe("example.com");
    expect(hostFromUrlOrHost("  New-Site.com ")).toBe("new-site.com");
    expect(hostFromUrlOrHost("example.com:8080/path")).toBe("example.com");
  });

  it("rejects garbage with no usable host", () => {
    expect(hostFromUrlOrHost("not a url!!")).toBeNull();
    expect(hostFromUrlOrHost("not a host!!")).toBeNull();
    expect(hostFromUrlOrHost("")).toBeNull();
    expect(hostFromUrlOrHost("ftp://example.com/x")).toBeNull();
  });
});
