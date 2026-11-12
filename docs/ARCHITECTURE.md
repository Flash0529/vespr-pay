# VESPR architecture (prototype, 2026-10-22)

## Pieces
| Piece | Where | What it does |
|---|---|---|
| **SDE** | `ide/` | Docker image: real VS Code (Code - OSS via openvscode-server) plus the VESPR extension. One container per person for now. |
| **Collaboration extension** | `extensions/murmio-collab/` | Runs inside VS Code. Binds open editors to shared Yjs text, shows other people's and agents' cursors/selections with names, a "who is here" list with follow mode. |
| **Realtime server** | `server/` | Node. One Yjs document per workspace ("room"): `files` (path -> text) and, soon, `chat` and `provenance`. Token-authenticated WebSocket. Persists a snapshot and exports the files to disk. |
| **Agents** | `agents/` | Node worker that joins a room as an ordinary peer (own cursor, own name), calls Nemotron on Nebius Token Factory (OpenAI-compatible, streaming, tool calls) and edits files through the same shared document. Permission modes + approvals (`src/policy.js`), sandbox terminal (`src/runner.js`), demo mode without a key. See `docs/RUNNERS.md`. |
| **Team chat panel** | `extensions/murmio-collab/lib/chatView.js` | Side-bar webview: shared chat, mode selector, Approve / Deny cards. |
| **Code host** (next) | `server/` | Git over HTTP for the exported tree, history and branches. |

## Data model (one Yjs doc per room)
- `files`: Y.Map of relative path -> Y.Text
- awareness (not stored): `{ user: {name, color, isAgent}, cursor: {file, anchor, head} }` with Yjs relative positions, so cursors survive concurrent edits
- `chat`: Y.Array of attributed messages (roles: user, agent, tool, approval), text streamed live
- `settings`: `agentMode` (manual | acceptEdits | auto | plan | bypass), later `runner`
- `provenance`: Y.Array of agent edits (file, who, model, triggering chat message); `handled`: chat message claims
- planned: per-character authorship as Yjs attributes, update log for replay

## Added 2026-10-22 (late)
- **Authorship:** every insert carries Yjs formatting attributes `{ by, t }` (agents also `ai, model, msg`). Hover shows who and why; the lens tints text by author. Survives merges and replay.
- **Session log + replay:** the server appends every document update and presence change to `<data>/<room>/log.bin` (first record is the base state). `GET /api/log/<room>` (Bearer token) returns it; the extension rebuilds any moment (`lib/replay.js`) and draws it in a webview (`lib/replayView.js`).
- **Inline suggestions:** the extension calls `POST /api/suggest` on the realtime server, which authenticates and forwards to the agent worker (`agents/src/suggest.js`, port 8242 inside the network). The worker adds teammate context (recent agent edits, latest chat, who else is in the file) and calls a small Nemotron model; demo mode is scripted.
- **Catch-up digest:** the extension keeps a heartbeat in `seen` (person -> last time here). `@coder catch me up` (or the button, or the welcome-back prompt after 3+ minutes away) makes the agent list what happened since: chat, approvals, commands, mode changes, and who edited which file (from the authorship attributes).

- **Runners:** machines connect out to `/runner`; `GET /api/runners` lists them, `POST /api/run` sends a job and streams the answer. The agent's `RemoteRunner` uses it when `settings.runner` names a connected runner; it never falls back silently. Bypass mode is downgraded to Auto on remote runners. See `docs/RUNNERS.md`.
- **Git hosting:** `server/git.js`. `POST /api/git/<room>/commit` snapshots the workspace (message written from the intent log: who did what and the request behind it); `/git/<room>` serves git smart HTTP (any user name, your token as the password); a push is imported back into the live workspace as edits by the pusher; `GET /api/git/<room>/log` and `/blame`.
- **Claims, token meter, models per role:** `claims` and `usage` maps in the shared document; plan mode uses the planning model (Ultra), everyday chat the main one (Super), inline suggestions the small one (Nano).

## Why Yjs
A CRDT merges simultaneous edits without a central lock, so humans and agents can type in the same file. An agent is just another peer: no special path, which is why it can have a cursor.

## Running with Docker (prototype)
`deploy/compose.yml` starts `collab` and two SDEs. Everything is published on 127.0.0.1 only; use an SSH tunnel.

| Service | Host port | Notes |
|---|---|---|
| collab (realtime server) | 127.0.0.1:9401 | token auth, tokens in a file outside the repo; also `/api/log/<room>` and `/api/suggest` |
| ide-shamit | 127.0.0.1:9410 | needs the SDE token as `?tkn=` |
| a second SDE | 127.0.0.1:9411 | same |
| agent-coder | no port | joins `collab` as a peer; demo mode until `NEBIUS_API_KEY` is set (see `deploy/local`) |

The env file (outside the repo) holds `TOKEN_SHAMIT`, `TOKEN_SHANMUKH`, `IDE_TOKEN_SHAMIT`, `IDE_TOKEN_SHANMUKH`.
Tests: `cd extensions/murmio-collab && npm install && node test/binding.test.js && node test/integration.test.js`.

## On Nebius (submission)
Same containers. Models: NVIDIA Nemotron through Nebius Token Factory. Code execution for agents: Nebius sandboxes / AI Cloud containers. To be set up once credits are claimed.

## Known limits (honest list for the submission)
- Only open files are live-synced; other files are snapshotted when first opened.
- If two people open a never-before-seen file at the same instant, both seed it and the text can be duplicated (needs a server-side seed).
- No per-user permissions yet; a token is all-or-nothing for a room.
- Cursor labels are decorations, so they flicker slightly on very fast typing.
