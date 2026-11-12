#!/bin/bash
# Builds the SDE's editor: app/editor/index.js (CodeMirror 6 adapter) -> app/vendor/editor.js, ONE minified ES module.
# Yjs is NOT bundled: the page's import map supplies it, so two copies of Yjs can never exist (core.js takes `Y` from the caller).
# Needs node 20+ and the build-only packages in app/editor/package.json (exact versions, lockfile). Nothing here runs in production:
# the built file is committed like the other vendored files. After a build, `node scripts/editor-licences.mjs <meta> --write` refreshes
# the licence texts of what was bundled in app/vendor/LICENSES.txt (the build fails if anything bundled is not MIT/Apache-2.0/BSD/ISC).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=app/vendor/editor.js
cd app/editor
[ -x node_modules/.bin/esbuild ] || npm ci --ignore-scripts --no-audit --no-fund
META=$(mktemp)
node_modules/.bin/esbuild index.js --bundle --format=esm --minify --line-limit=160 --target=es2022 --legal-comments=none --external:yjs \
  --banner:js='/* VESPR editor (CodeMirror 6 + Lezer, MIT). Built by scripts/build-editor.sh from app/editor; licences: app/vendor/LICENSES.txt */' \
  --metafile="$META" --log-level=warning --outfile="../../$OUT"
cd ../..
node scripts/editor-licences.mjs "$META" ${1:+"$1"}
rm -f "$META"
printf 'built %s: %s bytes (%s bytes gzipped)\n' "$OUT" "$(wc -c < $OUT)" "$(gzip -9 -c $OUT | wc -c)"
