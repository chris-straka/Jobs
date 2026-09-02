# Job applications

One folder per application. One tailored, one-page resume per application,
compiled from a shared bullet library so you edit facts in one place.

## Setup (once)

```bash
brew install typst
```

## Every application

```bash
# 1. copy the job description to your clipboard, then:
bin/new-app.sh "Stripe" "Backend Engineer" swe -r us -u https://posting

# 2. tailor it (in your editor, with Claude Code):
claude "tailor applications/2026-09-02_stripe_backend-engineer to job.md"

# 3. compile + verify it's still one page:
bin/build.sh applications/2026-09-02_stripe_backend-engineer
```

`typst watch --root . applications/<dir>/resume.typ` gives a live preview while
you edit.

## Where things live

- `content/` — every bullet you've ever written, with stable ids. Fix a typo
  here and it's fixed in every future resume.
- `templates/base-swe.typ`, `base-csa.typ` — the starting selection for each
  track. Edit these when your *default* pitch changes, not for one posting.
- `applications/` — the archive. `job.md` is the posting verbatim, `resume.pdf`
  is exactly what you sent.
- `applications.csv` — the tracker.

Compiled PDFs are committed on purpose: they're the record of what you actually
sent, and they shouldn't change when the library does.
