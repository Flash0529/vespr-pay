# vespr-client.js: the shell's bridge to the collab server (Phase 1)

`vespr-client.js` joins a room as an ordinary Yjs peer (the same shared document the SDE extension and the agents use) and turns it into plain objects the app shell draws.
No framework and no build step. Yjs, y-websocket and a WebSocket class are passed in (`deps`), so the same file runs in a browser (import map or bundle) and in Node tests.

```js
import * as Y from 'yjs'; import { WebsocketProvider } from 'y-websocket'
import { createClient } from './vespr-client.js'
const c = createClient({ server: 'ws://127.0.0.1:9401', room: 'demo', token, name: 'shamit', deps: { Y, WebsocketProvider, WebSocketPolyfill: WebSocket } })
await c.ready
c.on('change', what => render(c.get()))        // 'chat' | 'files' | 'presence' | 'settings' | 'usage' | 'status' (batched per tick)
c.on('edit', e => showDiff(e))                 // { file, at, removed, added, line, by, ai, model, msg, created? }  -> the red/green lines
c.send('@coder explain this', { thread: 'fix-discount', quote: { src: 'cart.py · line 8', text, by: 'coder' }, attachments: [{ name, size, type }] })
c.decide(approvalId, true)                     // first answer wins; later ones return false
const meta = await c.upload(file)               // a File/Blob, or { name, type, bytes }; then c.send('see this', { attachments: [meta] })
c.command({ type: 'open', file: 'cart.py', line: 8 })  // tell YOUR SDE what to show: open | follow (an agent) | unfollow
c.setMode('plan'); c.setRunner(id, label); c.setPresence({ file: 'cart.py' })
await c.runners()                              // machines connected to run commands (HTTP, same token)
c.history()                                    // edits, runs, approvals, setting changes: newest first, same shape as the prototype's History
```

`c.get()` returns `{ status, me, people, agents, messages, threads, approvals: { pending, all }, files, claims, mode, runner, usage }`.

## What is new in the shared document
Chat messages (`Y.Map`) may now carry `thread` (a name; absent = `main`), `quote` (`{ src, text, by }`, from select-to-ask) and `attachments` (`[{ name, size, type }]`: metadata only; file bytes need an upload path that does not exist yet).
The VS Code chat panel ignores these fields (it shows every message), so nothing breaks there.

## Tested (agents/test/client.test.js, real server, real agent API)
Presence and agents, a message with thread, quote and attachments reaching the agent, streamed agent text, a created file and a replaced line as `edit` events with removed/added text and the author, approval cards (first answer decides), mode changes reaching the agent, History, runners over HTTP, a wrong token never connecting. A mutation (approval not recording who decided) fails it.

## Not done (be honest about these)
- **Private lanes and role checks:** the whole room is visible to everyone who can connect; History is derived from the shared document with no retention and no manager-only gate. Those need server-side access control.
- **Attachments:** `c.upload(file)` sends the bytes to `/api/upload/<room>` (25 MB per file by default) and returns `{ id, name, size, type, sha256 }` for `send(..., { attachments })`; `c.download(id)` gets them back. The server sends CORS headers on `/api/*` (`Access-Control-Allow-Origin: *` by default; set `MURMIO_CORS_ORIGIN` to one origin, or empty to switch it off), so the shell can call it from another origin; auth is a Bearer token, never a cookie.
- **Static hosting:** the collab server does not serve the shell yet; during development open the shell from a static server or Electron.
- **Editing text from the shell:** the SDE does that; this client only reads files and reports edits.
- **Browser run:** the automated tests (`agents/test/client.test.js`) run in Node only. `app/prototype.html` loads it in a browser through an import map (`./vendor/yjs.js`, `./vendor/y-websocket.js`); that browser path has no automated test here. Elsewhere it needs an import map for `yjs` and `y-websocket` (or a bundle) and the browser's own `WebSocket`.

