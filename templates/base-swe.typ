// Base SWE resume. bin/new-app.sh copies this into a new application folder.
// Tailor the copy, never this file — this is the starting point for every SWE app.
//
// Workflow: read job.md, then (1) rewrite `summary` to echo the posting's
// language, (2) reorder `skills` to lead with their stack, (3) swap bullets
// so the top project answers the posting's hardest requirement.

#import "lib.typ": resume

#resume(
  track: "swe",
  region: "ca", // us | ca | uk  — controls location + work-auth lines

  // summary: "override me per posting",
  // skills: ("line one", "line two"),

  projects: (
    (
      id: "telemetry",
      bullets: ("arch", "store-forward", "idempotency", "api-relay"),
    ),
    (
      id: "dfs",
      bullets: ("build", "locking", "protobuf"),
    ),
    (
      id: "proxy",
      bullets: ("multithread", "shm", "boss-worker"),
    ),
    (
      id: "sdn",
      bullets: ("firewall", "ddos"),
    ),
  ),
)
