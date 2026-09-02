#!/usr/bin/env bash
# Scaffold one job application: dated folder, tailored resume copy, saved JD.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bin/new-app.sh <company> <role> <swe|csa> [-r us|ca|uk] [-u job-url]

Creates applications/YYYY-MM-DD_company_role/ containing:
  job.md      the posting (seeded from your clipboard if it has anything)
  resume.typ  a copy of templates/base-<track>.typ, wired to your region
  notes.md    recruiter, referral, interview log
...and appends a row to applications.csv.

Copy the job description to your clipboard first and it lands in job.md.

Examples:
  bin/new-app.sh "Stripe" "Backend Engineer" swe -r us -u https://job/123
  bin/new-app.sh "Leidos" "Systems Analyst" csa
EOF
}

[ $# -ge 3 ] || { usage; exit 1; }
COMPANY="$1"; ROLE="$2"; TRACK="$3"; shift 3
REGION=""; URL=""

while getopts ":r:u:h" opt; do
  case "$opt" in
    r) REGION="$OPTARG" ;;
    u) URL="$OPTARG" ;;
    h) usage; exit 0 ;;
    :) die "-$OPTARG needs a value" ;;
    \?) die "unknown flag -$OPTARG" ;;
  esac
done

case "$TRACK" in
  swe|csa) ;;
  *) die "track must be 'swe' or 'csa' (got '$TRACK')" ;;
esac

# Default region by track: CSA is the US/TN track, SWE defaults to Canada.
if [ -z "$REGION" ]; then
  case "$TRACK" in csa) REGION=us ;; swe) REGION=ca ;; esac
fi
case "$REGION" in
  us|ca|uk) ;;
  *) die "region must be us, ca or uk (got '$REGION')" ;;
esac

slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

DATE="$(date +%F)"
NAME="${DATE}_$(slug "$COMPANY")_$(slug "$ROLE")"
DIR="$ROOT/applications/$NAME"

[ -e "$DIR" ] && die "already exists: applications/$NAME"
mkdir -p "$DIR"

# ---- resume.typ: copy the base, fix the import depth, set the region --------
sed -e 's|#import "lib.typ"|#import "../../templates/lib.typ"|' \
    -e "s|^  region: \"[a-z][a-z]\",|  region: \"$REGION\",|" \
    "$ROOT/templates/base-$TRACK.typ" > "$DIR/resume.typ"

# ---- job.md ----------------------------------------------------------------
CLIP=""
if command -v pbpaste >/dev/null 2>&1; then
  CLIP="$(pbpaste 2>/dev/null || true)"
fi

{
  echo "---"
  echo "company: \"$COMPANY\""
  echo "role: \"$ROLE\""
  echo "track: $TRACK"
  echo "region: $REGION"
  echo "url: \"$URL\""
  echo "saved: $DATE"
  echo "status: draft"
  echo "---"
  echo
  if [ -n "$CLIP" ]; then
    echo "$CLIP"
  else
    echo "<!-- Paste the full job description here. Keep it verbatim: it's the"
    echo "     record of what you were actually asked for, and it's what Claude"
    echo "     reads to tailor the resume. -->"
  fi
} > "$DIR/job.md"

# ---- notes.md --------------------------------------------------------------
cat > "$DIR/notes.md" <<EOF
# $COMPANY — $ROLE

- Applied:
- Source / referral:
- Recruiter:

## Why this one

## Interview log

## Follow-ups
EOF

# ---- tracker ---------------------------------------------------------------
CSV="$ROOT/applications.csv"
if [ ! -f "$CSV" ]; then
  echo 'date,company,role,track,region,status,url,folder' > "$CSV"
fi
q() { printf '"%s"' "$(printf '%s' "$1" | sed 's/"/""/g')"; }
printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
  "$(q "$DATE")" "$(q "$COMPANY")" "$(q "$ROLE")" "$(q "$TRACK")" \
  "$(q "$REGION")" "$(q applied)" "$(q "$URL")" "$(q "applications/$NAME")" >> "$CSV"

# ---- done ------------------------------------------------------------------
printf '\ncreated applications/%s\n' "$NAME"
if [ -n "$CLIP" ]; then
  printf '  job.md  seeded from clipboard (%s chars)\n' "${#CLIP}"
else
  printf '  job.md  empty — paste the posting into it\n'
fi
cat <<EOF

next:
  claude "tailor applications/$NAME/resume.typ to job.md"
  bin/build.sh applications/$NAME
EOF
