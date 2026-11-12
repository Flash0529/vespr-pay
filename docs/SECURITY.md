# Security notes (prototype)

VESPR lets people and AI agents change files and run commands in a shared workspace, so the rules about who may do what matter. This is the model, what is enforced today, and what is not.

Last reviewed 2026-10-29: the agent-sandbox and secrets statements were corrected to say that the sandbox shares the agent's system user and container.

## Trust model
- **A workspace ("room") is a team.** Anyone with a valid VESPR token for the server can join any room, read it, edit it, read its session log and its git repository. There are no per-room or per-person permissions yet.
- **Agents are separate identities** (token names starting with `agent`). They are not trusted to act alone: what they may do is set by the room's agent mode.
- **Runners are machines that opted in.** A runner only runs jobs for workspaces its owner allowed.
- **Commands an agent runs, and the app's Run button, execute inside the agent's own container** (the default "sandbox"), as the same system user as the agent. That is a shared-trust arrangement, not isolation: see "Not enforced yet".

## Enforced
| Rule | Where |
|---|---|
| Every connection and API call needs a token (WebSocket, `/api/*`, git) | `server/index.js`, `server/git.js`, `server/runners.js` |
| Only agent identities may start jobs on runners; a person's token cannot skip the room's approval flow | `server/index.js` (`MURMIO_RUN_USERS`, default names starting with `agent`) |
| Agent actions follow the room's mode: Manual asks for every edit and command; Auto asks for anything not read-only on someone's own computer; dangerous commands (`sudo`, `rm -rf /`, ...) are refused outright; Bypass is downgraded to Auto on remote machines | `agents/src/policy.js` |
| An agent asks before editing a file someone is working on, in every mode | `agents/src/agent.js` (claims) |
| The runner never inherits your environment variables, only runs allowed workspaces, runs in a temporary folder, with time and output limits, and never writes outside it | `runner/lib.js` |
| A git push cannot bring `.git` or `.vscode` paths, `..` paths, absolute paths, more than 2000 files, or files over 200 KB into the workspace; the editor never writes `.vscode` or `.git` files that a peer sent | `server/git.js`, `extensions/murmio-collab/extension.js` |
| Names, models, messages and colors sent by other clients are escaped or validated before they reach HTML or Markdown in the editor | `extensions/murmio-collab/lib/*`, `media/chat.js` |
| Secrets stay out of the repository: tokens and keys live in files git does not track, and a scan blocks commits, the public copy and deploy bundles that contain a real key or token. The runner and the key checker never print keys. This protects the code and its keys, not a workspace's content | `scripts/check-secrets.py`, `deploy/`, `agents/tools/check-keys.mjs` |
| A command started for an agent gets a cleaned environment (a few settings such as `PATH`, `HOME` and `LANG`, never the agent's own variables), a temporary working folder, a time limit and an output cap | `agents/src/runner.js` |
| The app's Run button is off unless the operator sets `MURMIO_HUMAN_RUNS=1` on the agent. The shared deployments (`deploy/judge`, `deploy/nebius`, `deploy/compose.yml`) leave it off for the reason below; `deploy/local` turns it on because the machine is your own | `agents/src/runs.js`, `deploy/*/compose.yml` |
| Request size limits on suggestions, runner jobs and git pushes; one git operation per room at a time | `server/*.js` |

## Not enforced yet (known limits)
- **By default**, anyone with a token can read or change any room, approve any agent action, change the agent mode, and read the session log.
  **With `VESPR_ACCESS=1` (2026-11-04, `docs/ACCESS.md`)** an owner can lock a room and give each person or agent make / view / edit / delete per path. The server checks every edit on the live connection and drops what isn't allowed, and it checks chat names even in open rooms. Not yet covered: uploads, git, snapshots, share-link creation and runner jobs (sign-in only), per-folder view, and presence names.
- **The agent sandbox is not isolated from the agent's own secrets.** A command run in the sandbox (one a person approved for an agent, or a Run from the app) runs as the same system user, in the same container, as the agent. Starting it with a cleaned environment does not change that: the command can read what the agent can read, which includes the model API key and the agent's workspace token (through the agent process's own environment) and the mounted list of access tokens the agent needs for inline suggestions. A workspace member can already get to these by asking an agent to run a script and approving it. That is why the Run button is off by default on shared deployments, and why the public demo's server holds nothing else of value and caps the model key with a daily token budget. The real fix is a separate sandbox container that holds no secrets, or running commands as a different system user; neither is built yet.
- The sandbox also shares the agent container's network, so a command can reach the internet. On a remote runner only read-only commands skip approval in Auto.
- **Per-file read limits cannot be enforced inside one workspace.** A workspace is one shared document and every connected editor receives all of it, so a file cannot be hidden from a teammate in the same workspace; a restriction there would only hide it in the interface. Separate workspaces (or, later, separate documents per access level) are the way to keep a file from someone.
- Secret scanning only covers this repository and its deploy bundles: a commit hook can be skipped with `--no-verify`, and a wider scan runs only when someone runs it.
- A runner owner can be shown a fake machine name by anyone who registers a runner (the UI also shows the owner's name next to it).
- Tokens are kept in a plain file on the server (not hashed), compared with a normal map lookup (not constant-time), and are sent in a URL query for WebSocket connections (the server does not log URLs). The optional accounts code stores only hashes of session tokens.
- The VS Code workspace-trust prompt cannot be pre-accepted in the browser build, so a one-time prompt appears.
- The session log can contain everything typed in the workspace, including anything sensitive someone pastes into it.

## Reporting
This is a hackathon prototype. If you find a problem, open an issue on the repository.
