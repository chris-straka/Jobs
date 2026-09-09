# chrome-job-app-tracker

Click-to-capture companion for the Jobs repo. On a job posting, open the
popup, confirm the fields, hit Save: the posting lands as a new
`applications/YYYY-MM-DD_company_role/` folder with a fit report, exactly as
if you had pasted it into `add-job` yourself.

Two parts, one thin and one doing the work:

- `packages/extension/` — Manifest V3 extension. A content script extracts the
  posting text from the visible tab; the popup (company, role, track, region,
  server URL, editable description) validates with Zod and POSTs to the local
  server. It cannot write files — browsers don't allow that.
- `packages/server/` — local Bun server (default `http://127.0.0.1:8765`).
  Validates the capture, scaffolds via `bin/add-job` (the same script a human
  runs — single source of truth), runs a deterministic fit analysis against
  `content/projects.yml`, verifies the starter resume with `bin/build.sh`,
  and optionally asks a model for a summary draft + bullet picks.
- `packages/shared/` — Zod schemas, keyword scoring, and `analyzeFit`,
  imported by both.

The human gate stays: the server drafts, you confirm. `build.sh` still
enforces one page and no TODO bullets, and suggested bullet ids are filtered
against the library in code — unknown ids are dropped, so the model cannot
invent experience into a factual document.

## Quickstart

```bash
cd chrome-job-app-tracker
bun install          # once
bun run server       # localhost:8765, root defaults to the Jobs checkout
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`packages/extension`. Open a posting, click the extension, confirm, Save.

Useful scripts (from `chrome-job-app-tracker/`):

```bash
bun run test       # bun test across all three packages (17 tests)
bun run typecheck  # tsc --noEmit per package (Bun strips types; it never checks them)
bun run build      # typecheck + bundle the extension to packages/extension/dist
bun run lint       # eslint
bun run format     # prettier --write
```

## Configuration

| Env             | Default                 | Meaning                                             |
| --------------- | ----------------------- | --------------------------------------------------- |
| `PORT`          | `8765`                  | server listen port                                  |
| `REPO_ROOT`     | parent of this checkout | Jobs repo to write into (tests override)            |
| `MODEL_API_URL` | — (model step disabled) | OpenAI-compatible base URL                          |
| `MODEL_API_KEY` | —                       | bearer key, stays server-side, never in the browser |
| `MODEL_NAME`    | —                       | model id for `/chat/completions`                    |

Endpoints: `GET /health`, `POST /api/capture` (see `CaptureRequest` in
`packages/shared/src/schemas.ts`).

## Fair-use note

HiringCafe's terms (§5) ban republishing, selling, and redistributing their
material, with a personal-use carve-out; their robots.txt also disallows
paginated crawling. This tool stays on the benign end on purpose:
user-initiated capture of single postings you are applying to, for personal
use — the automated equivalent of copy-paste. Don't bulk-crawl, don't
republish listings, and keep `job.md` files private like the rest of the repo.
