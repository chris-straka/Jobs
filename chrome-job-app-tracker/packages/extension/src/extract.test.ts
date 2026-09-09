import { describe, expect, it } from "bun:test";
import { cleanText, guessCompany, pickDescription } from "./extract.js";

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

describe("guessCompany", () => {
  it("reads the company from ATS paths", () => {
    expect(guessCompany("https://job-boards.greenhouse.io/intersystems/jobs/7827897003")).toBe(
      "intersystems",
    );
  });

  it("reads the company from ATS hostnames", () => {
    expect(guessCompany("https://acme.wd1.myworkdayjobs.com/en-US/careers")).toBe("acme");
  });

  it("reads the registrable name from careers sites", () => {
    expect(guessCompany("https://careers.acme.co.uk/search")).toBe("acme");
  });

  it("refuses to guess on aggregators and garbage", () => {
    expect(guessCompany("https://www.linkedin.com/jobs/view/123")).toBe("");
    expect(guessCompany("not a url")).toBe("");
  });
});
