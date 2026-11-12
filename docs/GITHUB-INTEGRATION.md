# GitHub integration

Goal: a workspace can start from a GitHub repository and send its changes back as a pull request, so VESPR works with the place teams already keep their code.
Two separate things (do not mix them): **signing in with GitHub** (identity only, in the accounts work) and **this**, access to repositories.

## Step 1: open a repository (built, tested)
`c.importRepo('owner/repo')` or a link (a branch or folder link works). The agent (`agents/src/github.js`):
1. reads the repository's default branch and licence, pins the branch to **one commit**, downloads that commit's tarball (only `api.github.com` and `codeload.github.com` are allowed; a size cap applies);
2. writes the text files into the shared workspace. Skipped and counted: files over 200 KB, binary files, dependency and build folders (`node_modules`, `.git`, `dist`...), names the workspace cannot hold, anything past 400 files or 2 MB. A file that already exists is never overwritten;
3. keeps the starting point in the shared settings: `github` (owner, repo, ref, commit, licence) and `githubBase` (the **git hash of every imported file**, computed the way git does; checked against `git hash-object` in the tests);
4. says in chat what it opened and what it skipped.
Public repositories need no key. A private one works only if the operator gives the agent `GITHUB_TOKEN`; it is sent to `api.github.com` only and never shown. In the app: View, Open a GitHub repo.
Tests: `agents/test/github.test.js` (tar reader with long names, skips and limits, hashes against real git, host and token rules, end to end with a real server). Also checked by hand once against a real public repository (`octocat/Hello-World`).

## Step 2: send changes back as a pull request (built, tested against a fake GitHub only)
`c.openPullRequest({ title?, body? })` (agent: `agents/src/githubpr.js`). **Not yet tried against the real GitHub API: no token was available.** What it does:
1. **Diff:** the workspace against `githubBase` (the git hash of every imported file): changed, added, deleted. Never sent: `.vespr/` (workspace skills), dependency and build folders, names a repository path cannot hold, files over 200 KB, and anything past 100 files or 2 MB (counted and shown on the card). The text of each file is a **snapshot taken when the card is built**; exactly that is sent, an edit made while the card is open is not.
2. **Approval first:** ONE card (`kind: 'pr'`) with the repository, the new branch, the base branch and commit, the files by group, what is not sent, and the **title and description that will be published**. **No network call at all** (not even a read) happens before it is approved. No token, no repository opened, or nothing changed: the agent says so and shows no card.
3. **Calls (only reads and creates, never PATCH, PUT or DELETE):** read the base branch (is it a branch? did it move?) -> read the pinned commit and its tree (file modes; refuses a tree GitHub truncates) -> one blob per changed or added file (the returned hash must equal git's hash of the text) -> a tree on top of the pinned tree (`sha: null` deletes; an executable file stays executable) -> a commit whose parent is the pinned commit -> a **new** branch `vespr/<workspace>-<date>` (a taken name gets `-2`, `-3`... up to 5; an existing branch is never updated) -> the pull request into the branch the workspace was opened from. It never writes to that branch and never merges.
4. **A stale base** (the branch moved since the workspace was opened) is reported, not overwritten: the commit still sits on the commit the workspace was opened at, the agent asks GitHub what moved, lists the files changed on both sides, and puts a note in the pull request, where GitHub shows the conflicts.
5. **Left out and said so:** a file the repository already has at that path that the import did not write (e.g. one that pre-existed in the workspace), or a link or submodule.
6. **Draft (no model):** the title is the first request in the chat since the workspace was opened (or the one the person gave); the description lists the counts, up to five requests (token-like strings cut out), and who worked on it: people from the chat, agents and their models from the History per file. People's own edits are not recorded per file, and the description says so.
7. **Token:** only `GITHUB_TOKEN` in the agent's environment; one `Authorization` header, `api.github.com` only, https, no redirects, only `/repos/<owner>/<repo>/...` paths; cut out of every error text; never stored, logged or said. Needs a fine-grained token limited to that repository with Contents and Pull requests write access. Same-repository branches only (forks are open decision 2 below).
8. **Shell:** `get().prEnabled` (the agent has a token), `get().github` (a repository was opened) and progress in `get().pr` (`status`: checking, asking, sending, done, denied, nothing, no-token, no-repo, error; `url`, `number`, `branch`, `base`, `counts`, `left`, `stale`, `error`). The chat says the result. The shell needs a View-menu row "Open a pull request…" (shown only when `github` and `prEnabled`) and a small dialog with an optional title and description before calling `openPullRequest`; the approval card has `kind: 'pr'` (the card code maps unknown kinds to "edit file": it needs "Open pull request").
9. **Known limits:** one starting point is assumed (opening a second repository into the same workspace mixes the base); the first 100 files; trees larger than GitHub returns in one piece are refused; no fork flow; the pull request is not marked draft.
Tests (no network): `agents/test/githubpr.test.js`, a model of GitHub's git-data API behind a fake `fetch` (so the real `githubApi` code runs): call order and payloads, deletions, modes, a stale base, a taken branch, a denied card with zero calls, no token, collisions, a folder import, failures at each step, the token never appearing anywhere, and the app/agent protocol over a real server. 16 mutations checked.

## Step 3: stay in sync (later)
Pull the newer commit into the workspace (three-way against `githubBase`), show pull request status and CI checks in the Git tab, turn issues into tasks for agents, comment back on the pull request.

## Open decisions (for the project owner)
1. Which GitHub account or organisation owns the test repository, and a fine-grained token limited to it (drop box `github-token`).
2. Whether pull requests are opened from a branch in the same repository or from a fork.
3. Whether the judge demo should show this at all (it needs a repository to write to, and a token on the VM).
