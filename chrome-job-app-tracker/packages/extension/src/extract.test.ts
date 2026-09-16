import { describe, expect, it } from "bun:test";
import {
  APPLY_TEXT,
  cleanText,
  detectTrack,
  dropJunkLines,
  entryForFalsePositive,
  guessRegion,
  isDenied,
  isDeniedUrl,
  isJunkLine,
  normalizeFalsePositiveEntry,
  pickDescription,
  pickTitle,
  postingSignals,
  samePostingText,
} from "./extract.js";

describe("APPLY_TEXT", () => {
  it("matches real apply controls", () => {
    for (const label of [
      "Apply",
      "Apply now",
      "APPLY FOR THIS JOB",
      "Easy Apply",
      "Submit Application",
      "Submit application",
    ]) {
      expect(APPLY_TEXT.test(label)).toBe(true);
    }
  });

  it("rejects noun-only labels like docs navigation", () => {
    for (const label of [
      "Application",
      "Applications",
      "macOS Application Bundle",
      "Send Application",
      "Reapply",
      "Applying changes",
      "Submit",
    ]) {
      expect(APPLY_TEXT.test(label)).toBe(false);
    }
  });
});

describe("cleanText", () => {
  it("collapses whitespace", () => {
    expect(cleanText("  Senior\n\n  Engineer\t(remote) ")).toBe("Senior Engineer (remote)");
  });
});

describe("samePostingText", () => {
  it("matches identical text despite whitespace differences", () => {
    expect(samePostingText("Senior\n\n  Engineer", "Senior Engineer")).toBe(true);
  });
  it("rejects changed text", () => {
    expect(samePostingText("Senior Engineer", "Junior Engineer")).toBe(false);
  });
  it("rejects empty or missing sides", () => {
    expect(samePostingText("", "Senior Engineer")).toBe(false);
    expect(samePostingText("Senior Engineer", null)).toBe(false);
    expect(samePostingText("", null)).toBe(false);
  });
});

describe("pickDescription", () => {
  const long = "Responsibilities include shipping software. ".repeat(20);
  it("prefers the longest substantial candidate", () => {
    expect(
      pickDescription("Job title", [
        { source: "nav", text: "short menu text" },
        { source: "article", text: long },
      ]),
    ).toBe(long.replace(/\s+/g, " ").trim());
  });

  it("falls back to the title when nothing is substantial", () => {
    expect(pickDescription("  Job title ", [{ source: "nav", text: "menu" }])).toBe("Job title");
  });
});

describe("isJunkLine", () => {
  it("drops script remnants", () => {
    expect(isJunkLine('$(function() { $("#skipLink").click(); });')).toBe(true);
    expect(isJunkLine("//<![CDATA[ $(document).ready(function() {")).toBe(true);
    expect(isJunkLine("var offset = $(':target').offset();")).toBe(true);
  });

  it("drops screen-reader and loader boilerplate", () => {
    expect(isJunkLine("Opens in a new tab.")).toBe(true);
    expect(isJunkLine("Skip to main content")).toBe(true);
    expect(isJunkLine("Loading...")).toBe(true);
  });

  it("drops buttons, CTAs, copyright, and alert/search chrome", () => {
    for (const junk of [
      "Apply now",
      "Apply now »",
      "View All Jobs",
      "Find similar jobs:",
      "Create Alert",
      "Show More Options",
      "Copyright © 2026 PCL Constructors Inc. All rights reserved.",
      "Select how often (in days) to receive an alert:",
      "Search by Keyword Show More Options Country All",
    ]) {
      expect(isJunkLine(junk)).toBe(true);
    }
    for (const real of [
      "Company: PCL Constructors Inc.",
      "Primary Location: Edmonton, Alberta (Corporate)",
      "What you will bring to the role:",
      "Apply your skills to real construction software.",
    ]) {
      expect(isJunkLine(real)).toBe(false);
    }
  });

  it("drops control and nav-link lines, keeps lookalike prose", () => {
    for (const junk of ["Share", "Share this job", "Save job", "Print", "Home", "Back to search results"]) {
      expect(isJunkLine(junk)).toBe(true);
    }
    // Nav blobs die on two signals; single-signal prose survives.
    expect(
      isJunkLine("Language English (United States) Français (Canada) View Profile Employee Login"),
    ).toBe(true);
    expect(isJunkLine("Users sign in with SSO to reach the dashboard.")).toBe(false);
    expect(isJunkLine("Log in to the applicant portal to check your status.")).toBe(false);
    expect(isJunkLine("Work from home two days a week.")).toBe(false);
  });

  it("drops cookie-banner lines but keeps real content", () => {
    expect(
      isJunkLine(
        "We use cookies to offer you the best possible website experience. Accept All Cookies",
      ),
    ).toBe(true);
    expect(isJunkLine("Modify Cookie Preferences Accept All Cookies")).toBe(true);
    expect(isJunkLine("Writes clean, scalable web applications.")).toBe(false);
    // Consent-tooling roles stay intact: no notice-word, no drop.
    expect(isJunkLine("Experience with cookie consent banners")).toBe(false);
  });
});

