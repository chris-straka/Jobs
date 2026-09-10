import { describe, expect, it } from "bun:test";
import { suggestionSystemPrompt } from "./model.js";

describe("suggestionSystemPrompt", () => {
  it("carries the tailoring contract without invariants", () => {
    const p = suggestionSystemPrompt();
    expect(p).toContain("never invent experience or ids");
    expect(p).not.toContain("Hard truths");
  });

  it("appends hard truths verbatim when given", () => {
    const p = suggestionSystemPrompt(["No professional work experience (yet)."]);
    expect(p).toContain("Hard truths about the applicant");
    expect(p).toContain("No professional work experience (yet).");
    expect(p).toContain("never assert the opposite");
  });
});
