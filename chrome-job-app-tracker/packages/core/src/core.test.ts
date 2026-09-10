import { afterAll, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuplicateApplication, addApplication, removeApplication } from "./add.js";
import { buildResumes, isPageOverflow } from "./build.js";
import { formatRow, parseCsv } from "./csv.js";
import { findByUrl, loadInvariants, readSavedDescription } from "./library.js";
import {
  mergeFalsePositives,
  parseFalsePositives,
  readFalsePositives,
  writeFalsePositives,
} from "./ignore.js";
import { openApplicationFolder } from "./open.js";
import { listApplications, readApplicationStatus, setApplicationStatus } from "./status.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const jobsRoot = path.resolve(here, "..", "..", "..", "..");

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function mkRoot(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "jat-core-"));
  tmpDirs.push(dir);
  await mkdir(path.join(dir, "applications"), { recursive: true });
  return dir;
}

const INPUT = {
  url: "https://example.com/jobs/1",
  company: "Acme, Inc.",
  role: 'Backend "Engineer"',
  track: "swe",
  region: "uk",
  description: "A very long posting. ".repeat(10),
};

describe("csv", () => {
  it("round-trips commas and quotes", () => {
    const row = {
      date: "2026-09-09",
      company: "Acme, Inc.",
      role: 'Backend "Engineer"',
      track: "swe",
      region: "uk",
      status: "draft",
      url: "https://example.com/jobs/1",
      folder: "applications/2026-09-09_acme-inc_backend-engineer",
    };
    const { rows } = parseCsv(
      `date,company,role,track,region,status,url,folder\n${formatRow(row)}\n`,
    );
    expect(rows).toEqual([row]);
  });
});

describe("addApplication", () => {
  it("scaffolds job.md, resume.typ, notes.md, and a CSV row", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    expect(folder).toBe("applications/2026-09-09_acme-inc_backend-engineer");
    const job = await readFile(path.join(root, folder, "job.md"), "utf8");
    expect(job).toContain("status: draft");
    expect(job).toContain(`url: "${INPUT.url}"`);
    expect(job).toContain(INPUT.description);
    const typ = await readFile(path.join(root, folder, "resume.typ"), "utf8");
    expect(typ).toContain('track: "swe"');
    const csv = await readFile(path.join(root, "applications.csv"), "utf8");
    expect(csv.split("\n")[0]).toBe("date,company,role,track,region,status,url,folder");
    expect(csv).toContain('"Acme, Inc."');
    expect(csv).toContain('"Backend ""Engineer"""');
  });

  it("rejects duplicates and bad input", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    expect(() => addApplication(root, INPUT, "2026-09-09")).toThrow("already exists");
    try {
      addApplication(root, INPUT, "2026-09-09");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateApplication);
      expect((err as DuplicateApplication).folder).toBe(folder);
    }
    expect(() => addApplication(root, { ...INPUT, track: "pm" }, "2026-09-10")).toThrow(
      "track must be",
    );
    expect(() => addApplication(root, { ...INPUT, description: "  " }, "2026-09-10")).toThrow(
      "empty",
    );
  });

  it("removes the folder and its tracker row, keeping the rest", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    const other = addApplication(root, { ...INPUT, role: "Frontend Engineer" }, "2026-09-10");
    removeApplication(root, folder);
    await expect(readFile(path.join(root, folder, "job.md"), "utf8")).rejects.toThrow();
    const csv = await readFile(path.join(root, "applications.csv"), "utf8");
    expect(csv).not.toContain(folder);
    expect(csv).toContain(other.folder);
  });
});

describe("findByUrl", () => {
  it("matches across tracking params, case, www, and fragments", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(
      root,
      { ...INPUT, url: "https://Example.com/jobs/1?utm_source=x" },
      "2026-09-09",
    );
    expect(findByUrl(root, "https://www.example.com/jobs/1/?fbclid=y#apply")).toBe(folder);
    expect(findByUrl(root, "https://other.com/jobs/1")).toBeNull();
    expect(findByUrl(root, "")).toBeNull();
  });

  it("prefers the newest folder when a URL is recycled", async () => {
    const root = await mkRoot();
    const old = addApplication(root, INPUT, "2026-09-09");
    const current = addApplication(root, { ...INPUT, role: "Backend Engineer II" }, "2026-09-10");
    expect(old.folder).not.toBe(current.folder);
    expect(findByUrl(root, INPUT.url)).toBe(current.folder);
  });
});