## Run from the app (Python)
`c.run('file', 'cart.py')` or `c.run('tests')` asks the lead agent to run `python3 cart.py` or `python3 -m unittest discover -v` on the workspace's runner. The request is a small entry in the shared `runs` array (kind and file name only, never a command line); the agent checks the file is a `.py` file in the workspace, runs it, and writes the output back as it arrives, so everyone in the workspace sees the same console. `c.get()` adds `runs` (newest last: `{ id, by, kind, file, cmd, status: requested | running | done | denied, out, code, started, ended, runner, changed }`), `runsEnabled`, and `problems` (`[{ file, line, message, run }]`: the Python errors in the newest finished run, so a run that passes clears them; `parsePyProblems(out, inRoom, cwd)` is exported). `c.history()` includes the runs.
The shell shows it as a Run button (tab bar and panel, Ctrl/Cmd+Enter), the output in the Terminal panel, the errors in Problems with the failing line marked in the editor, and "Ask coder to fix" on a failed run.
**Off unless the operator sets `MURMIO_HUMAN_RUNS=1` on the agent** (`settings.runs` tells the app): a run executes workspace code inside the agent's container, next to its secrets (see `SECRETS.md`, known gaps). On in `deploy/local` and `deploy/video`, off in `deploy/judge`, `deploy/nebius` and `deploy/compose.yml`. A remote runner (a teammate's computer) is refused: those runs need an approval through @coder. Tested in `agents/test/runs.test.js`.

