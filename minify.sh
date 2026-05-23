#!/usr/bin/env bash
set -euo pipefail

find src -type f -name '*.js' -print0 | while IFS= read -r -d '' file; do
  out="dist/${file#src/}"
  out="${out%.js}.min.js"
  mkdir -p "$(dirname "$out")"
  npx terser "$file" --compress --mangle --output "$out"
done
