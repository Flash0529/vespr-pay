# Who may do what in a workspace (make, view, edit, delete, manage)

`server/access.js`, switched on with `VESPR_ACCESS=1`. With it off, nothing changes. Added 2026-11-04.

## The model
- **Rights:**
  - **make**: create files
  - **view**: open the workspace
  - **edit**: change files
  - **delete**: remove files
  - **manage**: change who has access in that place. A manager gives or takes back make/view/edit/delete there, only rights they hold themselves; only the owner gives manage, and never to everyone (`*`) or an agent
  - Renaming needs make at the new name and delete at the old one.
- **A grant** gives some rights to a person, or to `*` (everyone signed in), on a path:
  - `""` is the whole workspace
  - `src/` (or `src`) is a folder and everything in it, never a look-alike such as `srcx/`
  - `src/a.py` is one file
- **Grants add up.** The workspace owner has every right.
- **A grant may end** (`until`): an answer "for 1 hour" or "for a day" adds a grant that counts for nothing afterwards. Nothing has to run to remove it.
- **Agents are people here:** an agent gets its rights the same way (for example `coder`: make, view, edit, delete on `""`).
- **Open vs locked:** a workspace with no access list is open, as before. `lock` gives it a list, with the person who locked it as owner; `unlock` (owner only) opens it again.

## What the server checks (not the screen)
Every change a connection sends goes through these steps:
1. **Shadow copy.** It's applied to a private copy of the workspace first, to see exactly what it would do:
   - files made, edited, renamed or deleted
   - chat posted, changed or deleted
   - personal entries: your own "open this file" commands for your SDE (`ui`), "I am editing this file" claims, the change log (`provenance`)
   - other shared state (settings, tasks, plans)
2. **Rights check.** Each of those changes is checked against the sender's rights:
   - **Files:** make, edit and delete on that path.
   - **Chat:** posting needs view.
   - **Changing another person's message:** never allowed, except answering an agent's approval card in your own name. That needs edit on the whole workspace when the workspace is locked.
   - **Deleting chat history:** owner only.
   - **Personal entries** (all in your own name, checked even when open):
     - opening a file or following an agent (`ui`) needs view; the app's trim of the oldest commands (it keeps the last 50) passes, any other removal needs edit on the whole workspace
     - a claim ("editing this file") needs edit on that file; you may release your own, or any claim on a file you may delete
     - a change-log entry needs make, edit or delete on the file it is about; changing or removing old entries needs edit on the whole workspace
   - **Other shared state** (switching the agents to Bypass, tasks, and so on): edit on the whole workspace when locked.
3. **Names are checked even in an open workspace.** A chat message must carry the sender's own signed-in name (case and spaces ignored).
4. **Anything not allowed** is dropped before it reaches the workspace or anyone else. The server logs `access: refused <who> in <room>: <what>` and closes that connection with code **4409**.
   - The app then stops reconnecting, reloads the workspace fresh from the server, and says what wasn't allowed.
   - That's needed because Yjs can't accept half an update, and a person's later changes build on the refused one.
   - Only the refused change, and what was typed on top of it, is lost.
5. **Joining a locked workspace** needs view somewhere in it; otherwise the connection is refused (403).
6. **Share links keep their meaning:** a view link sees, an edit link is a full teammate. Names are still checked.

## Asking for access (people and agents)
1. **People** right-click a file or folder in Files → **Ask for access…**, tick the rights, and say why. **Agents** call the `request_access` tool (path, rights, reason) when a file tool tells them they lack a right.
2. The server keeps the request and posts it as a card in the workspace chat: who asks for what, where, and the reason in quotes.
   - Only the server writes these cards. A connection that posts or changes one is refused, so nobody can fake an "approved" card.
3. The owner, or a manager of that place, answers on the card (or in Share → Who has access, under "Waiting for an answer"): **Allow for 1 hour**, **Always**, or **Deny**. The first answer decides; the card shows who answered and until when.
4. The asker's app reloads its rights the moment the card changes; an agent waiting on `request_access` gets the answer and goes on (or, after a no, tells the person what it could not do).