describe("dropJunkLines", () => {
  it("strips junk and collapses consecutive repeats", () => {
    const real = "Designs and develops in-house software systems. ".repeat(10);
    const text = [
      "We use cookies to improve your experience. Accept All Cookies",
      "Professionals Skilled Craft Students",
      "Professionals Skilled Craft Students",
      "Opens in a new tab.",
      "Opens in a new tab.",
      real,
      "$(document).ready(function() {",
    ].join("\n");
    const out = dropJunkLines(text);
    expect(out).not.toContain("cookies");
    expect(out).not.toContain("Opens in a new tab");
    expect(out).not.toContain("$(document)");
    expect(out).toContain("Professionals Skilled Craft Students");
    expect(out.match(/Professionals Skilled Craft Students/g)).toHaveLength(1);
    expect(out).toContain("in-house software");
  });

  it("keeps junk from inflating a candidate past the threshold", () => {
    const thin = "Short role blurb. ";
    const junk = "Opens in a new tab.\n".repeat(30);
    expect(
      pickDescription("Fallback title", [{ source: "main", text: thin + junk }]),
    ).toBe("Fallback title");
  });
});

describe("postingSignals", () => {
  it("fires on apply button plus substance", () => {
    expect(postingSignals({ hasApplyButton: true, descriptionLength: 500, title: "Acme" })).toEqual(
      { isPosting: true, reasons: ["apply button"] },
    );
  });

  it("fires on two weak signals agreeing", () => {
    const r = postingSignals({ hasApplyButton: false, descriptionLength: 900, title: "Careers" });
    expect(r.isPosting).toBe(true);
    expect(r.reasons).toEqual(["long description", "posting-like title"]);
  });

  it("stays quiet on a bare apply button or a bare long page", () => {
    expect(
      postingSignals({ hasApplyButton: true, descriptionLength: 50, title: "Home" }).isPosting,
    ).toBe(false);
    expect(
      postingSignals({ hasApplyButton: false, descriptionLength: 900, title: "Home" }).isPosting,
    ).toBe(false);
  });
});

describe("isDenied", () => {
  it("matches hosts case-insensitively", () => {
    expect(isDenied("Jobs.Example.com", ["jobs.example.com"])).toBe(true);
    expect(isDenied("other.com", ["jobs.example.com"])).toBe(false);
    expect(isDenied("x.com", [])).toBe(false);
  });

  it("always denies aggregators that link out", () => {
    expect(isDenied("hiring.cafe", [])).toBe(true);
    expect(isDenied("www.hiringcafe.com", [])).toBe(true);
    expect(isDenied("careers.pcl.com", [])).toBe(false);
  });

  it("scopes path entries to their subtree", () => {
    const list = ["www.brightnetwork.co.uk/dashboard"];
    expect(isDenied("www.brightnetwork.co.uk", list, "/dashboard")).toBe(true);
    expect(isDenied("www.brightnetwork.co.uk", list, "/dashboard/")).toBe(true);
    expect(isDenied("www.brightnetwork.co.uk", list, "/dashboard/overview")).toBe(true);
    // Sibling paths and lookalike prefixes stay visible.
    expect(isDenied("www.brightnetwork.co.uk", list, "/jobs/123")).toBe(false);
    expect(isDenied("www.brightnetwork.co.uk", list, "/")).toBe(false);
    expect(isDenied("www.brightnetwork.co.uk", list, "/dashboard-jobs")).toBe(false);
    expect(isDenied("other.co.uk", list, "/dashboard")).toBe(false);
  });

  it("keeps bare-host entries covering the whole host", () => {
    const list = ["www.brightnetwork.co.uk"];
    expect(isDenied("www.brightnetwork.co.uk", list, "/dashboard/")).toBe(true);
    expect(isDenied("www.brightnetwork.co.uk", list, "/jobs/123")).toBe(true);
    expect(isDenied("WWW.BRIGHTNETWORK.CO.UK", list, "/JOBS/123")).toBe(true);
  });
});

