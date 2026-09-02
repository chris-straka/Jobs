// Base CSA (Computer Systems Analyst) resume. Copied by bin/new-app.sh.
// Tailor the copy, never this file.
//
// CSA postings reward requirements/analysis/business-alignment language over
// implementation depth. Lead with hci/dbmodel bullets when the posting is
// analyst-heavy; lead with telemetry when it's infrastructure-heavy.

#import "lib.typ": resume

#resume(
  track: "csa",
  region: "us", // us | ca | uk  — controls location + work-auth lines

  // summary: "override me per posting",
  // skills: ("line one", "line two"),

  projects: (
    (
      id: "telemetry",
      bullets: ("arch", "terraform", "ai-pipeline", "observability"),
    ),
    (
      id: "hci",
      bullets: ("research", "prototypes", "usability"),
    ),
    (
      id: "dbmodel",
      bullets: ("normalize", "sql", "integrity"),
    ),
    (
      id: "swanalysis",
      bullets: ("static-dynamic", "llvm"),
    ),
  ),
)
