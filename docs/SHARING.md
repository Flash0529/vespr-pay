# Share links, friends and accounts

Status 2026-10-29. Backend and client library are built and tested; the UI is not (hand-off notes below); accounts are design only.
Code: `server/share.js`, `server/friends.js`, `server/jsonstore.js` (new), small hooks in `server/index.js`, browser client `app/share-client.js`.
Tests: `server/test/{share,friends,shareclient,live}.test.js`, mutation check `server/test/mutants.mjs`.

## 1. What exists today
- **Identity** is a name. `identify(token)` in `server/index.js` returns a name from the static tokens file (`name:token` lines), or, with `MURMIO_AUTH=1`, from `server/auth.js` (email + password with 2FA, Google, Microsoft, GitHub, Clever; sessions stored as SHA-256 hashes; it returns `session.name || session.email`, so an identity can be an email address).
- **A room (workspace) is a team.** Any valid token can open any room by name over `/ws/<room>?token=`; no owner, no roles (`docs/SECURITY.md`, "Not enforced yet"). One Yjs document holds every file, the chat, approvals and settings, so a socket cannot be limited to one file, and "read only" has to be enforced by dropping the socket's writes.
- `app/vespr-client.js` joins one room as a peer. There is no "home", no friends, no way to hand a link to a person without a token. UI-SPEC section 6 only lists teammate conversations and Silent Consensus (R25 to R27); sharing and friends are new.
- Secrets rules: no keys in files, tests generate tokens at run time. Done here.

## 2. Data model (all under the server's data dir, files 0600 in a 0700 folder, atomic writes)
`<data>/share/links.json`: `links[id] = { id, hash, room, file|null, role: view|edit, by, label, createdAt, expiresAt|null, revokedAt|null, lastUsedAt, uses }`.
`hash` is SHA-256 of the 32-byte random token (43 base64url characters, 256 bits). The token is returned once at creation and never stored.
`<data>/friends/graph.json`: `pairs["a|b"] = { a, b, status: pending|accepted, from, ts, acceptedAt }` and `grants["room|owner|friend"] = { room, owner, friend, role, ts }`. A handle is the lowercase identity, 2 to 32 characters of `a-z 0-9 . _ -`. Emails, `agent*` and `guest~*` identities have no handle.

## 3. API (all JSON, Bearer token unless marked "no login"; tokens in a link go in a POST body, never a URL path)
| Call | Result |
|---|---|
| `POST /api/share/create {room, file?, role, expiresInSec?, label?}` | 201 `{id, token, room, file, role, expiresAt, state...}`; file links must be `view`; expiry 60 s to 1 year; 100 active links per person; agents refused (403) |
| `GET /api/share/list?room=` | your links, never the token, each with `state` active/expired/revoked |
| `POST /api/share/revoke {id}` | creator only; closes that link's open sockets (code 4403) |
| `POST /api/share/resolve {token}` (no login) | `{room, file, role, expiresAt, by}` or 404 `link_invalid` |
| `POST /api/share/file {token}` (no login) | file links: `{room, file, text}` read from the exported tree (up to about half a second behind) |
| WebSocket `/ws/<room>?token=<link token>` | whole-room links only; connects as `guest~<6 hex>`; `view` drops every document update from the socket (sync step 2 and updates; awareness still flows), `edit` is a full teammate; closed on revoke and at expiry |
| `GET /api/friends` | `{me, friends, incoming, outgoing}` |
| `POST /api/friends/request {to}` / `accept {from}` / `decline {from}` / `remove {who}` | request to someone who already asked you makes you friends; decline is silent for the sender; remove also cancels your own pending request and ends project sharing both ways |
| `POST /api/friends/share {room, with, role}` / `unshare {room, with}` | only with an accepted friend |
| `GET /api/friends/projects` | `{byMe, withMe}` |

`VESPR_SHARE=1` switches all of it on (it is off by default: a link that lets a stranger into a room is the operator's call). `VESPR_TRUST_PROXY=1` makes rate limiting use the last `X-Forwarded-For` entry (set it only behind a proxy you control, otherwise everyone shares the proxy's address).

