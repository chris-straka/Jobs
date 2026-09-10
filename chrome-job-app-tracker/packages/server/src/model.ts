import type { LibraryProject, ModelSuggestion } from "@jat/shared";

export interface ModelConfig {
  url: string;
  key: string;
  model: string;
}

/**
 * @returns the model configuration when URL, key, and model are all set;
 * `null` (model step disabled) otherwise
 */
/**
 * Accepts the canonical `MODEL_*` names plus the `META_*` aliases, so an
 * existing Meta-flavored `.env` works untouched. The model defaults to
 * `muse-spark-1.3-contributor` when URL + key are present but no name is set.
 */
export function modelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ModelConfig | null {
  const url = env.MODEL_API_URL ?? env.META_BASE_URL;
  const key =
    env.MODEL_API_KEY ?? env.META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE ?? env.META_API_KEY;
  const model = env.MODEL_NAME ?? "muse-spark-1.3-contributor";
  if (!url || !key) return null;
  return { url, key, model };
}

const disabled = (): ModelSuggestion => ({
  disabled: true,
  summary: null,
  bullets: [],
  gaps: [],
  notes: null,
  raw: null,
});

function libraryDigest(library: LibraryProject[]): string {
  return library
    .map((p) => `${p.id} (${p.name}): ${p.bullets.map((b) => `[${b.id}] ${b.text}`).join(" ")}`)
    .join("\n")
    .slice(0, 12000);
}

/**
 * Optional model pass: tailored summary draft + bullet picks + gaps.
 * The repo's never-invent-a-bullet rule is enforced in code — suggested ids
 * not present in the library are dropped, whatever the model returns.
 */
export async function suggest(
  description: string,
  library: LibraryProject[],
  cfg: ModelConfig | null = modelConfigFromEnv(),
): Promise<ModelSuggestion> {
  if (!cfg) return disabled();

  const known = new Set<string>();
  for (const p of library) for (const b of p.bullets) known.add(`${p.id}:${b.id}`);

  const body = {
    model: cfg.model,
    messages: [
      {
        role: "system",
        content:
          "You help tailor a one-page resume to a job posting. " +
          'Reply with JSON only: {"summary": string, "bullets": [{"project": string, "id": string}], "gaps": [string], "notes": string}. ' +
          "SUMMARY is 2-3 lines echoing the posting's language. BULLETS may ONLY use project/id pairs from the library below — " +
          "never invent experience or ids — and choose at most 6, ranked best fit first. GAPS lists posting requirements nothing in the library covers. " +
          "NOTES is markdown for the applicant's private notes.md with exactly these sections: " +
          "## What's missing (posting requirements the library doesn't cover and what would close each gap), " +
          "## Interview prep (what to expect and how to prepare, grounded in the posting), " +
          "## Notes (anything else worth knowing before applying). " +
          "Never invent experience in NOTES either — mark speculation as such.",
      },
      {
        role: "user",
        content: `LIBRARY:\n${libraryDigest(library)}\n\nPOSTING:\n${description.slice(0, 8000)}`,
      },
    ],
  };

  try {
    const res = await fetch(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return { ...disabled(), disabled: false, raw: `model error: HTTP ${res.status}` };
    const text = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = text.choices?.[0]?.message?.content ?? "";
    const json = content
      .replace(/^```(?:json)?/m, "")
      .replace(/```$/m, "")
      .trim();
    const parsed = JSON.parse(json) as {
      summary?: unknown;
      bullets?: unknown;
      gaps?: unknown;
      notes?: unknown;
    };
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
    const kept = bullets
      .filter(
        (b): b is { project: string; id: string } =>
          typeof b === "object" &&
          b !== null &&
          typeof (b as { project: unknown }).project === "string" &&
          typeof (b as { id: unknown }).id === "string" &&
          known.has(`${(b as { project: string }).project}:${(b as { id: string }).id}`),
      )
      .map((b) => ({ project: b.project, id: b.id }));
    return {
      disabled: false,
      summary: typeof parsed.summary === "string" ? parsed.summary : null,
      bullets: kept,
      gaps: Array.isArray(parsed.gaps)
        ? parsed.gaps.filter((g): g is string => typeof g === "string")
        : [],
      notes: typeof parsed.notes === "string" && parsed.notes.trim() ? parsed.notes.trim() : null,
      raw: content.slice(0, 4000),
    };
  } catch (err) {
    return { ...disabled(), disabled: false, raw: `model error: ${String(err)}`.slice(0, 500) };
  }
}
