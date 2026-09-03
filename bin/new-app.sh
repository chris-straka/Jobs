#!/usr/bin/env bash
# Scaffold one job application: dated folder, tailored resume copy, saved JD.
# The job description is required — an application folder without the posting
# is useless, so this refuses to create one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bin/new-app.sh <job-url> [-c company] [-R role] [-t swe|csa] [-r us|ca|uk]
                                [-d file|-]

Creates applications/YYYY-MM-DD_company_role/ containing:
  job.md      the posting, verbatim
  resume.typ  wired to your track and region; everything else defaults
  notes.md    recruiter, referral, interview log
...and appends a row to applications.csv.

Anything not passed as a flag is prompted for. Company is guessed from the URL.
The description is read last: paste it and press Ctrl-D (or use -d).

  us is the CSA track (TN visa). csa defaults to region us, swe to ca.

Examples:
  bin/new-app.sh https://job-boards.greenhouse.io/intersystems/jobs/7827897003
  bin/new-app.sh https://job/123 -c Leidos -R "Systems Analyst" -t csa
  pbpaste | bin/new-app.sh https://job/123 -c Stripe -R "Backend Eng" -t swe -d -
EOF
}

[ $# -ge 1 ] || { usage; exit 1; }
case "$1" in -h|--help) usage; exit 0 ;; -*) die "first argument must be the job URL" ;; esac
URL="$1"; shift

COMPANY=""; ROLE=""; TRACK=""; REGION=""; DESC_FILE=""
while getopts ":c:R:t:r:d:h" opt; do
  case "$opt" in
    c) COMPANY="$OPTARG" ;;
    R) ROLE="$OPTARG" ;;
    t) TRACK="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    d) DESC_FILE="$OPTARG" ;;
    h) usage; exit 0 ;;
    :) die "-$OPTARG needs a value" ;;
    \?) die "unknown flag -$OPTARG" ;;
  esac
done

slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

# ---- guess the company from the URL -----------------------------------------
# Different ATSes hide the company in different places, and aggregators don't
# carry it at all — better to prompt with a blank than to seed a wrong name.
infer_company() {
  local url="$1" host rest path
  rest="${url#*://}"
  host="$(printf '%s' "${rest%%/*}" | tr '[:upper:]' '[:lower:]')"
  host="${host%%:*}"
  path=""; [ "$rest" != "${rest%%/*}" ] && path="${rest#*/}"
  path="${path%%\?*}"

  local generic='^(jobs?|job-boards|boards|careers?|apply|application|openings?|listings?|positions?|search|embed|view|www|en-us|en|us|o|p|d|v|j|companies)$'

  # first path segment that isn't filler, a job id, or a uuid
  first_path_seg() {
    local seg
    for seg in $(printf '%s' "$path" | tr '/' ' '); do
      seg="$(slug "$seg")"
      [ -z "$seg" ] && continue
      printf '%s' "$seg" | grep -Eqi "$generic" && continue
      printf '%s' "$seg" | grep -Eq '^[0-9]+$' && continue
      printf '%s' "$seg" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}' && continue
      printf '%s' "$seg"; return
    done
  }

  # leftmost host label that isn't filler  (acme.wd1.myworkdayjobs.com -> acme)
  first_host_label() {
    local seg
    for seg in $(printf '%s' "$host" | tr '.' ' '); do
      seg="$(slug "$seg")"
      printf '%s' "$seg" | grep -Eqi "$generic" && continue
      printf '%s' "$seg"; return
    done
  }

  # the registrable name  (careers.acme.co.uk -> acme)
  domain_name() {
    local seg out=""
    for seg in $(printf '%s' "$host" | tr '.' ' '); do
      printf '%s' "$seg" | grep -Eqi '^(com|io|co|net|org|ai|dev|inc|xyz|[a-z]{2})$' && continue
      out="$seg"
    done
    slug "$out"
  }

  case "$host" in
    # company lives in the path: /<company>/jobs/<id>
    *greenhouse.io|*lever.co|*ashbyhq.com|*workable.com|*smartrecruiters.com|*jobvite.com|*pinpointhq.com)
      first_path_seg ;;
    # company lives in the hostname: <company>.<ats>.com
    *myworkdayjobs.com|*breezy.hr|*recruitee.com|*teamtailor.com|*applytojob.com|*bamboohr.com|*icims.com|*paylocity.com)
      first_host_label ;;
    # aggregators carry no company in the URL — don't guess
    *linkedin.com|*indeed.*|*glassdoor.*|*ziprecruiter.*|*dice.com|*monster.*|*wellfound.com|*builtin.com|*otta.com|*simplyhired.*)
      : ;;
    # company careers site
    *) domain_name ;;
  esac
}