## 4. Threat model
| Risk | What we do | What is left |
|---|---|---|
| Guessing a link | 256 random bits; unknown, malformed, expired and revoked tokens give the same 404; lookup is by SHA-256 so timing says nothing about the token | none practical |
| Leaked data dir | only hashes stored; the dir is 0600 | an attacker with the file cannot make links, but sees who shared what |
| Brute-force noise | 30 failed tries per address per 10 minutes, then 429 (also on the WebSocket door) | in-memory, resets on restart; behind a proxy needs `VESPR_TRUST_PROXY` |
| Expiry | checked on every use; open sockets are closed at expiry | a file link already read stays read |
| Revocation | creator only; sockets closed at once; persisted | text already copied by a viewer stays copied |
| Referrer and history leaks | the link is `app#share=<token>`: a fragment is never sent to a server or in a Referer; every API answer has `Referrer-Policy: no-referrer` and `no-store`; the client scrubs the fragment after reading it (`scrubbedUrl`) | the token is visible to anyone who sees the screen or the pasted message; a WebSocket query string holds it (the server does not log URLs) |
| Link token used as a login | it is accepted only at the WebSocket door for its own room; git, uploads, runners, `/api/*` still need a real token; a guest cannot make links | |
| Who can see what | view link: the whole room's files, chat and approvals (read only); file link: that one file as text; edit link: everything and can also answer agent approvals and change settings, so treat it like adding a teammate | file-level limits on a live socket are impossible (one Yjs document) |
| Friend spam | 20 pending outgoing requests, 500 friends, 60 changes per minute, silent decline | no block list |
| Identity leaks | emails are never handles | a person whose identity is an email cannot use friends until accounts give them a handle |

## 5. NOT built
- Accounts and sign-in by email (design below). No email is sent, no OAuth app created, no key used.
- Any UI. Per-room owners and per-person roles in the realtime server: friend project shares are a listing ("shared with me"), not a lock. Anyone with a token can still open any room by name.
- Edit access to one single file (needs one document per file or a server-side write gate).
- Block list, link password, link download limits, audit trail of who opened a link, link analytics beyond `uses`.
- Rate limiting that survives a restart; rate limits on `create`.
- Live-file reads for file links (they read the exported tree).
- The `server/index.js` hooks are covered by `server/test/live.test.js` (real server on 127.0.0.1:9461, real Yjs peers; removing `restrict` or `attach` from the hook makes it fail). Not covered: a reverse proxy in front, many guests at once, a browser client.

## 6. Accounts: design only
Goal: sign in with an email, get a stable handle, land in the right place.
1. **User record** (extend `auth.js` users): `{ id, handle, email, emailVerified }`. `handle` is unique, chosen once at first sign-in, validated by the same rule as `defaultHandleOf`. `identify()` should return the handle, not `name || email`; then friends, links and git authors never show an email. Until then `friends.js` answers 400 `no_handle` to email identities.
2. **Sign-in by email** is the existing email + password + 2FA path, or a one-time sign-in link. A one-time link needs outgoing mail (a mailer, a sending domain with SPF/DKIM) that is not set up. `auth.js` already writes verification links to a dev log when no mailer is given; that is the only thing that runs today.
3. **Clever / SSO** need client keys from the operator. Without them the buttons stay off (`getProviders()` already reports what is configured).
4. **Landing** (`landing()` in the client): a `#share=` link wins; else signed out goes to sign-in and then where they were going; else the last room; else Home with a badge for waiting friend requests. A guest opening a link needs no account; the UI may offer "Sign in to keep this" later.
5. **Open questions for the operator:** mail provider and domain; whether Clever is a hackathon goal; whether file-level edit sharing matters before the deadline.

## 7. UI hand-off (for whoever owns `app/prototype.html`; nothing here edits it)
Import `app/share-client.js`: `createShareClient({server, token})`, then:
- **Share dialog** (button on a project and on a file tab): role chooser (Can view / Can edit; edit disabled for a single file, explain with `friendlyMessage('edit_needs_room')`), expiry (never, 1 hour, 1 day, 7 days, 30 days), optional label. `createLink` returns the token once: show `buildShareUrl(location.origin + location.pathname, token)` with a Copy button and a note that it cannot be shown again. States: idle, creating, created (copy), error (`friendlyMessage(err.code)`).
- **Links list** (`listLinks(room)`): per row `roleLabel`, `expiryLabel`, `uses`, state chip from `linkState`, Revoke button (`revokeLink`, confirm). States: empty, loading, list, revoking, revoked/expired shown muted.
- **Opening a link** at page start: `landing({hash: location.hash, lastRoom, signedIn, home})`. For `{kind:'share'}`: `history.replaceState(null, '', scrubbedUrl(location.href))`, `openLink(token)`; room link: connect with `wsUrlForShare(server, room, token)` (the existing client builds its own URL; it needs a token option); file link: `readSharedFile` and show a read-only viewer. States: opening, opened (banner "You are viewing as a guest, view only" or "can edit"), `link_invalid` full-page message, `slow_down`, `network` with retry. Close: when the socket closes with code 4403 or 4401 show "This link was turned off" or "This link expired".
- **Friends panel** (`friends()`): lists friends, incoming (Accept / Decline), outgoing (Cancel = `removeFriend`); add by handle (`requestFriend`); errors via `friendlyMessage` (`bad_handle`, `already_friends`, `self`). Badge = incoming count.
- **Projects shared with friends**: "Shared with me" from `projects().withMe` (open the room), and per project a Share with friends picker (`shareProject`, `unshareProject`) listing only accepted friends. State `no_handle`: prompt to pick a handle (accounts, not built).
- Never print or log a token; do not put it in `localStorage`.
