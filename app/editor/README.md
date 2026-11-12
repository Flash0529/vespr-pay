# The SDE's editor (app/editor)

The collaborative code editor of the shell. Contract: [docs/EDITOR.md](../../docs/EDITOR.md). Several people and agents edit the same
`Y.Text`; nobody loses a keystroke, everyone converges, every inserted character carries its author.

| File | What |
|---|---|
| `core.js` | Pure ES module, no DOM, no CodeMirror. `createBinding` (local changes in, remote changes out, authorship on every insert, undo of your own changes only), `deltaToChanges`, `changesToText`, `sanitizeInsert` |
| `presence.js` | Pure. `setLocalSelection` / `remoteSelections`: the awareness wire format the VS Code extension and the agents already use |
| `index.js` | The CodeMirror 6 adapter: `createEditor(...)`, languages by file extension |
| `theme.js` | The look: the shell's CSS variables, dark and light, 12 px mono |
| `test/` | Node tests (`smoke.test.js` is in `scripts/test-all.sh`; `core.test.js` is the heavy fuzz, run by hand, minutes) |
| `../editor-demo.html` | Two editors on two in-memory Y.Docs with buttons for the edge cases (no server), or one editor on a real room with `?live=1` |

## Build
`bash scripts/build-editor.sh` bundles `index.js` into **`app/vendor/editor.js`** (one minified ES module, about 660 KB, 238 KB gzipped) with esbuild.
The build-only packages are pinned to exact versions in `package.json` and `package-lock.json` (`npm ci --ignore-scripts`; `node_modules/` is not committed).
Yjs is **not** bundled: the bundle imports nothing, `createEditor` takes the Yjs namespace as `Y`, so only the page's copy of Yjs exists.
The build fails if anything that ends up in the bundle is not MIT, Apache-2.0, BSD or ISC; `bash scripts/build-editor.sh --write` also refreshes the licence
texts in `app/vendor/LICENSES.txt`. `--line-limit=160` keeps the pre-commit secret scan from mistaking long encoded tables for a key.

## API
`createEditor({ parent, Y, ytext, awareness, user: { name, color?, ai?, model? }, file, readOnly?, claims?, describeAuthor? })` returns a handle:
`view, getText(), focus(), destroy(), goToLine(n), setProblems([{ line, message }]), markRecent([{ from, to, kind: 'add'|'del', by }], { fade }), setReadOnly(b), onSelection(cb), onChange(cb)`,
and for tests `insertAt(i, text), deleteRange(a, b), setSelection(a, b)` (they act like typing and stay off the middle of a surrogate pair).
Extras: `isInSync()` (editor text equals the shared text), `undo()`, `redo()`, `remoteCursors()`, `binding`.
`markRecent` marks follow the text as it moves; with `fade` (ms) they fade and clear, without it they stay until `markRecent([])`.

## Behavior worth knowing
- **Authorship.** Every insert is written with `{ by, t }` (agents: `ai, model` too) as Yjs formatting attributes, explicitly, so a person typing beside an agent's text never inherits its attributes.
- **Hover: who wrote this and why.** Hold the pointer over text for 300 ms: author, an `agent` badge, the model, the time (HH:MM from `attrs.t`) and, when the shell passes `describeAuthor(attrs) -> { request?: string }` (it can look up the chat message `attrs.msg` that caused an agent's edit), the request. The same tooltip shows a problem's message on a problem line. It hides on scroll and on any change. The data comes from pure helpers in `core.js`: `spanAt(ytext, index)` (the run one author wrote) and `describeSpan(attrs, resolver, { utc })`.
- **Undo** (`Mod-z`, `Mod-y`, `Mod-Shift-z`) goes through the binding and only touches your own changes. CodeMirror's own history is not installed.
- **Self-heal.** Yjs puts no marker before an insert whose attributes equal the active ones, so when another peer deletes the text your run hangs on, what you typed after it loses its author. After a remote delete the binding re-applies your authorship to your own characters that lost it (`binding.heal()`, automatic after 150 ms; `heal: false` turns the timer off). It only touches items that `applyLocal` created.
- **Lone surrogates** (half an emoji) cannot cross the network (Yjs writes strings as UTF-8): they become U+FFFD in the editor and the shared text alike.
- **Line endings.** Only `\n` ends a line, so a CRLF file stays CRLF (the `\r` shows as a faint control mark) and the editor's length is always the `Y.Text`'s length. Text pasted with CRLF into an LF file is normalized to LF.
- **Soft claims.** While a person edits, `claims.set(file, { by, ai, since })` is written at most every 10 s.
- **Keys.** `Mod-Enter` is left to the shell (it runs the open file). Tab indents; Escape then Tab leaves the editor for keyboard users.
- If the editor and the shared text ever differ, the adapter reloads the shared text in one minimal edit and logs a warning (it should never happen; `isInSync()` is how tests check).

## Not covered
Plain text only (no embeds), no language server, no folding, no minimap. A change that splits a surrogate pair is corrupted by Yjs itself (the helpers and CodeMirror never make one).
