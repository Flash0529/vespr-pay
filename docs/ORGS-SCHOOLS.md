# Businesses and schools: accounts, sign-in, policy (spec, 2026-10-29)

How VESPR will treat organizations (companies) and schools, and what is already written. The rules live in one pure function, `can(user, action, context)` in `server/policy.js`, which denies by default. The data helpers (age bands, sign-in domain checks, rosters, audit log) are in `server/orgs.js`. Tests: `server/test/policy.test.js`, `server/test/orgs.test.js`, mutation check `server/test/mutate-orgs.mjs`.

## 0. Read this first: statuses and what is not claimed
Every item carries one status:

| Status | Meaning |
|---|---|
| **EXISTS** | in the repository today and used |
| **BUILT-HERE** | written and tested in this change (`server/policy.js`, `server/orgs.js`); **not yet called by any server code**: the hooks in section 9 do that |
| **PLANNED** | designed or promised, no code |

House rules (written down so nobody drifts):
- **No claim of FERPA, COPPA or GDPR compliance, anywhere.** None of it is verified. This document may say "designed to support" and nothing stronger; **no public page, README line or Devpost text may say it.** (`site/children.html` already says "counsel to review".)
- No ads, no selling or renting student data, no profiling, no model training on student data, no outside analytics or trackers in a student product. **PLANNED as promises**: nothing enforces them in code except what is listed in section 5.
- Parent and school consent is **PLANNED**. **Counsel review is required before any school pilot.**
- American English; call the product an SDE.
- Nothing here runs live. No identity provider was called, no email was sent, nothing was installed.

## 1. Account types and roles

### Account types
| Type | What it is | Status |
|---|---|---|
| Individual | one person, no organization; `orgId: null`; roles `['member']` only | `can()` handles it (BUILT-HERE); accounts without an org field EXIST (`server/auth.js`) |
| Organization (company) | an `orgId`, verified domain(s), people with roles, a policy | BUILT-HERE (data rules); no store or admin screen yet: PLANNED |
| School district, school, class | units inside one organization: `district:<id>` > `school:<id>` > `class:<id>`; a student's `classIds` point at classes | BUILT-HERE (`mapRoster` makes the units); no store or screen: PLANNED |

One organization record covers a company or a school; a district is the root unit of a school organization. Cross-organization isolation is a hard rule: a user whose `orgId` differs from the policy's organization gets nothing (tested for every action).

### Roles (`ROLES` in `server/policy.js`)
| Role | Can do (summary; the exact table is the code and the tests) |
|---|---|
| owner | everything in the org, including adding owners and changing admins; cannot change own role |
| admin | manage people (not owners or other admins), policy, retention, export; see student chats when the org setting is on |
| manager | **read-only** History (R23), roster list, export, verify. Changes nothing, never sees private chats (R24) |
| teacher | own classes: invite students, assign templates, narrow class settings, see class History, student progress and student-agent chats (student is told) |
| student | use an agent in Manual or Plan only, class-limited models, internet, run and sharing; own History only |
| guardian | read-only observer of own child(ren), only when the school switched it on; no History |
| member | an ordinary adult in a company: agent, run, share (if the org allows), own History |
| guest | joins by link; can do nothing in the action table (the realtime door in `share.js` governs what a link gives) |

Rules that cannot be configured away: a **student** holds no other role; a **guardian** is an adult and may also be a teacher or member; an individual holds only `member`; a user with an unknown role or band is refused (`bad_user`).
`auditor` and `viewer` (named on `site/teams.html`) are **PLANNED**; `manager` covers the read-only need today.

### Age bands and minimal data (BUILT-HERE: `ageBandFromBirthYear`, `ageBandFromGrade`, `minimalMember`)
| Band | Who | What a member record may hold |
|---|---|---|
| `under13` | young students | id, role, band, class ids, **first name and last initial**, an opaque external-id hash, guardian links, how it was provisioned. **No email, no phone, no birth date.** |
| `13-17` | teens | the above plus a **school-issued** email |
| `adult` | everyone else | the above plus email |

- Only the **band** is stored, never a birth date. Anything unknown, malformed or ambiguous maps to the **stricter** band (a grade of 8 or below counts as under 13 because an eighth grader can be 12).
- Under 13 has **no individual account**: `can()` refuses (`minor_needs_school`). They exist only inside a school organization, provisioned by the school (`provisionedBy: 'roster'` or `'admin'`). Matches `site/children.html`.
- Minors (either band) never get: Bypass, Full internet, SSH, friends, direct messages, links that leave the org, or joining outside links.

