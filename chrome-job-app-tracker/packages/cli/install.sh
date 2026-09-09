#!/usr/bin/env bash
# Compile japp to a standalone binary and link it onto PATH.
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT:-$HOME/.local/bin/japp}"

bun build --compile "$PKG_DIR/src/index.ts" --outfile "$OUT"

# Retire the old per-script symlinks (and the old job-app name); japp replaces them.
for s in add-job build build.sh list status job-app; do rm -f "$HOME/.local/bin/$s"; done

printf 'installed %s\n' "$OUT"
"$OUT" --help | head -n 4
