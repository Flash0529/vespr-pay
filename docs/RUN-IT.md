# Run it: the agent starts and previews the project

Added 2026-10-28. Ask `@coder start the website` (or "run the project", "preview the app"). The agent works out the stack from the workspace files,
asks the room for approval (it starts a program that listens on a port), installs, starts it in the background, waits until it answers, and posts a
**preview link** in the shared chat that everyone can open. If it does not come up, the agent reads the process log and fixes the cause.

## Tools the agent gets
| Tool | What it does | Approval |
|---|---|---|
| `detect_project` | Stack, install / dev / test commands (`agents/src/project.js`); read-only | none |
| `start_project` | Copies the workspace to its own folder, installs, starts the dev server in the background on a free port, waits for it | yes, except in Bypass |
| `process_logs` | Last lines of a process's output | none |
| `stop_process` | Stops it | none |

Detected: Node (Vite, Next.js, Create React App, Express and other servers), Python (Flask, FastAPI, Django, or a folder with `index.html`), static sites,
Makefile targets, Go, Rust. Plain scripts and libraries are recognised as "nothing to serve" and the agent says so.

## How the preview is served
`agents/src/processes.js` runs each process detached with a scrubbed environment (`PORT`, `HOST`, `BASE_PATH` only), a log tail (300 lines), a 30-minute
life and a limit of 3 per workspace. `agents/src/preview.js` serves it at `/preview/<24 hex>/` from the agent's HTTP port; the realtime server forwards
that path to the agent (`server/index.js`). HTML is rewritten so root-absolute links stay under the prefix; Vite is started with `--base` so its own
assets work. The public address in the link comes from `MURMIO_PUBLIC_URL` (default `http://localhost:9401`).

## Limits, honestly
- The token in the link is the only credential (like a share link): anyone who has the link can view the page while the process runs. Do not put secrets in a previewed app.
- The preview is served from the realtime server's own address, so a malicious previewed page shares that origin; the server keeps no cookies or local data, and the SDE runs on a different port.
- No WebSocket pass-through yet, so hot reload does not work in the preview (reload by hand). Next.js previews can look incomplete (it needs `basePath`).
- It runs in the shared sandbox (the agent's container), not on a teammate's computer; the sandbox shares its container's network (see `docs/SECURITY.md`).
- Tested with the scripted (demo-mode) agent and real processes: `agents/test/runit.test.js`. With a real model the same tools are offered; that run has not happened yet (no working key).
