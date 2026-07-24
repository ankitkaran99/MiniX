#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist

# Concatenate all mx modules into dist/MiniX.js in exact dependency order
cat \
  src/mx/State.js \
  src/mx/Utils.js \
  src/mx/Renderer.js \
  src/mx/EventBus.js \
  src/mx/Sanitizer.js \
  src/mx/Provider.js \
  src/mx/Plugin.js \
  src/mx/Listener.js \
  src/mx/Signal.js \
  src/mx/Effect.js \
  src/mx/Compiler.js \
  src/mx/Component.js \
  src/mx/App.js \
  src/mx/Request.js \
  src/mx/Exports.js \
  > dist/MiniX.js

# Minify dist/MiniX.js to dist/MiniX.min.js
npx terser dist/MiniX.js --compress --mangle --output dist/MiniX.min.js

# Process top-level .js files in src (excluding subdirectories like src/mx)
find src -maxdepth 1 -type f -name '*.js' -print0 | while IFS= read -r -d '' file; do
  out="dist/$(basename "$file")"
  out="${out%.js}.min.js"
  npx terser "$file" --compress --mangle --output "$out"
done