# ---- prompting ---------------------------------------------------------------
# /dev/tty can exist and still fail to open (cron, CI, some sandboxes), so
# test the open itself rather than the file's permission bits.
tty_ok() { { true < /dev/tty; } 2>/dev/null && { true > /dev/tty; } 2>/dev/null; }

ask() { # ask <prompt> <default>
  local prompt="$1" default="${2:-}" reply=""
  if ! tty_ok; then
    [ -n "$default" ] || die "no terminal to prompt on — pass $prompt as a flag"
    printf '%s' "$default"; return
  fi
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default" > /dev/tty
  else printf '%s: ' "$prompt" > /dev/tty; fi
  IFS= read -r reply < /dev/tty || reply=""
  reply="${reply:-$default}"
  [ -n "$reply" ] || die "$prompt is required"
  printf '%s' "$reply"
}

[ -n "$COMPANY" ] || COMPANY="$(ask "Company" "$(infer_company "$URL")")"
[ -n "$ROLE" ]    || ROLE="$(ask "Role title" "")"
[ -n "$TRACK" ]   || TRACK="$(ask "Track (swe|csa)" "csa")"

case "$TRACK" in
  swe|csa) ;;
  *) die "track must be 'swe' or 'csa' (got '$TRACK')" ;;
esac

# Default region by track: CSA is the US/TN track, SWE defaults to Canada.
if [ -z "$REGION" ]; then
  case "$TRACK" in csa) REGION=us ;; swe) REGION=ca ;; esac
  REGION="$(ask "Region (us|ca|uk)" "$REGION")"
fi
case "$REGION" in
  us|ca|uk) ;;
  *) die "region must be us, ca or uk (got '$REGION')" ;;
esac

# ---- the job description, read last -----------------------------------------
read_description() {
  if [ "$DESC_FILE" = "-" ]; then cat; return; fi
  if [ -n "$DESC_FILE" ]; then
    [ -f "$DESC_FILE" ] || die "no such file: $DESC_FILE"
    cat "$DESC_FILE"; return
  fi
  if [ ! -t 0 ]; then cat; return; fi        # piped in
  tty_ok || die "no terminal to paste into — use -d <file> or pipe the description"
  cat > /dev/tty <<'EOF'

Paste the full job description, then press Ctrl-D on a blank line.
Keep it verbatim: it's the record of what you were asked for, and it's what
the agent reads to tailor the resume.

EOF
  cat < /dev/tty
}

DESC="$(read_description)"
[ -n "${DESC//[[:space:]]/}" ] || die "job description was empty — nothing saved"

# ---- create ------------------------------------------------------------------
DATE="$(date +%F)"
NAME="${DATE}_$(slug "$COMPANY")_$(slug "$ROLE")"
DIR="$ROOT/applications/$NAME"

[ -e "$DIR" ] && die "already exists: applications/$NAME"
mkdir -p "$DIR"

cat > "$DIR/resume.typ" <<EOF
#import "../../templates/lib.typ": resume

#resume(
  track: "$TRACK",
  region: "$REGION",
)
EOF

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
  printf '%s\n' "$DESC"
} > "$DIR/job.md"

cat > "$DIR/notes.md" <<EOF
# $COMPANY — $ROLE

- Applied:
- Source / referral:
- Recruiter:

## Why this one

## Interview log

## Follow-ups
EOF

CSV="$ROOT/applications.csv"
if [ ! -f "$CSV" ]; then
  echo 'date,company,role,track,region,status,url,folder' > "$CSV"
fi
q() { printf '"%s"' "$(printf '%s' "$1" | sed 's/"/""/g')"; }
printf '%s,%s,%s,%s,%s,%s,%s,%s\n' \
  "$(q "$DATE")" "$(q "$COMPANY")" "$(q "$ROLE")" "$(q "$TRACK")" \
  "$(q "$REGION")" "$(q applied)" "$(q "$URL")" "$(q "applications/$NAME")" >> "$CSV"

printf '\ncreated applications/%s\n' "$NAME"
printf '  job.md  %s chars\n' "${#DESC}"
cat <<EOF

next — tailor it with whichever agent you're in:
  claude "tailor applications/$NAME/resume.typ to job.md"
  codex  "tailor applications/$NAME/resume.typ to job.md"
then:
  bin/build.sh applications/$NAME
EOF
