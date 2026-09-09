import { describe, expect, it } from "bun:test";
import { autoDraftEnabled, buildResumeTyp } from "./draft.js";

describe("buildResumeTyp", () => {
  it("groups bullets by project in fit order and escapes the summary", () => {
    const out = buildResumeTyp({
      track: "swe",
      region: "uk",
      summary: 'Ship "reliable" systems \\ fast.',
      bullets: [
        { project: "dfs", id: "build" },
        { project: "telemetry", id: "arch" },
        { project: "telemetry", id: "arch" },
        { project: "telemetry", id: "store-forward" },
      ],
      fitOrder: ["telemetry", "dfs"],
    });
    expect(out).toContain('summary: "Ship \\"reliable\\" systems \\\\ fast."');
    const tele = out.indexOf('(id: "telemetry"');
    const dfs = out.indexOf('(id: "dfs"');
    expect(tele).toBeGreaterThan(-1);
    expect(dfs).toBeGreaterThan(tele);
    expect(out).toContain('bullets: ("arch", "store-forward")');
    expect(out).toContain('track: "swe"');
  });
});

describe("autoDraftEnabled", () => {
  it("is opt-in", () => {
    expect(autoDraftEnabled({})).toBe(false);
    expect(autoDraftEnabled({ JAT_AUTO_DRAFT: "1" })).toBe(true);
    expect(autoDraftEnabled({ JAT_AUTO_DRAFT: "0" })).toBe(false);
  });
});
