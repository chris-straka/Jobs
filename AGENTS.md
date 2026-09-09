# Job applications repo

Chris Straka. One tailored resume per application, compiled from a shared
bullet library with Typst.

Two tracks: **swe** (software engineer) and **csa** (computer systems analyst).
Three regions: **us** (TN visa), **ca**, **uk** (Youth Mobility Scheme).
Region only controls the location and work-authorization lines in the header.

## Layout

```
content/         master bullet library — single source of truth,
                 including defaults.yml (each track's starting projects)
templates/       lib.typ — the renderer, all layout lives here
applications/    YYYY-MM-DD_company_role/ — job.md, resume.typ, chris-straka-resume.pdf, notes.md
applications.csv tracker
chrome-job-app-tracker/  the tooling: ja CLI + @jat/core (the one
                 implementation of add/build/list/status), local server,
                 MV3 extension, native-messaging host
```

One implementation: `@jat/core` (add/build/list/status). The `ja` CLI,
the server, and the tests all call it — never reimplement an operation,
never shell out to a duplicate.

## Commands

```bash
ja add https://posting            # prompts for the rest
ja build applications/2026-09-02_company_role   # one
ja build                                        # everything
ja list                                         # tracker + drift check
ja status <folder> applied                      # csv + job.md together
typst watch --root . applications/<dir>/resume.typ  # live preview while editing
```

`--root .` (from the repo root) is **required** — resume.typ reaches up into
`templates/` and `content/`, and Typst refuses to read above its root without it.

## The main task: tailoring a resume to a posting

When asked to tailor an application:

1. Read `job.md` in that folder. It's the posting, verbatim.
2. Edit **only** that folder's `resume.typ`. Never edit `content/defaults.yml`
   (it's the starting point for every future application) and never edit
   `content/*.yml` just to fit one posting.
3. Three levers, in order of leverage:
   - `summary:` — override it with 2–3 lines echoing the posting's own language.
     This is the highest-value edit. The default is generic.
   - `skills:` — override with the same skills reordered so the posting's stack
     comes first.
   - `projects:` — defaults to the track's list in `content/defaults.yml`.
     Write an explicit list in `resume.typ` to reorder so the project answering
     the posting's hardest requirement is first, with `bullets:` ids that match.
4. Run `ja build <dir>`. It fails if the PDF is more than one page.
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
`leading` (0.45em → 0.40em), `bullet-gap`, `section-gap`, then `font-size`
(12pt → 11pt). Below 10pt font or 0.6in margin it looks cramped — cut a bullet
instead. The default is 12pt with 1in margins, which fills the page at 6–7 bullets.
Adding a bullet means dropping one, or turning the knobs down.

## Content notes

- `content/projects.yml` bullets carry a `track:` hint (`swe` / `csa` / `both`).
  It's a suggestion for selection, not a restriction.
- The summaries in `content/profile.yml` say "Formerly certified..." for lapsed
  certifications. Chris is aware this reads oddly; don't silently change it to
  claim active certification.
