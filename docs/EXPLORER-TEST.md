# Explorer, Command Palette, and Follow Mode Browser Suite

End-to-end headless browser verification of the file explorer, fuzzy command palette, recent files tracking, and live agent follow mode in the VESPR SDE shell (`app/prototype.html`).

## Overview

`scripts/test-explorer-browser.mjs` exercises the live application in headless Chromium driven over the Chrome DevTools Protocol (`tools/cdp-shot.mjs`). It connects to a local collaborative server (`scripts/demo-stack.sh`) using a throwaway token and verified WebSocket provider.

If the demo stack is not running, the test automatically spins up a local instance, executes all checks, and tears it down upon completion. The entire test suite completes in approximately 9 seconds.

## Tested Features

1. **New File Creation:**
   * Triggers the explorer toolbar `New file` action (`[data-treeact="new-file"]`).
   * Verifies inline name editor `#treeEdit` mounts and captures input events.
   * Commits the edit and confirms the file is added to `liveClient.files`, marked active in `state.activeFile`, and rendered as an interactive DOM item in `.tree`.

2. **New Folder Creation:**
   * Triggers `New folder` action (`[data-treeact="new-folder"]`).
   * Validates folder creation with hidden `.keep` markers per filetree specifications.
   * Confirms `.row.dir` renders with directory icons and chevron toggles.

3. **Path Rename:**
   * Initiates rename (`treeAction('rename')`) on an existing file node.
   * Validates pathops move planning: the old path is unlinked, the new path is bound to the document store, open tabs/editor state are redirected, and DOM labels refresh.

4. **Delete with Confirmation:**
   * Triggers deletion on a target path.
   * Verifies the inline confirmation safeguard (`.row.confirm`) displays the target name, file count warning, and explicit `Delete` / `Keep` buttons.
   * Confirms `delete-yes` deletes the path from the live document and removes the row from the DOM.

5. **Command Palette & Fuzzy Ranking:**
   * Opens the palette modal (`pal(true)`).
   * Queries with spaced/abbreviated characters (e.g. `c p`).
   * Verifies fuzzy matching (`app/fuzzy.js`) ranks `cart.py` first and wraps matched character ranges in `<mark>` highlights.

6. **Recent Files:**
   * Opens multiple files via `touchFile()` to populate `app/recents.js`.
   * Confirms an empty query in the command palette orders recently opened files first in LRU order.

7. **Live Follow Mode:**
   * Verifies initial follow state and status label (`Following the agent`).
   * Simulates an agent edit via `followEdit({ ai: true, file, at, by })` and validates the editor view automatically follows the agent's active file.
   * Simulates user intervention (scroll/click) and confirms following pauses (`Paused · resume`).
   * Tests `FOL.resume()` restores active following.

## Running the Suite

Run standalone against an ephemeral demo stack:
```bash
node scripts/test-explorer-browser.mjs
```

Or run against an existing demo stack:
```bash
VESPR_DEMO_DIR=$HOME/.cache/vespr-ctx-demo VESPR_DEMO_PORT=9560 node scripts/test-explorer-browser.mjs
```
