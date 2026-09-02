#!/usr/bin/env bash
# Compile resumes to PDF and fail loudly if one spills onto a second page.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v typst >/dev/null 2>&1 || {
  echo "error: typst not found. Install it with:  brew install typst" >&2
  exit 1
}

# Args: specific .typ files or application folders. No args = build everything.
targets=()
if [ $# -eq 0 ]; then
  while IFS= read -r f; do targets+=("$f"); done < <(
    find "$ROOT/applications" -name resume.typ -type f 2>/dev/null | sort
  )
  [ ${#targets[@]} -eq 0 ] && {
    echo "no applications yet — building base templates instead"
    targets=("$ROOT/templates/base-swe.typ" "$ROOT/templates/base-csa.typ")
  }
else
  for a in "$@"; do
    if [ -d "$a" ]; then targets+=("$a/resume.typ"); else targets+=("$a"); fi
  done
fi

fail=0
for f in "${targets[@]}"; do
  [ -f "$f" ] || { printf '  MISSING  %s\n' "$f"; fail=1; continue; }
  out="${f%.typ}.pdf"
  rel="${f#"$ROOT"/}"

  if ! typst compile --root "$ROOT" "$f" "$out" 2>/tmp/typst-err.$$; then
    printf '  FAILED   %s\n' "$rel"
    sed 's/^/           /' /tmp/typst-err.$$
    rm -f /tmp/typst-err.$$
    fail=1
    continue
  fi
  rm -f /tmp/typst-err.$$

  # Typst writes an uncompressed page tree, so /Count is greppable.
  pages="$(grep -a -o '/Count [0-9]*' "$out" | head -1 | tr -dc '0-9')"
  if [ "${pages:-1}" -gt 1 ]; then
    printf '  %s PAGES  %s  <- turn down leading/bullet-gap or cut a bullet\n' "$pages" "$rel"
    fail=1
  else
    printf '  ok       %s\n' "${out#"$ROOT"/}"
  fi
done

exit $fail
