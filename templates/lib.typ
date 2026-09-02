// ============================================================================
// Resume renderer. Reads the master content library and renders a selection.
//
// Paths below are relative to THIS file, so they resolve no matter which
// application folder imports it. Compile with --root pointing at the repo
// root (bin/build.sh does this for you).
// ============================================================================

#let db-profile = yaml("../content/profile.yml")
#let db-education = yaml("../content/education.yml")
#let db-projects = yaml("../content/projects.yml")
#let db-skills = yaml("../content/skills.yml")

// ---- lookups (fail loudly on a bad id rather than silently dropping) -------

#let find-project(id) = {
  let hits = db-projects.projects.filter(p => p.id == id)
  if hits.len() == 0 {
    panic("Unknown project id: '" + id + "'. See content/projects.yml.")
  }
  hits.first()
}

#let find-bullet(proj, bid) = {
  let hits = proj.bullets.filter(b => b.id == bid)
  if hits.len() == 0 {
    panic("Unknown bullet '" + bid + "' in project '" + proj.id + "'.")
  }
  hits.first().text
}

// ---- main renderer --------------------------------------------------------
//
// DENSITY KNOBS: when a resume spills onto page 2, turn these down before you
// start cutting content. In rough order of what to try first:
//   leading (0.60 -> 0.52), bullet-gap, section-gap, font-size (10 -> 9.5)
// Below 9pt font or 0.45in margin it starts to look cramped; cut a bullet
// instead.

#let resume(
  track: "swe",
  region: "us",
  summary: auto, // auto = default for track; or pass a tailored string
  skills: auto, // auto = default for track; or pass an array of lines
  projects: (), // ((id: "dfs", bullets: ("build", "locking")), ...)
  font-size: 10pt,
  leading: 0.6em,
  section-gap: 9pt,
  bullet-gap: 3pt,
  margin: 0.5in,
  name-size: 19pt,
  font: ("Charter", "Georgia", "Libertinus Serif", "New Computer Modern"),
) = {
  set document(title: db-profile.name + " - Resume", author: db-profile.name)
  set page(paper: "us-letter", margin: margin)
  set text(font: font, size: font-size, lang: "en")
  set par(leading: leading, justify: false)
  set block(spacing: 0pt)
  // tight: false so the gap BETWEEN bullets is larger than the gap between
  // wrapped lines within one bullet — otherwise multi-line bullets blur together.
  set list(marker: [•], indent: 0pt, body-indent: 6pt, spacing: bullet-gap, tight: false)

  let small = font-size - 0.5pt

  let section(title) = {
    v(section-gap, weak: true)
    text(size: small, weight: "bold", tracking: 0.14em)[#upper(title)]
    v(2.5pt, weak: true)
    line(length: 100%, stroke: 0.6pt)
    v(4pt, weak: true)
  }

  // ---- header ----
  align(center)[
    #text(size: name-size, weight: "bold")[#db-profile.name]
    #v(4pt, weak: true)
    #text(size: small)[
      #db-profile.locations.at(region, default: db-profile.locations.us)
      | #link("mailto:" + db-profile.email)[#db-profile.email]
      | #db-profile.phone
    ]
  ]

  let auth = db-profile.work_auth.at(region, default: none)
  if auth != none {
    v(2pt, weak: true)
    align(center)[#text(size: small)[#auth]]
  }

  // ---- summary ----
  let summary-text = if summary == auto { db-profile.summaries.at(track) } else { summary }
  if summary-text != none and summary-text != "" {
    section("Summary")
    summary-text
  }

  // ---- education ----
  section("Education")
  for e in db-education.entries {
    block(width: 100%, below: 3.5pt)[
      #text(weight: "bold")[#e.degree] | #e.school #h(1fr) #e.date
    ]
  }

  // ---- skills ----
  let skill-lines = if skills == auto { db-skills.at(track) } else { skills }
  if skill-lines != none and skill-lines.len() > 0 {
    section("Technical Skills")
    for sl in skill-lines {
      block(width: 100%, below: 2.5pt)[#sl]
    }
  }

  // ---- projects ----
  if projects.len() > 0 {
    section("Technical Systems Projects")
    for (i, sel) in projects.enumerate() {
      let p = find-project(sel.id)
      let title = sel.at("label", default: p.name)
      let ctx = sel.at("context", default: p.context)
      let stack = sel.at("stack", default: none) // pass "" to hide, string to override

      if i > 0 { v(6pt, weak: true) }

      block(width: 100%, below: 3pt)[
        #text(weight: "bold")[#title]
        #if stack == none and p.stack != "" [ #text(size: small)[| #p.stack] ]
        #if stack != none and stack != "" [ #text(size: small)[| #stack] ]
        #if ctx != none and ctx != "" [ #text(size: small)[| #ctx] ]
      ]

      list(..sel.bullets.map(b => [#find-bullet(p, b)]))
    }
  }
}
