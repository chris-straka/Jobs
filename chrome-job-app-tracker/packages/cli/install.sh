#!/usr/bin/env bash
# Compile ja to a standalone binary and link it onto PATH.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HOME/.local/bin/ja}"

bun build --compile "$PKG_DIR/src/index.ts" --outfile "$OUT"

# Retire the old per-script symlinks (and the old job-app/japp names); ja replaces them.
for s in add-job build build.sh list status job-app japp; do rm -f "$HOME/.local/bin/$s"; done

printf 'installed %s\n' "$OUT"
"$OUT" --help | head -n 4
