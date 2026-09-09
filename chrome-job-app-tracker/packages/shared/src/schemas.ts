import { z } from "zod";

export const Track = z.enum(["swe", "csa"]);
export type Track = z.infer<typeof Track>;

export const Region = z.enum(["us", "ca", "uk"]);
export type Region = z.infer<typeof Region>;

/** What the extension sends the local server for one posting. */
export const CaptureRequest = z.object({
  url: z.string().url(),
  company: z.string().min(1).max(120),
  role: z.string().min(1).max(160),
  track: Track,
  region: Region,
  description: z.string().min(50, "description looks empty — capture the full posting"),
});
export type CaptureRequest = z.infer<typeof CaptureRequest>;

export const BulletRef = z.object({
  project: z.string(),
  id: z.string(),
});
export type BulletRef = z.infer<typeof BulletRef>;

export const ProjectFit = z.object({
  id: z.string(),
  name: z.string(),
  /** Fraction of the posting's keyword set covered by this project (0–1). */
  score: z.number(),
  matched: z.array(z.string()),
});
export type ProjectFit = z.infer<typeof ProjectFit>;

/** Deterministic fit report: no model involved. */
export const FitReport = z.object({
  projects: z.array(ProjectFit),
  /** Posting keywords absent from the whole bullet library. */
  gaps: z.array(z.string()),
  libraryBullets: z.number(),
});
export type FitReport = z.infer<typeof FitReport>;

/** Optional model suggestions. `disabled` when no model is configured. */
export const ModelSuggestion = z.object({
  disabled: z.boolean(),
  summary: z.string().nullable(),
  /** Bullet ids, filtered against the library — unknown ids are dropped. */
  bullets: z.array(BulletRef),
  gaps: z.array(z.string()),
  raw: z.string().nullable(),
});
export type ModelSuggestion = z.infer<typeof ModelSuggestion>;

export const CaptureResponse = z.object({
  folder: z.string(),
  buildOk: z.boolean(),
  buildOutput: z.string(),
  fit: FitReport,
  model: ModelSuggestion,
});
export type CaptureResponse = z.infer<typeof CaptureResponse>;
