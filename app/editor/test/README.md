# Editor tests: two or more people typing at the same moment

The contract is `docs/EDITOR.md`. Two suites prove it, one without a browser and one with real keys in real browser pages.

```bash
node app/editor/test/core.test.js                     # Node only: core.js + presence.js with a fake editor, about 5 minutes on a busy Pi
node app/editor/test/core.test.js --only undo         # tests whose name contains "undo"
node app/editor/test/core.test.js --list              # all test names
FUZZ_SEEDS=2000 node app/editor/test/core.test.js --only fuzz     # more random seeds (default 400 per fuzz test)
node app/editor/test/core.test.js --only "fuzz: 2 to 4" --seed 17 # replay ONE seed and print its steps

node scripts/test-editor-browser.mjs                  # real Chromium, two windows, a real collab server (needs `chromium`, about 3 minutes)
node scripts/test-editor-browser.mjs --only unicode   # one scenario
node scripts/test-editor-browser.mjs --burst 10 --shots /some/dir   # 10 second typing bursts, keep the screenshots there
```

`core.test.js` is registered in `scripts/test-all.sh` in a quick mode (`FUZZ_SEEDS=40`; the full 400-seed run above takes minutes). The browser suite is not (it starts Chromium; run it by hand before a release).
`EDITOR_DIR=/path/to/copy` makes the Node suite test another copy of `core.js` / `presence.js` (that is how the mutation checks below were done).

## Node suite (`core.test.js`, `harness.js`, `fuzz.js`)

A fake editor is a plain string. It changes only through `changesToText` (typing, remote changes) and `binding.applyLocal` / `binding.onRemote`, exactly as the CodeMirror adapter does. Peers have fixed client ids and exchange Yjs updates through a fake network that can hold them back, shuffle them and deliver them twice. After every step the fake editor must equal its `Y.Text` (this alone checks that `onRemote` reports changes in pre-change coordinates, because each reported change is replayed on the old editor text); at the end every `Y.Text`, every editor, every state vector and every attribute run must be identical, and a brand-new peer reading the full state must see the same text.

| What | Why it matters |
|---|---|
| `changesToText`, `deltaToChanges` against plain-string references and against 800 random Y.Text transactions (several ops, formatting, inserts into fresh inserts) | the two helpers every other test leans on are right; attribute-only changes produce no text change |
| empty insert / empty delete / `[]` | no Y transaction, no update, no undo step, nothing sent to others |
| a changeset with several changes | one transaction, one update, one `onRemote` call on the other side, one undo step; touching changes and two inserts at one index keep their order |
| UTF-16 positions (emoji, CJK, ZWJ family, combining marks, typed one code point at a time, deleted exactly) | nothing split, nothing replaced by U+FFFD |
| the same index at the same instant, 2/3/4 people, every delivery order (up to 300 per size) | one result on every peer; each person's insert stays whole and keeps its author |
| 12-key bursts typed at one spot by 2 to 3 people | the bursts never interleave |
| delete a range while someone types inside it; overlapping deletes; delete-all against an insert; replace against replace | the typed text survives, the union of the deletions is gone, nothing else |
| offline edits on 2 peers (+ one online) merged after reconnect, on the same line on purpose | everything each person typed survives, in each person's own order |
| 1 MB paste with a concurrent edit inside it; 1,000 tiny edits equal to a plain-string model; 2 x 1,000 concurrent | size and speed (timings are printed) |
| authorship: `{ by, t }` on every insert, agent `{ ai, model }`, a person next to / inside / concurrently with agent text does not inherit, delete-and-retype changes the author, `t` follows the clock | the attribution the product promises |
| undo/redo: only your own changes, even with the other person typing between, inside your text, or at the same place; redo after a remote change; new typing clears redo; one changeset = one step; the 500 ms capture window (one real-time test); undo never touches an agent's edits; two panes on one text | the Y.UndoManager is wired to the binding's origin only |
| presence: wire format (JSON-safe, readable the way the VS Code extension reads it and written the way it writes it), only others in the same file and never you, selections follow their characters, cursor null on file switch / no file / no position, garbage and foreign cursors ignored | named cursors |
| five fuzzers (seeded, 400 seeds each): inserts only with strict authorship; mixed edits with late/shuffled/duplicated updates; the same with undo and redo mixed in; the same with emoji, CJK, ZWJ, combining marks; one writer at a time against a plain-string model | a failing seed is **shrunk** to a short list of steps, printed with the seed and the replay command |

## Browser suite (`scripts/test-editor-browser.mjs`)

It starts its own collab server (`server/index.js`, private temp folder, made-up random tokens, 127.0.0.1 only; it does not use `scripts/demo-stack.sh` because it must kill and restart the server by PID), a tiny static server for `app/`, and one headless Chromium with two windows (Alex and Sam, 1100x700, no GPU) on `app/editor-demo.html` in live mode. Input is real: `Input.dispatchKeyEvent` for keys and Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, `Input.insertText` for emoji and CJK, a real `paste` event. Both pages start behind a barrier (the same tick, after a warm-up key press), and the skew between the first input event on the two pages is measured in the pages and printed. After every scenario the text of both pages is compared with a **fresh third client** (`app/vespr-client.js`) reading the room, and any difference fails loudly with the first differing index. Uncaught errors in the pages fail the scenario.