describe("readSavedDescription", () => {
  it("returns the job.md body without front-matter", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    expect(readSavedDescription(root, folder)).toBe(INPUT.description.trim());
    expect(readSavedDescription(root, "applications/9999-99-99_nope_x")).toBeNull();
  });
});

describe("loadInvariants", () => {
  it("reads the hard truths list, tolerating a missing file", async () => {
    const root = await mkRoot();
    expect(loadInvariants(root)).toEqual([]);
    await mkdir(path.join(root, "content"), { recursive: true });
    await writeFile(
      path.join(root, "content", "invariants.yml"),
      'invariants:\n  - "No professional work experience (yet)."\n',
    );
    expect(loadInvariants(root)).toEqual(["No professional work experience (yet)."]);
  });
});

describe("readApplicationStatus", () => {
  it("tracks draft → applied and null for unknown folders", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    expect(readApplicationStatus(root, folder)).toBe("draft");
    setApplicationStatus(root, folder, "applied");
    expect(readApplicationStatus(root, folder)).toBe("applied");
    expect(readApplicationStatus(root, "applications/9999-99-99_nope_x")).toBeNull();
  });
});

describe("false positives", () => {
  it("round-trips normalized and merges", async () => {
    const root = await mkRoot();
    expect(readFalsePositives(root)).toEqual({ falsePositives: [] });
    writeFalsePositives(root, { falsePositives: ["B.com ", "a.com", "a.com"] });
    expect(readFalsePositives(root)).toEqual({ falsePositives: ["a.com", "b.com"] });
    const merged = mergeFalsePositives(readFalsePositives(root), {
      falsePositives: ["d.com", "a.com"],
    });
    expect(merged).toEqual({ falsePositives: ["a.com", "b.com", "d.com"] });
  });

  it("reads a legacy split-shape file unioned", async () => {
    const root = await mkRoot();
    await mkdir(path.join(root, ".jat"), { recursive: true });
    await writeFile(
      path.join(root, ".jat", "ignore.json"),
      JSON.stringify({ fpReported: ["B.com "], fpHosts: ["c.com", "b.com"] }),
    );
    expect(readFalsePositives(root)).toEqual({ falsePositives: ["b.com", "c.com"] });
  });

  it("parses current and legacy bodies, rejects garbage", () => {
    expect(parseFalsePositives({ falsePositives: ["A.com "] })).toEqual({
      falsePositives: ["a.com"],
    });
    expect(parseFalsePositives({ fpReported: ["a.com"], fpHosts: ["B.com"] })).toEqual({
      falsePositives: ["a.com", "b.com"],
    });
    expect(parseFalsePositives({ falsePositives: "nope" })).toBeNull();
    expect(parseFalsePositives({ nope: [] })).toBeNull();
  });
});

describe("openApplicationFolder", () => {
  it("prefers code when the CLI exists, Finder otherwise", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    const calls: string[][] = [];
    const withCode = (cmd: string, args: string[]): { status: number | null; output: string } => {
      calls.push([cmd, ...args]);
      if (cmd === "sh") return { status: 0, output: "/usr/local/bin/code\n" };
      return { status: 0, output: "" };
    };
    expect(openApplicationFolder(root, folder, withCode)).toEqual({ via: "code" });
    expect(calls[1][0]).toBe("code");
    expect(calls[1][1]).toContain(folder);

    const calls2: string[][] = [];
    const withoutCode = (
      cmd: string,
      args: string[],
    ): { status: number | null; output: string } => {
      calls2.push([cmd, ...args]);
      if (cmd === "sh") return { status: 1, output: "" };
      return { status: 0, output: "" };
    };
    expect(openApplicationFolder(root, folder, withoutCode)).toEqual({ via: "finder" });
    expect(calls2[1][0]).toBe("open");
  });

  it("throws for missing folders and failed openers", async () => {
    const root = await mkRoot();
    const ok = (): { status: number | null; output: string } => ({ status: 0, output: "" });
    expect(() => openApplicationFolder(root, "applications/9999-99-99_nope_x", ok)).toThrow(
      /no such folder/,
    );
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    const failing = (): { status: number | null; output: string } => ({ status: 1, output: "" });
    expect(() => openApplicationFolder(root, folder, failing)).toThrow(/could not open/);
  });
});

