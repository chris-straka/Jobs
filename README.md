# Job applications

One folder per application. One tailored, one-page resume per application,
compiled from a shared bullet library so you edit facts in one place.

## Setup (once)

```bash
brew install typst
chrome-job-app-tracker/packages/cli/install.sh   # compiles ja to ~/.local/bin
```

`ja --help` lists everything; one command, subcommands below.

## Every application

```bash
# 1. paste the job URL; it prompts for the rest, then for the description
#    (paste it, Ctrl-D). Company is guessed from the URL.
ja add https://example.com/jobs/quality-engineer-123

# 2. tailor it (in your editor, with Claude Code or Codex):
claude "tailor applications/2026-09-02_example-co_quality-engineer to job.md"

# 3. compile + verify it's still one page:
ja build applications/2026-09-02_example-co_quality-engineer

# later: check the tracker, move status (csv + job.md together)
ja list
ja status applications/2026-09-02_example-co_quality-engineer applied
```

`typst watch --root . applications/<dir>/resume.typ` gives a live preview while
you edit.

## Where things live

- `content/` — every bullet you've ever written, with stable ids. Fix a typo
  here and it's fixed in every future resume.
- `content/defaults.yml` — the projects each track starts with. Edit this when
  your *default* pitch changes, not for one posting.
- `templates/lib.typ` — the renderer. All layout lives here.
- `applications/` — the archive. `job.md` is the posting verbatim, `chris-straka-resume.pdf`
  is exactly what you sent.
- `applications.csv` — the tracker. `ja list` shows it with pdf + status checks;
  `ja status` moves an application (csv + job.md together).
- `chrome-job-app-tracker/` — optional click-to-capture companion (MV3 extension
  + local Bun server). Same folders out the other end; see its README.
- `docs/` — source material only (project write-ups, course notes, job-board
  lists). Never compiled into a resume; background reading for tailoring.

Compiled PDFs are committed on purpose: they're the record of what you actually
sent, and they shouldn't change when the library does.
