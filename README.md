# VESPR

A **smart development environment (SDE)**: a code platform where people and AI agents work in the same files at the same time, with the whole team in charge.

## The PayPal entry: agents ask before they spend

In a VESPR room an AI agent can ask for a payment, and **only a person can approve it.**

- The agent's only payment tool is `request_payment`. It has no way to approve, to create a PayPal order or to capture one.
- The request is a card in the room chat: what, how much, the agent's own reason, and the server's own numbers (what the room already used in 24 hours, what approving would leave, the limit per request).
- A person presses **Approve** or **Deny**. Only after an approval does the server create a PayPal order. The buyer pays on PayPal's own sandbox page, the server asks PayPal itself whether the order is approved and captures it, and a person can refund it in full.
- The limits are the server's, not the agent's: USD only, at most USD 50 a request and USD 100 a room in 24 hours, 15 minutes to answer, 30 for the buyer to pay.
- History records who asked, who approved and what PayPal did, with names, and a Payments ledger (a sortable, filterable table) lists every request with a receipt.
- In a classroom a student's agent can ask, a student can never approve a payment, and a teacher or another adult does.

**PayPal sandbox only. No real money moves.** The server refuses any PayPal address but the sandbox one, and every card says so.

**Run it (about ten minutes).** You need Node 20 or newer, Python 3, `openssl`, `curl` and your own PayPal sandbox keys (below). Full steps, the limits, the tests and what has been checked against the real sandbox are in [`docs/PAYPAL.md`](docs/PAYPAL.md).
```
git clone https://github.com/Flash0529/vespr-pay vespr && cd vespr
(cd server && npm ci) && (cd agents && npm ci)
export PAYPAL_CLIENT_ID='your sandbox client id' PAYPAL_CLIENT_SECRET='your sandbox secret'
scripts/demo-stack.sh start && scripts/demo-stack.sh url     # open the link it prints
```
In the chat type `@coder pay $25 for the logo invoice`, press **Approve $25.00**, and log in on PayPal's sandbox page as a sandbox Personal account (if your browser blocks the PayPal window, allow pop-ups for the page; if a box "What will you build here?" shows first, press **Skip for now**). Without a model key the agent is the scripted demo agent: its name tag reads "demo-mode (scripted, no model key)", the card's reason says the scripted agent passed the amount you typed, and it only understands plain requests such as "pay $25 for ..." or "buy the $12.50 ..."; the card, the server's checks and the PayPal calls are the real ones.

**Sandbox access.** Create your own for free at developer.paypal.com: *Apps & Credentials*, switch to Sandbox, *Create App* gives the client id and secret; *Testing Tools, Sandbox Accounts* gives a Personal account whose email and password you use as the buyer on PayPal's page. Judges who prefer not to create accounts can ask us for a sandbox test login through the Devpost page. **No keys are in this repository**: the server reads yours from its environment, and without them the feature says "PayPal sandbox is not set up on this server" and nothing pretends to work.

