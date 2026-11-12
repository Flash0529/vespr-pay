#!/bin/bash
# Build the VESPR desktop app for macOS (Apple Silicon) on a Mac. Run from the repo: bash desktop/tools/build-mac.sh
# Needs: macOS, Node 20+ (brew install node), git. Makes desktop/dist/VESPR-<version>-arm64.dmg and .zip, pointed at https://vespr.online
# (desktop/defaults.json). The app is not signed yet (no Apple Developer account): the first time, right-click VESPR.app > Open,
# or run: xattr -dr com.apple.quarantine /Applications/VESPR.app
set -eu
cd "$(dirname "$0")/.."
[ "$(uname)" = Darwin ] || { echo "run this on a Mac (macOS apps can only be built on macOS)"; exit 1; }
command -v node >/dev/null || { echo "install Node 20+ first: brew install node"; exit 1; }
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || { echo "Node 20 or newer is needed (node -v)"; exit 1; }
echo "site the app opens: $(cat defaults.json)"
npm ci --no-audit --no-fund
npm run dist:mac
echo; ls -lh dist/*.dmg dist/*.zip 2>/dev/null
shasum -a 256 dist/*.dmg dist/*.zip 2>/dev/null
echo "Open dist/*.dmg, drag VESPR to Applications, right-click > Open the first time (unsigned)."
