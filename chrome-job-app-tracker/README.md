# chrome-job-app-tracker

Click-to-capture companion for the Jobs repo. On a job posting, open the
popup, confirm the fields, hit Save: the posting lands as a new
`applications/YYYY-MM-DD_company_role/` folder with a fit report, exactly as
if you had run `ja add` yourself.

All repo operations live in `packages/core/` (`@jat/core`): the `ja` CLI,
the server, and the tests all call it. Install the CLI once with
`packages/cli/install.sh` (compiles `ja` to `~/.local/bin`), then
`ja --help` is the whole manual.

Two parts, one thin and one doing the work:

- `packages/extension/` — Manifest V3 extension. A content script extracts the
  posting text from the visible tab, shows a "Save this job?" pill on likely
  postings (with "Not a posting" feeding a host-or-path ignore list —
  `host/dashboard` mutes only that subtree — and an "Ineligible" button for
  postings you rule out, listed on the Manage page and synced to
  `.jat/ineligible.json`), and
  watches apply-button clicks to offer one-click "Mark applied". A background
  worker relays those to the server. The popup (company, role, track, region,
  server URL, editable description) validates with Zod and POSTs to the local
  server, and shows a server health dot. Nothing in the browser writes files —
  browsers don't allow that.
- `packages/server/` — local Bun server (default `http://127.0.0.1:8765`).
  Validates the capture, scaffolds via `@jat/core` (the same code `ja`
  runs), runs a deterministic fit analysis against `content/projects.yml`,
  verifies the starter resume build, and optionally asks a model for a
  summary draft + bullet picks.
- `packages/shared/` — Zod schemas, keyword scoring, `analyzeFit`, URL helpers,
  imported by everyone.
- `packages/native-host/` — optional one-click server start/stop from the
  popup (see below).

The human gate stays: the server drafts, you confirm. The build still
enforces one page and no TODO bullets, and suggested bullet ids are filtered
against the library in code — unknown ids are dropped, so the model cannot
invent experience into a factual document.

LinkedIn declutter (same extension, no server needed): on `linkedin.com`
pages the content script hides the discovery modules — "People also
viewed" (plus "More profiles for you"), "People you may know", "You might
like", and "Add to your feed" — matched by heading text with an observer
for SPA inserts — plus "Try Premium" upsell cards (found by CTA link),
loading skeletons (released when real content arrives, so legit modules
still appear), nav buttons (Home, My Network, For Business, and the nav's
own Try Premium link — items only, never the header), the LinkedIn News
module, Promoted ads (skipped on jobs pages, where the label marks real
listings), and the whole home feed column on feed paths (single-post
permalinks stay visible). The early `document_start` script hides inserts
before first paint; the popup's LinkedIn section toggles each group live.
Job modules ("Top job picks", "Recommended for you") are deliberately left
alone. English copy only; when LinkedIn renames a module, update
`LINKEDIN_CLEAN_GROUPS`/patterns in `packages/extension/src/linkedin-clean.ts`.

## Quickstart

```bash
cd chrome-job-app-tracker
bun install          # once
bun run server       # localhost:8765, root defaults to the Jobs checkout
```

Load the extension: `chrome://extensions` → Developer mode → Load unpacked →
`packages/extension` in this checkout (run `bun run dev` there while iterating).
Open a posting, click the extension, confirm, Save. `ja extension` makes a
disposable copy in `~/Downloads` instead.

Useful scripts (from `chrome-job-app-tracker/`):

```bash
bun run test       # bun test across all three packages (17 unit tests)
bun run typecheck  # tsc --noEmit per package (Bun strips types; it never checks them)
bun run build      # typecheck + bundle the extension to packages/extension/dist
bun run lint       # eslint
bun run format     # prettier --write
```

Browser end-to-end (needs one download, then runs headless):

```bash
bunx playwright install chromium   # once
bun run --filter @jat/extension e2e
```

Two specs in `packages/extension/e2e/`: the real content bundle extracts a
fixture posting, and the real popup saves through a real server into a fixture
repo (asserting the folder, `job.md`, and CSV row).

## Configuration

| Env                   | Default                      | Meaning                                                                                                                              |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                | `8765`                       | server listen port                                                                                                                   |
| `REPO_ROOT`           | parent of this checkout      | Jobs repo to write into (tests override)                                                                                             |
| `MODEL_API_URL`       | — (model step disabled)      | OpenAI-compatible base URL (`META_BASE_URL` also accepted)                                                                           |
| `MODEL_API_KEY`       | —                            | bearer key, stays server-side, never in the browser (`META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE`, `META_API_KEY` also accepted) |
| `MODEL_NAME`          | `muse-spark-1.3-contributor` | model id for `/chat/completions`                                                                                                     |
| `JAT_IDLE_TIMEOUT_MS` | `10800000` (3h)              | idle auto-shutdown in ms (`0` disables; any request resets the timer, captures defer it)                                             |

Put secrets in `chrome-job-app-tracker/.env` (git-ignored, loaded explicitly at
startup regardless of working directory). `bun run --filter @jat/server probe`
sends a tiny completion to verify the wiring without printing the key.

The server runs on demand, not at login: start it while hunting, stop it after.
The popup shows a health dot plus copy buttons for both commands (the start
command is built from the repo root the server reports, so it stays correct).
Set `JAT_AUTO_DRAFT=1` to also write a tailored `resume.typ` draft on capture —
off by default, and still library-filtered, so review before sending.

One-click start/stop (optional): `packages/native-host/install.sh --id <id>`
registers this checkout as Chrome's native-messaging host (find the id at
`chrome://extensions` with Developer mode on). The popup then shows Start/Stop
buttons and hides them again if the host is missing — copy buttons are always
the fallback. `install.sh uninstall` removes it.

Endpoints: `GET /health`, `POST /api/capture`, `GET /api/resolve?url=…`,
`POST /api/status`, `POST /api/eligibility` (see `CaptureRequest`/`StatusRequest`/
`EligibilityRequest` in `packages/shared/src/schemas.ts`). The popup's
Check eligibility button screens the posting against the repo's applicant
facts (work-auth line, education, invariants) — advisory only, and marking
ineligible stays a separate click.

## Fair-use note

HiringCafe's terms (§5) ban republishing, selling, and redistributing their
material, with a personal-use carve-out; their robots.txt also disallows
paginated crawling. This tool stays on the benign end on purpose:
user-initiated capture of single postings you are applying to, for personal
use — the automated equivalent of copy-paste. Don't bulk-crawl, don't
republish listings, and keep `job.md` files private like the rest of the repo.