## First-run question: skill packs
`c.get().packsCatalog` lists the fields the agent offers (vibe, web, design, backend, data, docs; **Vibe coding is first**); `c.get().focus` is `null` until someone answers, then the chosen ids. `c.setFocus(['vibe','backend'], { other: 'rust firmware' })` records the answer and asks the agent to set up skills. `other` (optional, "something else" in the person's own words) is cleaned to one line, trimmed and cut at 200 characters, and stored in the `packsRequest` entry; a request with neither ids nor text only records "nothing".
- **Chips (fields):** the bundled skills (`agents/src/pack-skills/`) are copied into `.vespr/skills/` at once; the GitHub ones (UI UX Pro Max, impeccable, taste-skill, **rea**; pinned commits, licenses on the card) are fetched only after the room approves **one** card that lists them. Vibe coding adds `vibe-build-loop`, `debug-loop`, `ship-checklist`, `security-review`, `frontend-review`, plus ui-ux-pro-max and rea. **rea** (`morluto/rea` @ 64196b0, MIT) is instructions for the REA tool server, which VESPR agents cannot call yet, so the card and the chat message say it is reading material, not a working tool. An entry marked `refs` also gets the Markdown files of its `references/` folder (listed and fetched at the pinned commit; 100 KB per file, 400 KB in all; anything skipped is named in the result) written to `.vespr/skills/<name>/references/`, each starting with a comment that names its source and license.
- **Something else:** with text, the agent searches GitHub with **no model** (`agents/src/skillsearch.js`): up to 5 meaningful words (stop words dropped), two repository searches (the `agent-skills` topic with the first three words; all the words plus `skill`), most stars first. A repository is kept only if it is not archived or a fork, has an MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Unlicense or CC0-1.0 license, at least 20 stars, and a push in the last ~18 months. The six that fit the words best are opened: HEAD is pinned to a commit, the git tree at that commit is read, and the `SKILL.md` that fits best (up to 60 KB; test, example, template, vendor and `node_modules` folders skipped) is fetched and parsed. At most **three** go on **one** approval card (name, license, stars, repo@sha7, first sentence, and the line that skills are instructions the agents will follow). Only after approval are they installed, pinned, by the same code as the packs; a name that already exists is never overwritten. If nothing fits, the agent says so in chat, what it looked at and why things were rejected, and suggests pasting a GitHub link. At most one search every 20 seconds per agent (GitHub's rate limit is shared); the agent sets `GITHUB_TOKEN` for the optional higher limit.
- **Result:** `c.get().packs` is `{ id, focus, bundled, present, github, refs, declined, failed, other? }`; `other` is `{ text, status: searching | installed | declined | none | failed | error | no-terms, terms, considered, offered: [{ name, repo, sha, license, stars }], github, declined, failed, error }`. The agent also says it in chat. A request that was already answered is not answered again when the agent restarts. `setFocus([])` with no text only records "nothing".
The shell asks once on first run (after the loading animation) and again from View, Skills for your field: two columns of fields plus a "Something else" text field; **Add skills** is enabled when a field is picked or text is typed, and Skip is always there. An agent without this feature (an older deploy) never publishes `packsCatalog`, so the shell does not ask. Tested in `agents/test/packs.test.js` (real server and agent, fake GitHub) and `agents/test/skillsearch.test.js` (fake GitHub; filters, ranking, one card, pinned calls, declined and failed paths).

## Command bus (shell -> SDE)
`c.command({ type: 'open', file, line? })`, `{ type: 'follow', agent }`, `{ type: 'unfollow' }` write a small entry into the shared document (`ui` array, kept to 50). The SDE extension (`extensions/murmio-collab/lib/uibus.js`) carries it out only if it was written by the **same person** as that SDE, the file exists in the room and is not editor config or git, and the agent is really in the room; it can only open or follow, never run anything. Entries older than 15 s or from before the SDE connected are ignored. Tested in `extensions/murmio-collab/test/uibus.test.js` and `agents/test/client.test.js`.

## Pull requests (GitHub step two)
`c.openPullRequest({ title?, body? })` asks the agent to send the workspace's changes back to the repository it was opened from (`c.get().github`) as a pull request on a **new** branch `vespr/<workspace>-<date>`. It works only when the agent has a token (`c.get().prEnabled`). The agent drafts title and description from the chat and the History, then asks the room with ONE approval card (`kind: 'pr'`: files, branch, title, description); nothing is sent to GitHub before it is approved. Progress is `c.get().pr` (`{ id, status: checking | asking | sending | done | denied | nothing | no-token | no-repo | error, url?, number?, branch?, base?, counts?, left?, stale?, error? }`) and the agent says the result in chat. A request already answered is not repeated when the agent restarts. Details, calls and limits: `docs/GITHUB-INTEGRATION.md` (Step 2). Tested in `agents/test/githubpr.test.js` against a fake GitHub only; never run against the real API. The shell has no UI for it yet.

## Snapshot links (needs `VESPR_SNAPSHOT=1` on the server; otherwise every call fails with `status` 404)
```js
const r = await c.snapshot.create({ file: 'cart.py', days: 14 })   // omit file for the whole project; -> { id, kind, title, url, expires, files, skipped }
r.url                                                           // shown once: the server keeps only a hash of the secret half
await c.snapshot.list()                                            // [{ id, kind, file, title, by, ts, expires, views, files }] (never the address)
await c.snapshot.revoke(r.id)                                      // the link stops working at once and the copy is deleted
```
A link is a read-only copy made at share time (one file, or the project's text files without dotfiles and secret-looking names). See `docs/SNAPSHOTS.md`.

## Context by highlight, copy and paste (2026-11-01)
- Select text in the editor, the conversation, the terminal or the history: the Ask bar attaches it with where it came from. Copy it and paste it into the message box: the box shows a context chip (for example `cart.py · lines 4–9`, or `sam in Fix the discount bug`) instead of bare text. Ctrl or Cmd+Shift+V pastes plain text; text copied from outside the app pastes as usual.
- The message carries `contexts` (up to five): `{ kind, src, file, lines, by, author, thread, ts, text, before, after }`, where `before` and `after` are the lines around a code selection. `c.send(text, { thread, quote, attachments, contexts })` sends them; `quote` stays for older readers. Pure helpers in `app/context-capture.js`, tests in `app/test/context-capture.test.mjs`.
- Agents read them (`agents/src/context.js`): a block of quoted data in their view of the conversation, tag-stripped and length-capped, marked as not an instruction.