describe("isDeniedUrl", () => {
  it("parses the URL before matching entries", () => {
    const list = ["www.brightnetwork.co.uk/dashboard"];
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/dashboard/", list)).toBe(true);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/jobs/1", list)).toBe(false);
    expect(isDeniedUrl("https://www.brightnetwork.co.uk/jobs/1", ["www.brightnetwork.co.uk"])).toBe(
      true,
    );
    expect(isDeniedUrl("not a url", list)).toBe(false);
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
    expect(normalizeFalsePositiveEntry("ftp://example.com/x")).toBeNull();
    expect(normalizeFalsePositiveEntry("")).toBeNull();
  });
});

describe("entryForFalsePositive", () => {
  it("stores host+path so dashboard mutes never cover job pages", () => {
    expect(entryForFalsePositive("https://www.brightnetwork.co.uk/dashboard/", "x")).toBe(
      "www.brightnetwork.co.uk/dashboard",
    );
    expect(entryForFalsePositive("https://example.com/", "example.com")).toBe("example.com");
    expect(entryForFalsePositive("https://example.com/jobs/1?x=1", "example.com")).toBe(
      "example.com/jobs/1",
    );
  });
});

describe("pickTitle", () => {
  it("prefers h1 and strips the site suffix", () => {
    expect(pickTitle("Software Developer Student", "", "Software Developer Student | PCL")).toBe(
      "Software Developer Student",
    );
  });

  it("resolves leading-company titles by role word", () => {
    expect(pickTitle("", "", "PCL - Software Developer Student")).toBe(
      "Software Developer Student",
    );
  });

  it("keeps titles without separators whole", () => {
    expect(pickTitle("", "", "Senior Backend Engineer (Kafka) at Acme Corp")).toBe(
      "Senior Backend Engineer (Kafka) at Acme Corp",
    );
  });

  it("falls back through og to document title", () => {
    expect(pickTitle("", "Backend Engineer - Acme", "")).toBe("Backend Engineer");
    expect(pickTitle("", "", "")).toBe("");
  });
});

describe("detectTrack", () => {
  it("calls analyst work csa and everything else swe", () => {
    expect(detectTrack("Business Systems Analyst", "")).toBe("csa");
    expect(detectTrack("Software Developer Student", "")).toBe("swe");
    expect(detectTrack("Engineer", "works with data analysts daily")).toBe("csa");
  });
});

describe("guessRegion", () => {
  it("reads canadian postings", () => {
    expect(
      guessRegion("https://careers.pcl.com/job/x", "North American HQ in Edmonton, Alberta"),
    ).toBe("ca");
    expect(guessRegion("https://acme.ca/jobs/1", "come work with us")).toBe("ca");
  });

  it("reads us and uk postings", () => {
    expect(guessRegion("https://acme.com/j", "Austin, Texas office")).toBe("us");
    expect(guessRegion("https://acme.co.uk/j", "come work with us")).toBe("uk");
    expect(guessRegion("https://acme.com/j", "London office, hybrid")).toBe("uk");
  });

  it("abstains on ties and silence", () => {
    expect(guessRegion("https://acme.com/j", "remote-first, work anywhere")).toBe("");
    expect(guessRegion("https://acme.com/j", "Toronto or London")).toBe("");
    expect(guessRegion("not a url", "")).toBe("");
  });
});