Scenarios: the same position at the same instant (rounds until the typing really overlapped 3 times); delete a range while the other types inside it; overlapping deletes; delete-all against typing; authorship after a concurrent delete (Sam deletes the start of Alex's run while Alex keeps typing: Alex's new text gets Alex back as its author, through the adapter's real heal timer); unicode (emoji, CJK, ZWJ family, combining marks, Backspace over an emoji); type bursts on one line for 3 seconds (every keystroke accounted for, each person's keys in order, authors right); cursor labels and selection read from the DOM (never your own, move with the caret, vanish on file switch); undo scope; a 200-line paste while the other types, then undo; offline edits (both pages disconnect, type on the same line, one deletes, reconnect); the server killed with SIGKILL and restarted while both keep typing (no keystroke lost); a late joiner; screenshots of both pages, dark and light.

## Known limits (honest list)

1. **Authorship can be lost when another person deletes the text a run hangs on (a Yjs property); the binding heals most of it.** Yjs writes no format markers for an insert whose attributes equal the ones already active, so a keystroke typed right after your own earlier text relies on that text's markers. If a peer who has seen the earlier text deletes or replaces it at the same time, Yjs removes the shared markers and your newer text shows another author or none. Plain Yjs reproduces it without the binding. Found by these tests on 2026-10-29; editor-core added `binding.heal()` (it also runs by itself 150 ms after a remote delete) which re-applies `{ by, t }` to the binding's own characters. Tested strictly: the three canonical scenes (Alex keeps typing while Sam deletes the end of Alex's run, deletes its first half, or replaces the whole file) keep their author after healing, by hand (`world.settle()`) and by the real timer. Inserts only (no deletes): exact, strict, 400 seeds. **Still open in heavy random sessions** (mixed edits, late and shuffled updates, counted and printed by the fuzzers, `FUZZ_STRICT=1` makes them fail): a character whose `by` is right but whose `t` fell back to another minute (heal compares `by` only), text of the start file that ends up with a healer's attributes (concurrent heals on adjacent runs), and text of an agent process that heal cannot know about. The text itself is never lost and all peers always agree on the attributes.
2. **Lone surrogates** do not replicate exactly (lib0 writes strings as UTF-8: the sender would keep `\uD83D`, everyone else reads U+FFFD), also when the two halves of an emoji arrive as separate changes of one changeset. `core.sanitizeInsert(text)` turns them into U+FFFD; `applyLocal` applies it, and **the adapter must apply it to the editor too** so editor and shared text agree (the test simulates that adapter step; it fails if the helper is missing).
3. **Half a surrogate pair** (a change whose edge falls between the two halves) is turned into U+FFFD by Yjs itself, in every peer. `core.js` documents that the adapter must not cut pairs; the test only checks that nothing throws and the peers agree.
4. The Node suite delivers updates in any order and twice, which is harsher than the real server (it relays each sender's updates in order). The fuzzers can be run in the realistic orders with `FUZZ_ORDER=fifo` (each sender in order) or `FUZZ_ORDER=causal` (everything in the order it was made).
5. Awareness in the Node suite is a small fake of the y-protocols API (`clientID`, `getStates`, `setLocalStateField`), because the vendored bundle has no `Awareness` class; the browser suite uses the real one.
6. The browser suite does not cover IME composition, mouse selection, the context menu, Firefox or Safari, or the shell's SDE view (stage 3 of docs/EDITOR.md). Selections are placed through the editor handle (`setSelection`), edits come from real key events. The paste is a synthetic `ClipboardEvent` (headless Chromium has no clipboard to paste from).
7. Timing is honest, not tight: on a busy Pi (load average above 20 while this was written) the two pages start a few to a few tens of milliseconds apart. The harness fails a scenario only if the skew passes 200 ms, because then "at the same time" would mean nothing.
8. The undo tests use `binding.stopCapturing()` (an editor-core extra) to separate steps, plus one test with real waiting for the 500 ms capture window.

## Mutation check (`mutants.mjs`)

`node app/editor/test/mutants.mjs` breaks a copy of `core.js` / `presence.js` on purpose, one way at a time (changes applied from the start instead of the end; no authorship attributes; undo tracking every origin; `onRemote` reporting your own changes; positions after the change instead of before; every keystroke its own undo step; `t` in seconds; a delete one character short; lone surrogates not cleaned; the binding never healing by itself; `heal()` doing nothing; `remoteSelections` including yourself or ignoring the file; `setLocalSelection` keeping a cursor without a position), runs the Node suite against the copy (`EDITOR_DIR`, 40 fuzz seeds) and requires a test that passes on the real code to fail. A mutant nobody catches fails the script. Run it after changing the suite or `core.js`; it takes about 10 minutes on a busy Pi.