### Rules (each one tested)
| Rule | Why |
|---|---|
| Nobody answers their own request; agents never answer, own or manage | an agent talked into asking (prompt injection) can never approve itself; a person decides |
| A manager gives only rights they hold there, never manage, never on a place they don't manage, never changes another manager's row | no climbing: managing `src/` with view+edit can't hand out delete or the whole workspace |
| "Allow for 1 hour" is the first button; "Always" is a deliberate second click | a mistaken yes runs out by itself |
| Agents can't ask for manage | an agent never decides who has access |
| At most 3 waiting requests per person; not the same thing again within 10 minutes of a no; asking again while waiting returns the same request | nobody floods the chat |
| Waiting requests lapse after a day | stale asks don't get approved by accident later |
| The reason is cut to 300 characters, control characters removed, and shown as a quote | it's the asker's words, not the app's |
| Bypass mode never approves access requests | modes are about what an agent may do with its rights, not about getting more |
| Someone with no rights at all may ask to join a locked workspace | the owner sees "dave asks for view on the whole workspace" |
| Every lock, unlock, grant, revoke, request and answer goes to `<data>/access/<room>.log.jsonl` | the owner and managers can see who allowed what (`GET .../history`) |

### Agents with limited rights
- An agent checks its rights (refreshed every 15 s and after an answer) before it changes a file. Without the right, the tool says so and points at `request_access`, instead of sending a change the server would refuse.
- Its own bookkeeping (`plans`, `handled`, `usage`, `tasks`) needs only view, so an agent limited to `src/` still shows its checklist.
- Settings are checked per key: an agent with view may write its own status keys (`githubImport`, `githubPr`, `packsCatalog`, `runs`) and answers to requests people made (`github`, `githubBase`, `pr`, `packsApplied`); `agentMode`, `runner` and everything else still need edit on the whole workspace. Without this a view-only agent was refused at startup and restarted in a loop.
- An agent checks its rights before asking people to approve a change, so it never raises an approval card for an edit it may not make.
- **Checked live (2026-11-05, real model, private test stack):** coder with view only, asked to edit a new file, asked for edit on that file within 40 s ("Need to append a review line as requested."); the owner allowed it for an hour; the edit landed 4 s later; no restarts.
- If the server ever refuses one of its changes (code 4409), the agent stops and restarts fresh instead of resending it forever.
- The server knows the agents by name: `VESPR_AGENT_NAMES` (default `coder,reviewer,tutor,planner`).

### In the file tree
- A **view only** badge on files you can't edit and folders where you can neither make nor edit.
- Right-click: **Who has access…** opens the panel with that place picked in the add form; **Ask for access…** appears where you lack rights.

### Names are unique
Access, ownership and chat go by name, so each name now belongs to one account (case and spaces ignored). Email sign-up with a taken name gets "That name is taken"; single sign-on gets a free variant ("Sam Lee 2"). Agent names, service-token names and `*` are reserved. Before this, anyone could sign up as `tester` and own tester's locked workspaces.

## The API
All calls are signed in (`Authorization: Bearer <token>`):
| Call | What | Who |
|---|---|---|
| `GET /api/access/<room>` | `{ locked, owner, grants, mine }` (`mine` = your rights on the whole workspace) | anyone, if open; members, if locked |
| `POST /api/access/<room>/lock` | the open workspace gets a list, with you as owner | anyone, once |
| `POST /api/access/<room>/grant` `{ who, path, rights }` | replaces that person's grant on that path | owner, or a manager of that place (see the rules) |
| `POST /api/access/<room>/revoke` `{ who, path }` | removes it | owner, or a manager of that place |
| `POST /api/access/<room>/unlock` | back to open | owner |
| `POST /api/access/<room>/request` `{ path, rights, reason }` | ask; the card goes to chat | anyone signed in |
| `GET /api/access/<room>/requests` | waiting requests you may answer, and your own | anyone signed in |
| `POST /api/access/<room>/answer` `{ id, approve, for: '1h'\|'1d'\|'always', rights? }` | allow (all or some of what was asked) or deny | owner, or a manager of that place |
| `GET /api/access/<room>/history` | the audit log (last 200) | owner and managers |