## 2. Sign-in that is not an ordinary email and password

| Method | What it is here | Status |
|---|---|---|
| Email + password + TOTP or SMS, Google, Microsoft, GitHub | `server/auth.js` (tested against fakes; off unless `MURMIO_AUTH=1`; **not deployed**; real providers need OAuth apps only the operator can create) | **EXISTS** |
| Google Workspace restricted to the org's domain | `checkSignIn(org, {provider:'google', claims})`: needs the **hosted-domain claim `hd`** equal to the email domain and a verified email, on a **verified** org domain. An email suffix alone is never trusted (a personal Gmail with a look-alike name fails). `auth.js` must call it after the id token is verified | **BUILT-HERE** (rule only; auth.js does not call it yet) |
| Microsoft Entra restricted to the org | same, using the tenant id `tid` the org registered, plus verified email and domain | **BUILT-HERE** (rule only) |
| Generic OIDC for enterprises | `checkSignIn(..., 'oidc')` checks `iss` equals the org's issuer and `aud` includes the org's audience. **The OIDC protocol work (discovery, JWKS, PKCE) is not written for per-org issuers**; `auth.js` already verifies JWKS signatures for Google and Microsoft, which is the base | claim rule BUILT-HERE; the per-org flow is **PLANNED** |
| SAML | **DESIGN only.** SAML needs XML signature handling; no SAML library is vendored, and none was installed. Until one is chosen and reviewed, SAML is not offered | **PLANNED** |
| SCIM-style provisioning | **DESIGN.** An IdP pushes users and groups to `POST /scim/v2/Users`; mapping: SCIM `userName` becomes email, `groups` become classes or roles, `active:false` suspends. Reuses `minimalMember` so a SCIM push cannot add fields the band forbids. Needs a bearer token per org, stored hashed | **PLANNED** |
| Clever | `auth.js` has a Clever OAuth branch written against fakes. **Real Clever needs partner approval that takes weeks; nothing here works for real and none was called.** The claim shape and mapping to class membership are defined (below) | claim mapping **BUILT-HERE**; real connection **PLANNED**, blocked on Clever |
| ClassLink | same shape as Clever (OneRoster style); same blocker | mapping **BUILT-HERE**; connection **PLANNED** |
| Passkeys (WebAuthn) | **DESIGN.** Register a credential after a first sign-in; the server stores `credentialId`, public key, sign count. Needs a CBOR and COSE parser: none vendored, none installed | **PLANNED** |
| Domain verification | `verificationRecord`, `newVerificationToken`, `confirmDomain`: the org adds a TXT record `_vespr-verify.<domain>` with `vespr-verify=<random token>`; the caller resolves TXT and passes the records in (no DNS call in this module). Free-mail domains (gmail.com and similar) can never be claimed | **BUILT-HERE** |
| Invite-by-domain | `inviteByDomain`: a verified work address on a verified domain may join as **member only** (never admin, never student), and only if the org turned it on | **BUILT-HERE** |

