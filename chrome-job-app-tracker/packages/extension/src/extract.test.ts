import { describe, expect, it } from "bun:test";
import {
  cleanText,
  detectTrack,
  guessRegion,
  isDenied,
  pickDescription,
  pickTitle,
  postingSignals,
} from "./extract.js";

describe("cleanText", () => {
  it("collapses whitespace", () => {
    expect(cleanText("  Senior\n\n  Engineer\t(remote) ")).toBe("Senior Engineer (remote)");
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