describe("setApplicationStatus", () => {
  it("moves csv + job.md together and restores byte-identical", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    const jobBefore = await readFile(path.join(root, folder, "job.md"), "utf8");
    const csvBefore = await readFile(path.join(root, "applications.csv"), "utf8");
    expect(setApplicationStatus(root, folder, "applied")).toEqual({ old: "draft" });
    expect(
      (await readFile(path.join(root, folder, "job.md"), "utf8")).includes("status: applied"),
    ).toBe(true);
    expect(setApplicationStatus(root, folder, "draft")).toEqual({ old: "applied" });
    expect(await readFile(path.join(root, folder, "job.md"), "utf8")).toBe(jobBefore);
    expect(await readFile(path.join(root, "applications.csv"), "utf8")).toBe(csvBefore);
  });

  it("fails on unknown folders", async () => {
    const root = await mkRoot();
    expect(() => setApplicationStatus(root, "applications/nope", "applied")).toThrow(
      "no such folder",
    );
  });
});

describe("listApplications", () => {
  it("reports pdf state and drift", async () => {
    const root = await mkRoot();
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    let listed = listApplications(root);
    expect(listed.rows[0].pdf).toBe("missing");
    expect(listed.warnings.join("\n")).toContain("missing");

    await writeFile(path.join(root, folder, "chris-straka-resume.pdf"), "fake");
    listed = listApplications(root);
    expect(listed.rows[0].pdf).toBe("ok");

    await writeFile(path.join(root, folder, "resume.typ"), "newer");
    listed = listApplications(root);
    expect(listed.rows[0].pdf).toBe("stale");
  });
});

describe("isPageOverflow", () => {
  it("spots page spills but not other failures", () => {
    expect(isPageOverflow({ ok: true, lines: ["  ok       x.pdf"] })).toBe(false);
    expect(
      isPageOverflow({ ok: false, lines: ["  2 PAGES  x/resume.typ  <- turn down leading"] }),
    ).toBe(true);
    expect(
      isPageOverflow({
        ok: false,
        lines: ["  2 PAGES  x/resume.typ", "  FAILED   y/resume.typ"],
      }),
    ).toBe(false);
    expect(isPageOverflow({ ok: false, lines: ["  TODO     x/resume.typ"] })).toBe(false);
  });
});

describe("buildResumes", () => {
  it("reports missing targets without invoking typst", () => {
    const r = buildResumes(jobsRoot, ["applications/does-not-exist"], () => {
      throw new Error("typst must not run");
    });
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("MISSING");
  });

  it("gates TODO bullets and counts pages from fixture files", async () => {
    const root = await mkRoot();
    await cp(path.join(jobsRoot, "content"), path.join(root, "content"), { recursive: true });
    const dir = path.join(root, "applications", "2026-09-09_acme_x");
    await mkdir(dir, { recursive: true });
    const typ = path.join(dir, "resume.typ");
    const pdf = path.join(dir, "chris-straka-resume.pdf");
    const clean = () => buildResumes(root, [dir], () => ({ status: 0, output: "" }));

    await writeFile(typ, '(id: "telemetry", bullets: ("gitops"))\n');
    const todo = clean();
    expect(todo.ok).toBe(false);
    expect(todo.lines.join("\n")).toContain("TODO");
    expect(todo.lines.join("\n")).toContain("gitops");

    await writeFile(typ, "plain\n");
    await writeFile(pdf, "fake /Count 2 pdf");
    const pages = clean();
    expect(pages.ok).toBe(false);
    expect(pages.lines.join("\n")).toContain("PAGES");

    await writeFile(pdf, "fake /Count 1 pdf");
    const ok = clean();
    expect(ok.ok).toBe(true);
    expect(ok.lines.join("\n")).toContain("ok");
  });

  it("compiles a real scaffolded resume to one page", async () => {
    const root = await mkRoot();
    await cp(path.join(jobsRoot, "content"), path.join(root, "content"), { recursive: true });
    await cp(path.join(jobsRoot, "templates"), path.join(root, "templates"), { recursive: true });
    const { folder } = addApplication(root, INPUT, "2026-09-09");
    const r = buildResumes(root, [folder]);
    expect(r.lines.join("\n")).toContain("ok");
    expect(r.ok).toBe(true);
  }, 120000);
});