### Roster claim shape (Clever and ClassLink) and the mapping
Input to `mapRoster(roster, { orgId })` (a connector would build this from the provider's API; nothing is fetched here):
```
{ provider: 'clever' | 'classlink', districtId,
  schools:  [{ id, name }],
  users:    [{ id, type: 'student'|'teacher'|'school_admin'|'district_admin'|'staff'|'guardian'|'contact', name, email?, grade?, schoolId?, guardianOf?: [userId] }],
  sections: [{ id, name, schoolId, teacherIds: [userId], studentIds: [userId] }] }
```
Output: units (`district:`, `school:`, `class:` ids with parents) and members (`id: "<provider>:<id>"`, role, **band from the grade, stricter if unknown**, `classIds` from the sections the user appears in, minimal fields, `externalIdHash`, `provisionedBy: 'roster'`). Unknown user types are skipped and listed. A student never gets an email if under 13. Guardians (`guardian`, `contact`) get `guardianOf` links; they see nothing until the school turns on `guardianAccess`.

## 3. What an organization admin controls, and where it is enforced
All of it goes through `can()` (BUILT-HERE) with the organization's `policy` object, cleaned by `normalizePolicy` (junk becomes the safe default). Org policy can only **narrow** the floors; nothing widens them. Actions and their context are listed in section 9. **Nothing below is enforced by a running server until the hooks in section 9 are wired** (PLANNED wiring).

| Control | Rule in `can()` | Floors nobody can change |
|---|---|---|
| Allowed agent modes | `policy.modes` (default: all but Bypass), narrowed by the class's `modes` | **Students: Manual or Plan only. Bypass never for any student or minor.** |
| Models | `policy.models`, intersected with the class's `models` | A student has **no** model until the org or class names one |
| Token budgets | `tokenBudgets.userDaily`, `perUser[id]`, class `tokenDaily`; the **smallest** applies | Students get 20,000 a day if nothing else is set |
| Internet (UI-SPEC R34: Off / Allowlist / Full) | `net.max`, `net.allowlist`, class `netMax`; domains match on a dot boundary | Students start at **Off**, a teacher may raise a class to Allowlist but never above the org; **minors never Full** |
| SSH | `policy.ssh` (default off) | never for students or minors |
| Run | `policy.run`; students need the class's `allowRun` | students run **only in the sandbox** |
| Share links | `sharing.who` (`nobody`/`staff`/`members`), `allowExternal` (default **off**), `externalMaxRole` (default view) | minors and students **never** leave the org; students need the teacher's `allowShare` |
| Friends and DMs | `policy.friends` (default off) | **off for minors and students; adults cannot befriend or message minors** |
| Teacher sees student-agent chats | teacher of that student (same class), org staff if `adminsSeeStudentChats`, guardian if `guardianAccess` | the answer carries obligations **`show_notice_to_student`** and **`record_in_audit`**: it is never silent. Managers and peers never |
| Data retention and deletion | `retention.auditDays`; `data.delete.request` by self, guardian of the child, or org staff; `deletionPlan` says what is erased and what stays | the audit log is not rewritten (see section 4) |
| Audit export | owner, admin, manager (a manager is read-only, and export reads) | private conversations are never in the log; export is one org only |
| Per-class templates (assignment starter repo, tutor-mode skill) | `template.assign` / `template.manage`: a teacher of the class, admin, owner | rule BUILT-HERE; the template store and the assignment flow are PLANNED. The tutor-mode skill itself **EXISTS** as text (`agents/src/starter-skills/tutor-mode`), not as an enforced mode |
| Teacher edits | `narrowClassPolicy`: modes, models, internet, tokens, run, share may only be **removed**, never added beyond the org | |

## 4. Audit log (R19 to R24) (BUILT-HERE: `createAuditLog`, `verifyChain`, `exportCsv`, `retentionCut`)
- Append-only: the API has `append` and nothing that edits or deletes; entries are frozen. Each entry is `{ seq, at, orgId, actor, kind, target, detail, hash }` with `hash = sha256(previousHash + canonical entry)`; `verifyChain` recomputes it and names the first broken entry.
- **Kinds** (`AUDIT_KINDS`): edit, run, approval, access, decision, commit, preview, policy, export, deletion, login. There is **no kind for private conversations**: logging one throws. Only the outcome of a Silent Consensus round (a `decision`) may be logged (R24).
- `exportCsv(entries, orgId)` writes one org's rows only and neutralizes spreadsheet formulas (a cell starting with `=`, `+`, `-` or `@` gets a leading quote).
- Retention: `retentionCut` drops entries older than `auditDays` from the front and returns an **anchor** `{seq, hash}`; `verifyChain(keep, anchor)` still checks the rest. Keeping the anchor is the caller's job.
- A deletion request erases the person's profile, sessions, owned chats and uploads, links, friends and seats; the audit entries stay (so the chain holds) with the actor shown as a pseudonym after deletion and removed when retention ends. **A school or a court may need a different answer; counsel decides.**
- **Not proven:** tail truncation (cutting the newest entries) is only detected by comparing `head()` with a copy kept elsewhere; there is no external anchor yet. The log lives in a file sink (`fileSink`, mode 0600, JSON lines) that the server does not use yet. The file's integrity depends on the server's disk, as everything else does today.

## 5. Student privacy and house rules
| Item | Status |
|---|---|
| Minimal data per age band, no birth dates, no email under 13 | BUILT-HERE (`minimalMember`, tested) |
| Teacher visibility of student-agent chats is shown to the student, never hidden | rule and obligation BUILT-HERE; the on-screen notice is a **UI hand-off** (section 10), PLANNED |
| No private chat with the agent in a student account | PLANNED (needs the chat store to record the owner and the viewer log) |
| Under 13 only through a school contract | BUILT-HERE (no individual under-13 account in `can()`); the contract itself is **the operator and counsel** |
| No ads, no selling, no profiling, no model training on student data, no outside trackers | PLANNED promises; the site already runs no analytics (per `site/legal/NOTES.md`). Whether the model provider trains on or keeps prompts is **unconfirmed** and needs the provider's terms |
| Parent or school consent | **PLANNED**; the method is a counsel decision (`[consent method]` on `site/children.html`) |
| Parent access, correction, deletion | deletion request rule BUILT-HERE; correction and the flow PLANNED |
| Encryption at rest, backups, regions | **unconfirmed** |
| FERPA, COPPA, GDPR | **no claim. Not assessed.** Counsel must review before any school pilot |

## 6. Where this is not yet true (honest limits)
- **Per-file read limits cannot be enforced inside one workspace** (`docs/SECURITY.md`): a workspace is one shared document and every connected editor receives all of it. `can()` decides actions (run, share, mode, export), not what text a connected person receives. A class that must not see another's files needs **separate workspaces** (or the planned file spaces).
- Today anyone with a token can read any room. Until `server/index.js` calls `can()` at the doors in section 9, **none of the rules above protects anything running.**
- Static tokens (the token file) have no org fields; section 9 gives them individual defaults. A token holder is treated as an adult individual: do not give static tokens to children.
- Agents act for a person: `can()` is called with the person's record. An agent is never given more than the person who asked (UI-SPEC and PRODUCT-PLAN 6j), and the room's mode caps it further.
- Guests (link joiners) are not users in this model; `share.js` governs what a link gives. A guest holds role `guest`, which the table denies everywhere except `share.join`.

## 7. Policy object (what the admin screen would edit)
```
{ modes: ['manual','acceptEdits','auto','plan'], models: null | ['name', ...],
  tokenBudgets: { userDaily: null | n, perUser: { <userId>: n } },
  net: { max: 'off'|'allowlist'|'full', allowlist: ['github.com', ...] },
  ssh: false, run: true,
  sharing: { who: 'nobody'|'staff'|'members', allowExternal: false, externalMaxRole: 'view'|'edit' },
  friends: false, guardianAccess: false, adminsSeeStudentChats: true,
  retention: { auditDays: 365, workDays: null },
  classes: { <classId>: { modes, models, netMax, allowRun, allowShare, tokenDaily } } }
```
Defaults are the conservative ones shown. `normalizePolicy` is the only reader.

## 8. Data model (PLANNED store; the shapes are fixed by the code)
- Organization: `{ id, name, kind: 'company'|'school', domains: [verified], inviteByDomain, idp: { microsoft: {tid}, oidc: {issuer, audience} }, policy }`.
- Member: `minimalMember` fields; membership is looked up by `(orgId, userId)`; a person may belong to one org in the first version (several is PLANNED).
- Audit log: the entries above, one file per org.

## 9. Integration contract

Exact signatures; the first three modules export everything below. Nothing here edits `server/auth.js`, `share.js` or `friends.js`: the owners add these calls.

### 9.1 Modules
```js
// server/policy.js
export function can (user, action, context = {}) // -> { allow: boolean, code: string, reason: string, obligations?: string[] }; never throws; unknown input is a no
export function effectiveLimits (user, org, classId?) // -> { modes, models|null, netMax, allowlist, tokenCap|null, run, ssh, policy }  (for the UI to show what is allowed)
export function normalizePolicy (raw) // -> a complete, safe policy object
export function validUser (user) // -> boolean
export const ROLES, AGE_BANDS, MODES, NET_LEVELS, ACTIONS

// server/orgs.js
export function sessionFields (member, orgId) // -> { orgId, roles, ageBand, classIds, guardianOf? }
export function minimalMember (input), checkSignIn (org, { provider, claims }), inviteByDomain (org, email)
export function confirmDomain (domain, token, txtRecords), verificationRecord (domain, token), newVerificationToken ()
export function mapRoster (roster, { orgId }), narrowClassPolicy (orgPolicy, classId, change)
export function createAuditLog ({ now, sink, entries, anchor }), verifyChain (entries, anchor), exportCsv (entries, orgId), fileSink (file), readEntries (file), retentionCut (entries, auditDays, now), deletionPlan (member)
```

### 9.2 The user record `can()` takes (what auth must put on the session)
```
{ id: string,                      // stable account id (auth.js user id, or "clever:<id>" for rostered students)
  orgId: string | null,            // null = individual account
  roles: ['owner'|'admin'|'manager'|'teacher'|'student'|'guardian'|'member'|'guest', ...],   // non-empty; a student has only 'student'
  ageBand: 'under13' | '13-17' | 'adult',
  classIds: [string],              // 'class:<id>' for rostered classes; [] if none
  guardianOf?: [userId] }          // guardians only
```
Defaults when a record has no org data (including every static token): `{ orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }`. A record that does not validate is denied everything (`bad_user`), so a wrong field fails closed.

### 9.3 For auth-wiring (`server/auth.js`)
1. **Put the fields on the user record and the session.** `getSessionUser(rawToken)` already returns the stored user; add `orgId`, `roles`, `ageBand`, `classIds` (and `guardianOf`) to it, filled from the org store with `sessionFields(member, orgId)`. Today new users get `roles: ['member']` and no org: that stays the individual default.
2. **Export `sessionUser(rawToken)`** returning `{ id, name, orgId, roles, ageBand, classIds, guardianOf? }` or `null`; for static-token users return the individual defaults above with `id` = the token's name. `identify()` keeps returning a name string, as `share.js`, `git.js` and `uploads.js` use it today.
3. **Domain-restricted sign-in:** after a Google or Microsoft id token is verified (signature, audience, nonce, expiry), call `checkSignIn(org, { provider, claims })` for the org the sign-in was started for; on `ok:false` refuse with the `code`. Pass `claims.email`, `claims.email_verified`, and `hd` (Google) or `tid` (Microsoft). Never accept a domain on the email suffix alone.
4. **New accounts through an org:** `inviteByDomain(org, email)` decides whether an unknown verified address may join, as `member` only. A student record comes only from a roster (`mapRoster`) or an admin, never from self sign-up. **Under-13 members have no password, email or phone**: sign-in is through the school (Clever, PLANNED).
5. **Audit:** append a `login` entry (actor, org, provider; never the token) and an `access` entry on role changes, using `createAuditLog`.

### 9.4 For share-links (`server/share.js`, `friends.js`)
Call before acting; deny on `allow:false` and return the `code` as the error. `ctx.org` is the org record `{ id, policy }`.
```js
// creating a link (before share.create):
can(user, 'share.create', { org, role: 'view'|'edit', leavesOrg: boolean, classId? })
// leavesOrg must be true whenever anyone outside user.orgId could use the link (the default for a link: true unless the room is org-only)
// a signed-in person opening a link (before joining):
can(user, 'share.join', { org, linkOrgId })        // minors may only join links from their own org
// friends:
can(user, 'friends.request', { org, target: { ageBand } })      // also friends accept
can(user, 'dm.send', { org, target: { ageBand } })
```
Rules to honor: a minor's or a student's link never leaves the org; an external link is view-only unless `externalMaxRole` says edit; friends and DMs are off for minors and for any pair where either side is a minor. Guests (`guest~...` names) have no user record: keep the existing guest door in `share.js`, and refuse guests for friends.

### 9.5 For the agents and the server doors
```js
can(user, 'agent.mode.use', { org, mode, classId? })     // before starting or switching a mode (agent.mode.set for changing the room's mode)
can(user, 'model.use',      { org, model, classId? })
can(user, 'tokens.spend',   { org, tokens, used, classId? })   // used = tokens spent today by this person
can(user, 'net.access',     { org, level: 'off'|'allowlist'|'full', domain?, classId? })   // per request, domain is the host
can(user, 'run.command',    { org, runner: 'sandbox'|'remote'|'ssh', classId? })
can(user, 'ssh.use',        { org })
```
- Run `agents/src/policy.js` `decide()` **and** `can()`: both must say yes. `can()` caps what the room mode allows; it never grants.
- The agent uses the **requesting person's** record, never its own.
- Tokens: add up usage per person per UTC day and pass it as `used`.

### 9.6 For History, chats and admin endpoints (server and app)
```js
can(user, 'history.view',   { org, kind?, classId?, target? })   // kind 'private_chat' | 'consensus_private' is always a no
can(user, 'audit.export',   { org })      // then exportCsv(entries, org.id); append an 'export' audit entry (obligation: record_in_audit)
can(user, 'audit.verify',   { org })
can(user, 'chat.view_agent',{ org, target: { id, orgId, classIds } })  // honor obligations: show the student a notice, write an audit entry
can(user, 'student.progress.view', { org, target })
can(user, 'org.member.list',{ org, classId? })
can(user, 'member.invite',  { org, role, classId?, viaDomain? })
can(user, 'member.role.set',{ org, target: { id, orgId, roles }, newRole })
can(user, 'policy.set',     { org, scope: 'org'|'class', classId? })   // for class scope, apply the change with narrowClassPolicy
can(user, 'retention.set',  { org })
can(user, 'data.delete.request', { org, target: { id, orgId } })       // then deletionPlan(member)
can(user, 'template.assign' | 'template.manage', { org, classId? })
```
**Obligations** returned in `result.obligations` are duties, not hints: `show_notice_to_student` (tell the student on screen that this person looked) and `record_in_audit` (append an audit entry). A caller that cannot do them must not proceed.

### 9.7 Rules every caller follows
Deny on `allow:false`; log the `code`, never the reason to the other party if it names a person. Never call with a user built from client input. Pass `ctx.org` from the server's own store. A missing org is a no.

## 10. UI hand-off (prototype.html is owned by another agent; nothing was changed)
- **Admin tab (Teams/Schools):** People (roles, class membership, age band shown as a chip, provisioned-by), Domains (the TXT record to add, "Verify"), Sign-in (allowed domain, Google/Microsoft/OIDC, invite-by-domain switch), Policy (the section 7 object as controls; show `effectiveLimits` as "what a student in this class gets"), Audit (verify chain button, export CSV, retention).
- **Student view:** a permanent, plain line: "Your teacher can see your conversations with the agent." No private agent chat. Mode picker shows only Manual and Plan; locked Internet and Run states say why ("Your teacher has not turned this on").
- **Teacher view:** class list, per student: progress, agent chat (with the notice written to the student when opened), the class settings (can only reduce). Templates: assign a starter repo and the tutor-mode skill.
- **Manager view:** History and export only, no edit controls (R23); the panel says private conversations are never shown (R24).
- **Minors:** no Friends, no DMs, no "share outside" option; hide, do not just disable, so a child is not shown a thing they cannot have.
- **Copy rules:** never write "COPPA compliant", "FERPA compliant" or "GDPR compliant". Use "planned" on every school feature until it ships and counsel has reviewed it.

## 11. What only the operator (and counsel) can decide
- The **legal entity** that signs school and business contracts, and its address and contacts (placeholders on the trust pages).
- **Counsel review** of the children's policy, terms, privacy and the data-processing agreement; which laws apply; the **consent method** for under 13; whether a student's agent chat may be read by teachers without a notice (our rule: always with a notice).
- **Partner approvals:** Clever and ClassLink (weeks), the model provider's data terms (training, retention, regions), an OAuth app per provider (client id, secret, redirect URI).
- Whether to ship SAML, SCIM and passkeys, which means choosing and reviewing libraries (none vendored; nothing was installed here).
- Employee-monitoring law for the business profile (works councils): keep it visible to the people it describes.
- Whether a manager may export (we allowed it: export reads, and UI-SPEC acceptance check 6 asks for it), and whether `auditor` becomes a role.

## 12. Not proven
- **No server code calls `can()` yet.** The tests prove the function, not the product.
- The tests use fakes for everything outside the module: no real Google, Microsoft, Clever, ClassLink, DNS or email was touched. `hd`, `tid`, `iss` and `aud` handling follows those providers' documented claim names from memory of their documentation; **verify against live tokens** before relying on it.
- The mutation check kills all 70 of its own listed mutants; that shows those breakages are caught, not that no other bug exists.
- Age band from a grade is a conservative guess; a school's own date of birth data is not read.
- Performance, concurrency and persistence of an org store are not built.