- **Real VS Code in the browser** (Code - OSS), so your extensions, themes and settings work.
- **Everyone has a cursor.** People and agents show up live in the file, with names, like a shared document.
- **Agents are teammates.** They edit, run commands and review alongside you; every chat with an agent is visible to the whole workspace, and the agent asks the room before it acts (five permission modes; the first answer on an Approve / Deny card decides and everyone sees who).
- **Who wrote this, and why.** Every character records the author, the model and the request behind it, shown on hover; session replay scrubs back through edits, cursors, chat and approvals.
- **Code Map.** A live map of the workspace: files, imports, symbols and who wrote what, as a panel and as a tool the agent can ask.
- **Run it.** Ask the agent to start the project; it detects the stack, starts it in the background after the room approves, and posts a preview link.
- **Run anywhere.** Agents run commands in a sandbox, on a cloud machine, or on a teammate's own computer (opt-in, asks first).
- **Git hosting, shortcuts and macros.** Ordinary git over HTTP; every action is a named command with a default key (`docs/SHORTCUTS.md`).
- **A browser app for the whole team** (`app/`): your agents in the left bar, the editor in the centre, the conversation beside it, a manager-visible **History** of everything that was done (edits with diffs, runs, approvals; private chats are never logged), and the red/green line-by-line view of an agent's edit as it is typed. Plain HTML and JavaScript, no build step; it talks to the same shared document through `app/vespr-client.js`. Status: the layout and flows are all there; which screens are wired to live data is listed under "Known limits".
- **Files, with honest limits.** Upload a Word, PowerPoint or Excel file, a CSV, a PDF, an image, a 3D model, audio or video; the agent reads what it can (text, slides and speaker notes, sheet rows, 3D size and triangle count, media duration) and says plainly what it could not read (`agents/src/readers.js`). Uploads are size-capped, checksummed and only ever served as downloads.
- **Agents ask before they spend (PayPal sandbox):** see the section above and `docs/PAYPAL.md`.
- **A skills library.** Skills are plain `SKILL.md` instruction files in the workspace (`agents/src/skills.js`). Before an agent says "I can't", it searches installed skills, the library and connected GitHub repositories; installing one from outside always asks the room (in every mode) and is pinned to a commit.

## Quickstart: run it on your own computer
You need Docker. A Nebius Token Factory key is optional: without one the agent runs a scripted demo mode, and its name tag says so.
```
cd deploy/local
NEBIUS_API_KEY=your-key ./make-env.sh      # random logins; writes .env, tokens and links.txt (all ignored by git)
docker compose up -d --build               # first build takes a few minutes
cat links.txt                              # open the two links in two browser windows
```
In the first window open the VESPR icon in the left bar and type `@coder run python3 -m unittest -q`; approve the card in either window; then `@coder fix the discount bug in cart.py and run the tests again`. Press **Ctrl+Alt+M, then M** (Cmd+Alt+M on a Mac) for the Code Map. Stop with `docker compose down`.

## Try the hosted demo
The website, with the docs and the trust pages, is at https://204-12-177-152.sslip.io/ (static, served by the same VM).
A public demo runs on a Nebius AI Cloud VM (`deploy/judge/`). The app opens in demo mode with no login at https://app.204-12-177-152.sslip.io/ ; live mode and the two judge logins are described in `docs/TESTING-INSTRUCTIONS.md`.
**The hosted demo is an earlier build of VESPR and does not include the PayPal payment flow.** To try that, run it yourself with the steps in "The PayPal entry" above, or build and start `deploy/judge/` from this repository (`docs/PAYPAL.md`, "A hosted server").

## Run a demo server for other people
`deploy/judge/` runs the same stack on one VM behind HTTPS with caps on memory, processes, CPU and AI tokens: see `deploy/judge/README.md` (written for a Nebius VM; any Docker host works).

## How it uses Nebius and NVIDIA
- Agents talk to **Nebius Token Factory** through its OpenAI-compatible API (`https://api.tokenfactory.nebius.com/v1`, `agents/src/llm.js`).
- The models are **NVIDIA Nemotron**: the agent asks the account for its model list and picks from it (`agents/src/llm.js`): **Nemotron 3 Super** (`nemotron-3-super-120b-a12b`) for everyday chat, edits and inline suggestions, **Nemotron 3 Ultra** (`Nemotron-3-Ultra-550b-a55b`) for plan mode. Vision-language, embedding and safety models are never picked. Override with `NEBIUS_MODEL`, `NEBIUS_PLAN_MODEL`, `NEBIUS_SUGGEST_MODEL`.
- Short one-shot calls (suggestions, digests) turn Nemotron's hidden reasoning off (`chat_template_kwargs.enable_thinking=false`); with it on, a 120-token budget was spent on reasoning and the answer came back empty. In our test Super with reasoning off answered in about 0.6 s, the Nano model in about 2.1 s, so Super serves the suggestions.
- The agents' tools are called through the same API: read and edit files, run commands, ask the Code Map, start the project, find a skill, read an attachment. Nemotron 3 Super chose the right tool calls for the extended tool list on the first try.
- The public demo runs on **Nebius AI Cloud** (a 2 vCPU / 8 GiB VM, static IP, HTTPS through Caddy); the agent on that VM calls Token Factory at run time (checked by `agents/tools/smoke-remote.mjs` over the internet).
- Without a key the agents run a scripted demo mode, and their name tags say so.
- Verified on 2026-10-28 against the live Token Factory: the sample task ("fix the discount bug and run the tests again") is fixed by the agent and the tests go green, with no approval cards in Auto mode. Measured numbers and how they were taken: `docs/MEASURED.md`. Web search (Tavily) is off until a working Tavily key is set.

