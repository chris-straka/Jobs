# Job applications repo

Chris Straka. One tailored resume per application, compiled from a shared
bullet library with Typst.

Two tracks: **swe** (software engineer) and **csa** (computer systems analyst).
Three regions: **us** (TN visa), **ca**, **uk** (Youth Mobility Scheme).
Region only controls the location and work-authorization lines in the header.

## Layout

```
content/         master bullet library — single source of truth
templates/       lib.typ renderer + base-swe.typ / base-csa.typ starting points
applications/    YYYY-MM-DD_company_role/ — job.md, resume.typ, resume.pdf, notes.md
applications.csv tracker
bin/             new-app.sh (scaffold), build.sh (compile + page check)
```

## Commands

```bash
bin/new-app.sh "Company" "Role Title" swe -r us -u https://posting
bin/build.sh applications/2026-09-02_company_role   # one
bin/build.sh                                        # everything
typst watch --root . applications/<dir>/resume.typ  # live preview while editing
```

`--root .` (from the repo root) is **required** — resume.typ reaches up into
`templates/` and `content/`, and Typst refuses to read above its root without it.

## The main task: tailoring a resume to a posting

When asked to tailor an application:

1. Read `job.md` in that folder. It's the posting, verbatim.
2. Edit **only** that folder's `resume.typ`. Never edit `templates/base-*.typ`
   (those are the starting points for every future application) and never edit
   `content/*.yml` just to fit one posting.
3. Three levers, in order of leverage:
   - `summary:` — override it with 2–3 lines echoing the posting's own language.
     This is the highest-value edit. The default is generic.
   - `skills:` — override with the same skills reordered so the posting's stack
     comes first.
   - `projects:` — reorder so the project answering the posting's hardest
     requirement is first, and swap `bullets:` to the ids that match.
4. Run `bin/build.sh <dir>`. It fails if the PDF is more than one page.
5. Report which bullets you swapped in and why.

## Hard rules

- **Never invent a bullet.** Every bullet must already exist in
  `content/projects.yml`. If a posting wants something that isn't in the
  library, say so and ask — do not write a plausible-sounding bullet. This is a
  factual document about Chris's actual experience.
- New bullets get added to `content/projects.yml` only when Chris confirms the
  underlying work is real, and they go in with a stable `id`.
- **One page, always.** It's a deliberate constraint, not an accident.
- Bullets are referenced by id, so a typo fix in `content/` propagates to all
  future resumes. Already-compiled PDFs stay frozen — that's intended.
- Drop the work-auth line for Canadian applications (`region: "ca"` does this
  automatically). Keep it for US and UK.

## Fitting one page

Turn these down in the `#resume(...)` call before cutting content:
`leading` (0.6em → 0.52em), `bullet-gap`, `section-gap`, then `font-size`
(10pt → 9.5pt). Below 9pt font or 0.45in margin it looks cramped — cut a bullet
instead. The base templates currently fill about 60% of the page, so there's
room for roughly 6–8 more bullets before this matters.

## Content notes

- `content/projects.yml` bullets carry a `track:` hint (`swe` / `csa` / `both`).
  It's a suggestion for selection, not a restriction.
- The summaries in `content/profile.yml` say "Formerly certified..." for lapsed
  certifications. Chris is aware this reads oddly; don't silently change it to
  claim active certification.
