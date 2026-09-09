/**
 * Connectivity probe for the optional model step. Reads configuration the
 * same way the server does (explicit `.env` load + `MODEL_*`/`META_*`
 * aliases), sends a minimal completion, and prints only the HTTP status
 * and reply text — the key is never printed or logged.
 *
 * Usage: bun run --filter @jat/server probe  (or: job-app probe)
 */
import { loadTrackerEnv } from "./repo.js";
import { modelConfigFromEnv } from "./model.js";

export async function runProbe(): Promise<number> {
  loadTrackerEnv();
  const cfg = modelConfigFromEnv();
  if (!cfg) {
    console.error("model not configured: set a URL and key (see README)");
    return 2;
  }

  console.log(`POST ${cfg.url.replace(/\/$/, "")}/chat/completions model=${cfg.model}`);

  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 8,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30000),
  });

  console.log(`HTTP ${res.status}`);
  const text = await res.text();
  console.log(text.slice(0, 300));
  return res.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await runProbe());
}