Lists are kept in `<data>/access/<room>.json`, mode 0600.

## Honest limits (next steps)
1. **View is for the whole workspace.** A workspace is one shared document, so someone who can open it receives every file's text. "Can see this folder but not that one" needs per-folder documents.
2. **The screen:** Share → **Who has access** (`app/access-panel.js`). It shows whether the workspace is open (with a Lock button), the owner and one row per grant with make / view / edit / delete as tick boxes the owner can change, an "Add someone" form (name, agent or `*`, a folder, rights) and "Open it again". Members see the list read-only.
   **Read-only files (built 2026-11-04):** the app loads your rights when it connects, again every 30 s, and at once when the owner changes them in the panel (`canDo` in `app/access-panel.js`, the same rule as the server).
   - A file you can't edit opens read-only, under the note "View only: you can't edit <file>. <owner> decides who can (Share → Who has access)."
   - Making, renaming, deleting, changing the agent mode, answering approval cards, importing a repository, opening a pull request and choosing where commands run are checked first, and say why instead of sending.
   - Skipping the setup question writes nothing for someone without edit on the workspace.
   - Until your rights arrive (a moment after connecting) the app allows everything and the server still refuses.
3. **First lock wins.** Anyone may lock an open workspace. A person's own home room should be locked to them automatically.
   **Accounts made before names were unique** may share a name; check the users file once before turning access on for real.
   **Agents are known by name** (`VESPR_AGENT_NAMES`), not by a separate kind of token.
4. **The HTTP features follow the list too** (since 2026-11-04/05; the gate `routeNeed` in `server/access.js` plus hooks in `server/index.js`):
   - uploads: add = make (in `uploads/`), list or download = view
   - snapshots: publish or delete = manage, list = view
   - git: commit and push = edit, clone, fetch, log and blame = view (the token as the Basic password)
   - the change log = view; NAS files: add = make, delete = delete, the rest = view
   - creating a share link or friend-sharing the workspace = manage; who pays (billing plan) = manage to set, membership to see or join
   - runner jobs = edit on the whole workspace (their results come back into the files)
   - found with a route audit (79 routes, 24 flagged); tests `access.test.js`, `access-hooks.test.js`
5. **Presence** (the name shown on a cursor) is still set by each person's app.
6. **After a server restart that lost recent changes,** an app reconnecting sends what it still has. For someone without edit on the workspace that is refused once (code 4409, the app reloads); people with edit and the agents put it back.

## Tests
- `server/test/access.test.js`: rules on real wire messages.
- `server/test/access-live.test.js`: the real server with real peers.
- Four deliberate breaks are caught: no name check, look-alike folders, the connection not guarded, refusals ignored.
- Personal entries (`ui`, claims, provenance): 11 more deliberate breaks, each caught (names, rights per file, trim only from the oldest, nothing nested). Two other breaks are equivalent: the change is still refused another way.
- `app/test/access-panel.test.mjs`: `canDo` matches the server; managers, rows that end, who may answer, the waiting list.
- `server/test/access.test.js` "manage, requests and answers" and `agents/test/access-agent.test.js` (real server, real agent: knows its rights, asks, a person allows it for an hour, it edits; a no is final for a while; never disconnected). `server/test/auth-names.test.js`: unique and reserved names.
- Deliberate breaks for manage and requests: 11 of 13 caught; the other 2 are rules written twice (the second copy still refuses).
- Browser-checked on the test stack:
  - tester2 right-clicked README.md → Ask for access; the card showed in chat
  - tester (owner) clicked Allow for 1 hour; the card said "Allowed edit until 7:49 PM by tester"; README.md became editable for tester2
  - the owner ticked Manage for tester2 on `src/`; Manage for the agent `coder` was refused
  - as a manager, tester2 added `reviewer` on `src/`; the whole workspace was refused
- Browser-checked on the private test stack as a second account (view on the workspace, view/edit/make on `src/`):
  - README.md opens read-only with the note, and typing changes nothing
  - `src/app.py` is editable
  - a new file in `src/` works; at the top level the app says why
  - Delete and the Bypass mode give the friendly message
  - no disconnects
