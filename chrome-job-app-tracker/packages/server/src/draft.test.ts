import { describe, expect, it } from "bun:test";
import { TIGHT_KNOBS, autoDraftEnabled, buildResumeTyp, dropOneBullet } from "./draft.js";

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
    expect(out).toContain('bullets: ("arch", "store-forward",)');
    expect(out).toContain('track: "swe"');
  });

  it("emits one-element arrays with a trailing comma", () => {
    const out = buildResumeTyp({
      track: "swe",
      region: "ca",
      summary: "Student.",
      bullets: [{ project: "telemetry", id: "arch" }],
      fitOrder: ["telemetry"],
    });
    expect(out).toContain('bullets: ("arch",)');
  });
});

describe("autoDraftEnabled", () => {
  it("is on unless opted out", () => {
    expect(autoDraftEnabled({})).toBe(true);
    expect(autoDraftEnabled({ JAT_AUTO_DRAFT: "1" })).toBe(true);
    expect(autoDraftEnabled({ JAT_AUTO_DRAFT: "0" })).toBe(false);
  });
});

describe("draft fit", () => {
  const bullets = [
    { project: "telemetry", id: "arch" },
    { project: "telemetry", id: "api-relay" },
    { project: "dbmodel", id: "sql" },
    { project: "hci", id: "prototypes" },
  ];
  const fitOrder = ["telemetry", "dbmodel", "hci"];

  it("drops the last bullet of the lowest-ranked multi-bullet project", () => {
    expect(dropOneBullet(bullets, fitOrder)).toEqual([
      { project: "telemetry", id: "arch" },
      { project: "dbmodel", id: "sql" },
      { project: "hci", id: "prototypes" },
    ]);
  });

  it("drops the whole lowest-ranked project when all hold one bullet", () => {
    const singles = [
      { project: "telemetry", id: "arch" },
      { project: "dbmodel", id: "sql" },
      { project: "hci", id: "prototypes" },
    ];
    expect(dropOneBullet(singles, fitOrder)).toEqual([
      { project: "telemetry", id: "arch" },
      { project: "dbmodel", id: "sql" },
    ]);
  });

  it("never drops the final bullet", () => {
    const one = [{ project: "telemetry", id: "arch" }];
    expect(dropOneBullet(one, fitOrder)).toEqual(one);
  });

  it("renders knob overrides after the project list", () => {
    const typ = buildResumeTyp(
      { track: "swe", region: "ca", summary: "S.", bullets, fitOrder },
      TIGHT_KNOBS,
    );
    expect(typ).toContain("  leading: 0.40em,\n");
    expect(typ).toContain("  bullet-gap: 5pt,\n");
    expect(typ).toContain('    (id: "telemetry", bullets: ("arch", "api-relay",)),');
  });
});
