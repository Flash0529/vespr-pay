# The SDE's own editor

Decision (2026-10-28): the SDE view gets its own collaborative code editor, built into the app shell. VS Code stays only as an optional pill ("VS Code") for people who want it. Why: the shell's editor was read-only, the VS Code build shows a trust dialog and "Restricted Mode" to every new visitor, and a second editor is not what an SDE is. Everything underneath is unchanged: the same shared document (a `Y.Text` per file in the `files` map), the same server, the same agents, the same authorship.

## What it must do
- Edit files in a live room: many people and agents at once, nobody loses a keystroke, everyone converges.
- **Authorship on every insert**, exactly as the VS Code extension and the agents write it: Yjs formatting attributes `{ by: <name>, t: <minutes since epoch> }` for a person (agents add `ai: true, model, msg`). `t` is `Math.floor(Date.now() / 60000)`. Without these, a person typing next to agent text would inherit the agent's attributes, so the binding sets them explicitly on every insert.
- **Named cursors and selections** for everyone in the same file, from the shared awareness. The existing wire format (written by the extension and agents, read by the shell): awareness field `cursor = { file: <path>, anchor: <Y.RelativePosition JSON>, head: <Y.RelativePosition JSON> }`, and `user = { name, color, isAgent, model }`.
- **Undo and redo only for your own changes** (a `Y.UndoManager` that tracks the binding's origin), never someone else's.
- **Soft claims:** while a person edits a file write `claims.set(<path>, { by: name, ai: false, since: Date.now() })` at most every ~10 s (people's claims expire after 60 s), as the extension does.
- Syntax colours for Python, JavaScript/TypeScript, HTML, CSS, JSON, Markdown, YAML, shell; line numbers; small type (11-12 px mono); dark and light through the shell's CSS variables (`--bg --surface --text --muted --faint --hair --agent --ok --bad`), no heavy effects.
- Marks from outside: error lines (from Python run problems), the lines an agent just changed (red/green), "go to line", a read-only mode.
- Small and fast: the vendored bundle stays under about 700 KB minified; typing never waits for the network.

## Layout and API (the contract: tests and the shell are written against it)
```
app/editor/core.js        pure ES module, NO DOM and NO CodeMirror: the Yjs side
app/editor/presence.js    pure: awareness <-> selections (the wire format above)
app/editor/index.js       the CodeMirror 6 adapter (needs the DOM): createEditor(...)
app/editor/package.json   build-only dependencies (CodeMirror 6, esbuild), exact versions + lockfile
scripts/build-editor.sh   esbuild -> app/vendor/editor.js (ESM, minified, one file)
app/editor-demo.html      two editors on one page for the browser tests; also takes ?live=1&server=&room=&name=#token=
app/editor/test/*.test.js node tests (registered in scripts/test-all.sh)
```
### core.js
```js
import * as Y from 'yjs'            // the same Yjs the app uses (injected by the caller in tests via `Y`)
export function createBinding({ Y, ytext, user, origin })
//   user   = { name, ai = false, model = '' }      origin = any object, default a fresh Symbol
// returns:
//   binding.origin
//   binding.applyLocal(changes)    // changes: [{ from, to, insert }] in the coordinates of the text BEFORE the change,
//                                  // sorted, non-overlapping (what CodeMirror's ChangeSet gives). One Y transaction with
//                                  // `origin`: for each change delete [from,to) then insert at from with attributes
//                                  // { by: user.name, t } (+ ai/model for agents). Apply from the END to the start.
//   binding.onRemote(cb)           // cb(changes) for every transaction on ytext whose origin !== binding.origin, with
//                                  // changes in the coordinates of the editor text BEFORE that remote change (same shape).
//   binding.text()                 // ytext.toString()
//   binding.undo() / redo() / canUndo() / canRedo()   // Y.UndoManager tracking only binding.origin; capture timeout ~500 ms
//   binding.destroy()
export function deltaToChanges(delta)       // a Y.Text delta -> [{ from, to, insert }] (retain/insert/delete)
export function changesToText(text, changes) // apply changes to a plain string (for tests and the fake editor)
```
### presence.js
```js
export function setLocalSelection({ Y, awareness, ytext, file, anchor, head })   // anchor/head are indexes; writes cursor = { file, anchor: relpos JSON, head: relpos JSON } or null
export function remoteSelections({ Y, awareness, ytext, file })                   // -> [{ clientId, name, color, isAgent, anchor, head }] absolute indexes, only people in the same file, never yourself
```
### index.js (bundled as app/vendor/editor.js, loaded by the shell with a dynamic import)
```js
export function createEditor({ parent, Y, ytext, awareness, user, file, readOnly = false, claims })   // -> handle
// handle: { view, getText(), focus(), destroy(),
//           goToLine(n), setProblems([{ line, message }]), markRecent([{ from, to, kind: 'add'|'del', by }]), setReadOnly(b),
//           insertAt(index, text), deleteRange(from, to), setSelection(anchor, head)   // for tests: act like typing
//           onSelection(cb), onChange(cb) }
```

## Tests (all of them must exist before the shell switches over)
1. **Node, no browser:** `core.test.js` with a fake editor (a plain string kept in sync through `deltaToChanges` / `changesToText`): random edits from 2 to 4 peers, updates exchanged in random order and with random delay (`Y.applyUpdate`), then everyone (the Y.Text and every fake editor) is identical; authorship: every inserted character carries its author; undo only removes your own; a changeset with several changes; empty inserts; unicode (emoji, CJK, combining marks: Yjs counts UTF-16 units, so does CodeMirror, and so must the binding); a very large paste; deleting a range someone else is typing in; the exact same position at the same instant (the order is the same everywhere); offline edits merged after reconnect.
2. **Browser, real DOM:** `scripts/test-editor-browser.mjs` drives headless Chromium (`tools/cdp-shot.mjs` style, CDP): two pages on `editor-demo.html` against a real local collab server (`scripts/demo-stack.sh`), typing with real key events: the same cases, plus cursor labels visible, IME-free typing bursts, undo scope, and a server restart while both type.
3. **The product path:** the same scenarios on the shell's SDE view once it uses the editor.

## Not in scope here
Per-file read limits (see docs/PRODUCT plan: one shared document cannot hide a file), refactoring tools, a language server, a minimap, debugging. Plain text files only.
