import { describe, expect, it } from "bun:test";
import { cleanText, isDenied, pickDescription, postingSignals } from "./extract.js";

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
});

