# Job applications

One folder per application. One tailored, one-page resume per application,
compiled from a shared bullet library so you edit facts in one place.

## Setup (once)

```bash
brew install typst
```

## Every application

```bash
# 1. paste the job URL; it prompts for the rest, then for the description
#    (paste it, Ctrl-D). Company is guessed from the URL.
add-job https://example.com/jobs/quality-engineer-123

# 2. tailor it (in your editor, with Claude Code or Codex):
claude "tailor applications/2026-09-02_example-co_quality-engineer to job.md"

# 3. compile + verify it's still one page:
bin/build.sh applications/2026-09-02_example-co_quality-engineer
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
- `applications.csv` — the tracker.
- `docs/` — source material only (project write-ups, course notes, job-board
  lists). Never compiled into a resume; background reading for tailoring.

Compiled PDFs are committed on purpose: they're the record of what you actually
sent, and they shouldn't change when the library does.
