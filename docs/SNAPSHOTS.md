# Snapshot links (read-only copies). Live share links and friends are in docs/SHARING.md

## What exists: read-only copies at a long address (`server/snapshot.js`, off unless `VESPR_SNAPSHOT=1`)
- **Share a copy** (the share button, top right, shown only when the server has it on): one file or the whole project, a link that ends after 1, 7, 14 or 30 days (up to 90 through the API), listed with views, ended at any time. `client.snapshot.create / list / revoke`.
- The address holds 128 random bits (`/snap/<48 hex>`); only a SHA-256 of the secret half is stored. The page is server-made, has no script, a strict content policy (`default-src 'none'`), `noindex`, no referrer, no framing.
- A link is a **copy made at share time**: it cannot show a file that was not chosen, and nothing in it changes afterwards. Dotfiles, dot-folders and files named like keys, tokens, passwords or credentials are never copied (a single file with such a name is refused). Limits: 200 KB a file, 2 MB and 300 files a project, 100 active links a workspace.
- Tests: `node server/test/snapshot.test.js` (auth, escaping, headers, the secret half never stored, a copy stays a copy, refusals, revoke, expiry, caps), plus a run through the real server (`create`, public page, CORS preflight for DELETE, list, revoke, off by default).
- Off by default on every stack. Turning it on for the judge VM means a server redeploy (the collab container) and is the operator's call.

## What does not exist, and why
- **Live invitation links** ("open this project with me"): a link that joins the shared document shows **every file** in it, because one shared document cannot hide a file from a connected person (the access engine, `server/access.js`, is not built). A single-file edit link cannot be enforced either.
- **Friends list, projects per friend, account email**: needs accounts switched on. The accounts module exists (`server/auth.js`: email and password with 2FA, Google, Microsoft, GitHub, Clever; opt-in with `MURMIO_AUTH=1`) but is not switched on, and a friends list must hang off an account. Build it after accounts are on, with the access engine, in that order.
