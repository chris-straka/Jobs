import { describe, expect, it } from "bun:test";
import { CaptureRequest } from "./schemas.js";
import { analyzeFit, type LibraryProject } from "./fit.js";
import { tokenize } from "./keywords.js";

const LIBRARY: LibraryProject[] = [
  {
    id: "telemetry",
    name: "Telemetry",
    bullets: [
      { id: "arch", text: "Event-driven telemetry platform using Apache Kafka and Docker." },
      { id: "store-forward", text: "Edge gateway with SQLite buffer surviving cloud outages." },
    ],
  },
  {
    id: "dfs",
    name: "DFS",
    bullets: [{ id: "build", text: "Distributed file system in C++ using gRPC." }],
  },
];

describe("CaptureRequest", () => {
  it("accepts a complete request", () => {
    const r = CaptureRequest.safeParse({
      url: "https://example.com/jobs/1",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe",
      region: "uk",
      description: "We need Kafka experience and distributed systems knowledge. ".repeat(3),
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad track, region, url, and short descriptions", () => {
    const base = {
      url: "https://example.com/jobs/1",
      company: "Acme",
      role: "Backend Engineer",
      track: "swe",
      region: "uk",
      description: "x".repeat(100),
    };
    expect(CaptureRequest.safeParse({ ...base, track: "pm" }).success).toBe(false);
    expect(CaptureRequest.safeParse({ ...base, region: "eu" }).success).toBe(false);
    expect(CaptureRequest.safeParse({ ...base, url: "not-a-url" }).success).toBe(false);
    expect(CaptureRequest.safeParse({ ...base, description: "too short" }).success).toBe(false);
  });
});

describe("tokenize", () => {
  it("drops stopwords, digits, and single chars", () => {
    expect(tokenize("The Kafka 123 platform and a x")).toEqual(["kafka", "platform"]);
  });
});

describe("analyzeFit", () => {
  const jd =
    "Senior backend engineer. Kafka event streaming, Docker deployments, distributed systems. " +
    "Must know COBOL mainframes and Fortran compilers.";

  it("ranks the covering project first with matched keywords", () => {
    const fit = analyzeFit(jd, LIBRARY);
    expect(fit.projects[0].id).toBe("telemetry");
    expect(fit.projects[0].matched).toContain("kafka");
    expect(fit.libraryBullets).toBe(3);
  });

  it("reports library-absent keywords as gaps", () => {
    const fit = analyzeFit(jd, LIBRARY);
    expect(fit.gaps).toContain("cobol");
    expect(fit.gaps).not.toContain("kafka");
  });
});