## Security in short
Every agent action that changes or runs something goes through an Approve / Deny card (five modes; Bypass never applies on someone else's machine). Uploaded files are never executed or served as pages. A secret scanner (`scripts/check-secrets.py`) blocks commits, the public copy and deploy bundles that contain real keys or tokens. Details and known gaps: `docs/SECURITY.md`.

## Tests
`./scripts/test-all.sh` runs every test (no keys, no Docker needed; Node 20+, git and python3).

## Layout
`server/` realtime sync, git and the runner hub · `extensions/murmio-collab/` the VS Code extension · `agents/` the agent worker (chat, tools, modes, suggestions, digest, Run it, Code Map) · `app/` the browser app and its client · `runner/` run commands on any machine · `desktop/` Electron app (built and launched on a Mac, untested on Windows) · `ide/` the VS Code image · `deploy/` compose files and scripts · `docs/` architecture, runners, security, shortcuts, Run it, measurements.
Internal identifiers (command IDs such as `murmio.codemap`, `MURMIO_*` environment variables, some folder names) keep the project's earlier working name and will be renamed in a later release.

## Known limits
What a judge may click on that is not real yet, in plain words:
- **Inline suggestions in the web editor** are canned snippets. They are not wired to the server's suggestion service, so do not read them as model output.
- **The Git tab and the status bar** show demo data. Ordinary git over HTTP works against the server; the Git tab does not call it.
- **Settings, Billing and Usage** do not read the server's credits or usage.
- **The hosting page** is a preview with nothing connected.
- **SSH hosts, the internet allowlist and the GitHub commit and pull-request buttons** are interface only.
- **History:** the activity History (who did what, with a Payments filter) is under Tools, View options, History. The sidebar's History row opens the file-versions page instead.
- **A late payment:** if the buyer pays after the agent has stopped waiting (its tool waits 10 minutes, the buyer has 30), the card turns into the receipt but the agent's earlier sentence ("still pending, not paid yet") stays in the chat and no follow-up message is posted.
- **Approvals and roles:** the server blocks a student from approving a PAYMENT. Ordinary agent approval cards (running a command, editing a file someone is working in) are not role-checked on the server yet: anyone in the room can answer them.

Also true: only open files are live-synced; any valid login can read any workspace's uploads; PDF reading is basic unless `pdftotext` is installed; audio and video are described by their header only; the sandbox shares its container's network; replay logs grow without limit. More in `docs/SECURITY.md`.

## License
**GNU Affero General Public License v3.0** (AGPL-3.0-only). See `LICENSE` and `NOTICE.md`. You may use, study and modify this code; if you offer a modified version to others over a network you must publish your changes under the same licence. A commercial licence is available for uses the AGPL does not allow. The hosted product and its enterprise and classroom features are separate and not part of this repository. Software VESPR builds on, with its licences: `THIRD-PARTY.md`. "VS Code", "Nebius", "NVIDIA" and "Nemotron" are trademarks of their owners; VESPR is independent and not affiliated with them.
