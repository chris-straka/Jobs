import { describe, expect, it } from "bun:test";
import type { ApplicantFacts } from "@jat/core";
import { checkEligibility, eligibilitySystemPrompt } from "./eligibility.js";

const FACTS: ApplicantFacts = {
  workAuth: "UK YMS Eligible (no sponsorship needed)",
  education: [
    "Master of Science in Computer Science, Georgia Institute of Technology (Aug 2026)",
  ],
  invariants: ["No professional work experience (yet)."],
};

const INPUT = {
  title: "Software Engineer 2027",
  description: "Students must have a graduation date between December 2026 and June 2027.",
  region: "uk",
};

function stubFetch(content: string, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ choices: [{ message: { content } }] }),
  })) as unknown as typeof fetch;
}

describe("eligibilitySystemPrompt", () => {
  it("states the verdict contract around the applicant facts", () => {
    const p = eligibilitySystemPrompt(FACTS);
    expect(p).toContain("INELIGIBLE only when");
    expect(p).toContain("UK YMS Eligible");
    expect(p).toContain("Aug 2026");
    expect(p).toContain("never assert the opposite");
    expect(p).toContain("not legal or immigration advice");
  });
});

describe("checkEligibility", () => {
  it("stays uncertain and offline without config", async () => {
    expect(await checkEligibility(INPUT, FACTS, null)).toEqual({
      disabled: true,
      verdict: "uncertain",
      reasons: [],
      raw: null,
    });
  });

  it("parses model verdicts and reasons", async () => {
    const prevFetch = globalThis.fetch;
    stubFetch(
      JSON.stringify({
        verdict: "ineligible",
        reasons: ["Graduation window Dec 2026–Jun 2027 rules out an Aug 2026 graduate"],
      }),
    );
    try {
      const out = await checkEligibility(INPUT, FACTS, {
        url: "http://model.test",
        key: "k",
        model: "m",
      });
      expect(out.disabled).toBe(false);
      expect(out.verdict).toBe("ineligible");
      expect(out.reasons).toEqual([
        "Graduation window Dec 2026–Jun 2027 rules out an Aug 2026 graduate",
      ]);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it("falls back to uncertain on garbage and errors", async () => {
    const prevFetch = globalThis.fetch;
    try {
      stubFetch("nope, not json");
      const garbage = await checkEligibility(INPUT, FACTS, {
        url: "http://model.test",
        key: "k",
        model: "m",
      });
      expect(garbage.disabled).toBe(false);
      expect(garbage.verdict).toBe("uncertain");

      stubFetch("", false);
      const failed = await checkEligibility(INPUT, FACTS, {
        url: "http://model.test",
        key: "k",
        model: "m",
      });
      expect(failed.disabled).toBe(false);
      expect(failed.verdict).toBe("uncertain");
      expect(failed.raw).toContain("HTTP 500");
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});
