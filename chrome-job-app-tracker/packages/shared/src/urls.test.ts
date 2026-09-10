import { describe, expect, it } from "bun:test";
import { appFolder, canonicalPostingUrl, guessCompany, hostFromUrlOrHost } from "./urls.js";

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
