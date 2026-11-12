#!/bin/bash
# Runs every test (no model key, no Docker needed; needs node 20+, git and python3). Exit code is non-zero if any fail.
set -u
cd "$(dirname "$0")/.."
ROOT=$PWD # the groups below run in this shell (not in a ( ) subshell): a failure inside a subshell never reached `fail` and the script always said ALL TESTS PASSED
fail=0
run() { out=$("$@" 2>&1); code=$?; last=$(echo "$out" | grep -E "passed|FAILED" | tail -1); printf '%-52s %s\n' "$*" "${last:-(no summary, exit $code)}"; [ $code -ne 0 ] && { echo "$out" | tail -8; fail=1; }; }
{ cd extensions/murmio-collab && for t in binding authorship integration replay codemap shortcuts cleanse uibus; do run node test/$t.test.js; done; cd "$ROOT"; }
{ cd agents && for t in llm agent access-agent modes suggest digest runner git claims security keyfallback discover once budget runit codemap skills skillwire attach client fileops-safety file-identity file-store-readers runs packs skillsearch github readers upload demo githubpr abilities tasks manager context steps activity activity-demo activity-client labels hierarchy manager-tree worker delegate subtasks netsim ledger paywall pay-agent; do run node test/$t.test.js; done; cd "$ROOT"; }
{ cd server && for t in auth auth-names access-hooks auth-signup-gate session-endpoint device-binding account-facts connectors signin-next school-sso sponsor discover work lifecycle admission desktop-auth desktop-auth-http device-revoke device-revoke-live auth-wiring auth-site nas snapshot share friends shareclient client-ended personal-chat orgpolicy dm dm-live live policy orgs usage-ledger billing cost-sharing prefs access access-live paypal paypal-sdk pay pay-school ws-frame-errors; do run node test/$t.test.js; done; cd "$ROOT"; }
run node app/test/chat-render.test.mjs
run node app/test/composer.test.mjs
run node app/test/prototype-helpers.test.mjs
run node app/test/artifact-preview.test.mjs
run node app/test/code-surface.test.mjs
run node app/test/editor-flow.test.mjs
run node app/test/coedit-shell.test.mjs
run node app/test/version-index.test.mjs
run node app/test/history-kind-regression.test.mjs
run node app/test/workspace-modes.test.mjs
run node app/test/workspace-files.test.mjs
run node app/test/access-panel.test.mjs
run node app/test/pay-card.test.mjs
run node app/test/pay-ledger.test.mjs
run node app/test/hide-model.test.mjs
run node app/test/connectors-panel.test.mjs
run node app/test/live-author-render.test.mjs
run node app/test/template-escape.test.mjs
run node app/test/context-capture.test.mjs
run node app/test/return-target.test.mjs
run node app/test/presets.test.mjs
run node app/test/follow.test.mjs
run node app/test/shortcuts.test.mjs
run node app/test/filetree.test.mjs
run node app/test/files-click-routing.test.mjs
run node app/test/workspace-destination-routing.test.mjs
run node app/test/hosting-truthfulness.test.mjs
run node app/test/pathops.test.mjs
run node app/test/fuzzy.test.mjs
run node app/test/navlog.test.mjs
run node app/test/agent-colors.test.mjs
run node app/test/pulse.test.mjs
run node app/test/file-access.test.mjs
run node app/test/fetch-header.test.mjs
run node app/test/web-wallpaper.test.mjs
run node app/test/palette-search.test.mjs
run node app/test/renditions.test.mjs
run node app/test/personal-chats.test.mjs
run node app/test/sha256.test.mjs
run node app/test/recents.test.mjs
run node app/test/tabs.test.mjs
run node app/test/problems.test.mjs
run node app/test/langdetect.test.mjs
run node app/test/breadcrumbs.test.mjs
run node app/test/diffs.test.mjs
run node app/test/gitstatus.test.mjs
run node app/test/brackets.test.mjs
run node app/test/commandpalette.test.mjs
run node app/test/contextmenu.test.mjs
run node app/test/cursor.test.mjs
run node app/test/editorhistory.test.mjs
run node app/test/highlight.test.mjs
run node app/test/minimap.test.mjs
run node app/test/search.test.mjs
run node app/test/splitlayout.test.mjs
run node app/test/statusbar.test.mjs
run node app/test/termoutput.test.mjs
run node app/test/treeview.test.mjs
run node --test app/test/navigation-model.test.mjs
run node --test app/test/account-devices.test.mjs
run node --test app/test/user-settings.test.mjs
run node --test app/test/image-indexer.test.mjs
run node --test app/test/integrated-filesystem.test.mjs
run node --test app/test/model-providers.test.mjs
run node agents/test/git-tug-of-war.test.js
{ cd desktop && run node --test test/open.test.js test/runner-parity.test.js test/security.test.js test/appearance.test.js; cd "$ROOT"; }
run node --test runner/test/sandbox.test.js runner/test/wire.test.js runner/test/native-linux.test.js
{ cd app/editor && run node test/smoke.test.js; cd "$ROOT"; }
{ cd app/editor && FUZZ_SEEDS=40 run node test/core.test.js; cd "$ROOT"; } # the full 400-seed fuzzers take minutes: node app/editor/test/core.test.js
run node scripts/test-explorer-browser.mjs
run bash scripts/test-check-secrets.sh
run bash scripts/test-demo-stack-env.sh
[ $fail -eq 0 ] && echo "ALL TESTS PASSED" || echo "SOME TESTS FAILED"
exit $fail
