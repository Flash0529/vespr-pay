// Connectors: a signed-in person links outside services (Google Drive, Gmail, GitHub, Slack, Notion, ...) to their VESPR account, the way
// Connectors for third-party services. Design: docs/CONNECTED-SERVICES.md (two-step consent: sign-in asks only who you are; each service is asked
// for separately, when the person chooses it).
//
//   GET  /auth/connectors                     the catalog with this person's state per connector, plus "suggest" (services of the provider
//                                             they signed in with, not connected and not dismissed yet)
//   POST /auth/connectors/start {ids, app?}   -> { url }: a one-time VESPR link (/auth/connectors/go/<ticket>), never the provider's page
//   GET  /auth/connectors/go/<ticket>         in the browser: checks this browser is signed in as the account that pressed Connect (else
//                                             sign in first, or refuse), marks the browser with a cookie, then forwards to the provider
//   GET  /auth/connectors/callback            the provider sends the browser back here; only a browser with that mark is accepted, then
//                                             the tokens go into the vault, and a desktop start gets a "Back to the VESPR app" link
// Why the hop through VESPR (the team asked how the big apps do it; they all do this): without it, someone could press Connect in their own
// account, send you the provider link, and your "Allow" would file your Google access under their account. The provider's link now only
// exists after VESPR has seen who is signed in to the browser, and the return only counts in the browser VESPR marked.
//   POST /auth/connectors/disconnect {id}     forget one connector (the provider's token is revoked when its last connector goes)
//   POST /auth/connectors/dismiss {family}    "not now" for the after-sign-in suggestion
//   tokenFor(userId, id)                      for server code (agents, later): a fresh access token, refreshed when needed, or null
//
// Honest by construction: a connector whose provider keys the operator has not set says "not set up on this server" and cannot start;
// a connector is "connected" only after the provider returned tokens (and, when it reports them, granted the scopes asked for).
// Tokens are sealed with AES-256-GCM (key: VESPR_CONNECTOR_KEY, else a 0600 key file beside the data) and never leave the server.
// Mail connectors are for adults only (docs: student safety). Every connect, disconnect and refresh failure is written to the audit log.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const STATE_TTL_MS = 10 * 60 * 1000

// One "family" per OAuth app. Google, Microsoft and GitHub reuse the sign-in apps (VESPR_AUTH_*) unless VESPR_CONNECT_* is set.
// Endpoints are from each provider's OAuth documentation (docs field); each is proven against the real provider the day its key is added.
export const FAMILIES = {
  google: { name: 'Google', env: 'GOOGLE', signin: 'GOOGLE', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', pkce: true, base: ['openid', 'email'], extra: { access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent' }, hint: true, revoke: 'https://oauth2.googleapis.com/revoke', account: { url: 'https://openidconnect.googleapis.com/v1/userinfo', pick: j => j.email }, docs: 'https://developers.google.com/identity/protocols/oauth2/web-server' },
  microsoft: { name: 'Microsoft', env: 'MICROSOFT', signin: 'MICROSOFT', authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', pkce: true, base: ['offline_access', 'User.Read'], hint: true, account: { url: 'https://graph.microsoft.com/v1.0/me', pick: j => j.mail || j.userPrincipalName }, docs: 'https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow' },
  github: { name: 'GitHub', env: 'GITHUB', signin: 'GITHUB', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', base: ['read:user'], account: { url: 'https://api.github.com/user', pick: j => j.login }, docs: 'https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps' },
  slack: { name: 'Slack', env: 'SLACK', authorize: 'https://slack.com/oauth/v2/authorize', token: 'https://slack.com/api/oauth.v2.access', scopeParam: 'user_scope', sep: ',', tokens: j => j.authed_user || {}, label: j => j.team && j.team.name, docs: 'https://api.slack.com/authentication/oauth-v2' },
  notion: { name: 'Notion', env: 'NOTION', authorize: 'https://api.notion.com/v1/oauth/authorize', token: 'https://api.notion.com/v1/oauth/token', extra: { owner: 'user' }, auth: 'basic', body: 'json', label: j => j.workspace_name, docs: 'https://developers.notion.com/docs/authorization' },
  linear: { name: 'Linear', env: 'LINEAR', authorize: 'https://linear.app/oauth/authorize', token: 'https://api.linear.app/oauth/token', pkce: true, sep: ',', base: ['read'], docs: 'https://linear.app/developers/oauth-2-0-authentication' },
  asana: { name: 'Asana', env: 'ASANA', authorize: 'https://app.asana.com/-/oauth_authorize', token: 'https://app.asana.com/-/oauth_token', pkce: true, label: j => j.data && j.data.email, docs: 'https://developers.asana.com/docs/oauth' },
  atlassian: { name: 'Atlassian', env: 'ATLASSIAN', authorize: 'https://auth.atlassian.com/authorize', token: 'https://auth.atlassian.com/oauth/token', extra: { audience: 'api.atlassian.com', prompt: 'consent' }, body: 'json', base: ['offline_access', 'read:me'], account: { url: 'https://api.atlassian.com/me', pick: j => j.email }, docs: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/' },
  figma: { name: 'Figma', env: 'FIGMA', authorize: 'https://www.figma.com/oauth', token: 'https://api.figma.com/v1/oauth/token', auth: 'basic', base: ['current_user:read'], account: { url: 'https://api.figma.com/v1/me', pick: j => j.email }, docs: 'https://developers.figma.com/docs/rest-api/authentication/' },
  canva: { name: 'Canva', env: 'CANVA', authorize: 'https://www.canva.com/api/oauth/authorize', token: 'https://api.canva.com/rest/v1/oauth/token', pkce: true, auth: 'basic', base: ['profile:read'], docs: 'https://www.canva.dev/docs/connect/authentication/' },
  hubspot: { name: 'HubSpot', env: 'HUBSPOT', authorize: 'https://app.hubspot.com/oauth/authorize', token: 'https://api.hubapi.com/oauth/v1/token', base: ['oauth'], docs: 'https://developers.hubspot.com/docs/api/oauth-quickstart-guide' },
  dropbox: { name: 'Dropbox', env: 'DROPBOX', authorize: 'https://www.dropbox.com/oauth2/authorize', token: 'https://api.dropboxapi.com/oauth2/token', pkce: true, extra: { token_access_type: 'offline' }, base: ['account_info.read'], docs: 'https://developers.dropbox.com/oauth-guide' },
  box: { name: 'Box', env: 'BOX', authorize: 'https://account.box.com/api/oauth2/authorize', token: 'https://api.box.com/oauth2/token', account: { url: 'https://api.box.com/2.0/users/me', pick: j => j.login }, docs: 'https://developer.box.com/guides/authentication/oauth2/' },
  zoom: { name: 'Zoom', env: 'ZOOM', authorize: 'https://zoom.us/oauth/authorize', token: 'https://zoom.us/oauth/token', pkce: true, auth: 'basic', account: { url: 'https://api.zoom.us/v2/users/me', pick: j => j.email }, docs: 'https://developers.zoom.us/docs/integrations/oauth/' },
  canvas: { name: 'Canvas LMS', env: 'CANVAS', needsUrl: true, authorize: '{url}/login/oauth2/auth', token: '{url}/login/oauth2/token', docs: 'https://canvas.instructure.com/doc/api/file.oauth.html' },
  d2l: { name: 'D2L Brightspace', env: 'D2L', authorize: 'https://auth.brightspace.com/oauth2/auth', token: 'https://auth.brightspace.com/core/connect/token', base: ['core:*:*'], docs: 'https://docs.valence.desire2learn.com/basic/oauth2.html' }
}

const G = s => 'https://www.googleapis.com/auth/' + s
// The catalog. scopes are added to the family's base scopes. adults: refused for accounts that said they are under 18.
export const CONNECTORS = [
  { id: 'google_drive', family: 'google', name: 'Google Drive', category: 'Files and docs', what: 'Open and save the files you pick in Drive.', scopes: [G('drive.file')] },
  { id: 'gmail', family: 'google', name: 'Gmail', category: 'Mail and calendar', what: 'Read mail you point it at and draft replies. Nothing is sent without your OK.', scopes: [G('gmail.readonly'), G('gmail.compose')], adults: true },
  { id: 'google_calendar', family: 'google', name: 'Google Calendar', category: 'Mail and calendar', what: 'See your events and add the ones you approve.', scopes: [G('calendar.events')] },
  { id: 'google_classroom', family: 'google', name: 'Google Classroom', category: 'School', what: 'See your classes and your own coursework.', scopes: [G('classroom.courses.readonly'), G('classroom.coursework.me')] },
  { id: 'outlook_mail', family: 'microsoft', name: 'Outlook mail', category: 'Mail and calendar', what: 'Read mail you point it at and draft replies. Nothing is sent without your OK.', scopes: ['Mail.Read', 'Mail.Send'], adults: true },
  { id: 'outlook_calendar', family: 'microsoft', name: 'Outlook Calendar', category: 'Mail and calendar', what: 'See your events and add the ones you approve.', scopes: ['Calendars.ReadWrite'] },
  { id: 'onedrive', family: 'microsoft', name: 'OneDrive', category: 'Files and docs', what: 'Open and save files in your OneDrive.', scopes: ['Files.ReadWrite'] },
  { id: 'github', family: 'github', name: 'GitHub', category: 'Code', what: 'Import repositories and open pull requests from your workspace.', scopes: ['repo'] },
  { id: 'slack', family: 'slack', name: 'Slack', category: 'Chat', what: 'Search your channels and post the messages you approve.', scopes: ['channels:read', 'channels:history', 'chat:write', 'search:read'] },
  { id: 'notion', family: 'notion', name: 'Notion', category: 'Files and docs', what: 'Read and update the pages you share with VESPR.', scopes: [] },
  { id: 'linear', family: 'linear', name: 'Linear', category: 'Projects', what: 'See and update your issues.', scopes: ['write'] },
  { id: 'asana', family: 'asana', name: 'Asana', category: 'Projects', what: 'See and update your tasks.', scopes: [] },
  { id: 'atlassian', family: 'atlassian', name: 'Jira and Confluence', category: 'Projects', what: 'See and update Jira issues; read Confluence pages.', scopes: ['read:jira-work', 'write:jira-work', 'read:confluence-content.all'] },
  { id: 'figma', family: 'figma', name: 'Figma', category: 'Design', what: 'Read your design files.', scopes: ['file_content:read'] },
  { id: 'canva', family: 'canva', name: 'Canva', category: 'Design', what: 'See your designs and their contents.', scopes: ['design:meta:read', 'design:content:read'] },
  { id: 'hubspot', family: 'hubspot', name: 'HubSpot', category: 'Business', what: 'Read your contacts.', scopes: ['crm.objects.contacts.read'] },
  { id: 'dropbox', family: 'dropbox', name: 'Dropbox', category: 'Files and docs', what: 'Open the files in your Dropbox.', scopes: ['files.metadata.read', 'files.content.read'] },
  { id: 'box', family: 'box', name: 'Box', category: 'Files and docs', what: 'Open the files in your Box.', scopes: [] },
  { id: 'zoom', family: 'zoom', name: 'Zoom', category: 'Mail and calendar', what: 'See your meetings.', scopes: [] },
  { id: 'canvas_lms', family: 'canvas', name: 'Canvas LMS', category: 'School', what: 'See your courses and assignments.', scopes: [] },
  { id: 'd2l_brightspace', family: 'd2l', name: 'D2L Brightspace', category: 'School', what: 'See your courses and assignments.', scopes: [] }
]
const BY_ID = Object.fromEntries(CONNECTORS.map(c => [c.id, c]))

const b64u = b => Buffer.from(b).toString('base64url')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clip = (s, n = 120) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n)

// Default HTTP for the token calls: fetch with a 15 s limit. Tests inject their own.
async function defaultRequest ({ url, method = 'GET', headers = {}, body }) {
  const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) })
  return { status: r.status, text: await r.text() }
}

export function createConnectors ({ DATA, config = process.env, now = Date.now, random = n => crypto.randomBytes(n), request = defaultRequest, getUser, isMinor = () => false, mayConnect = () => null }) {
  const dir = path.join(DATA, 'auth'); try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const file = path.join(dir, 'connections.json')
  const auditFile = path.join(dir, 'connections.log.jsonl')
  const states = new Map() // state -> { userId, family, ids, verifier, redirectUri, bind, app, expiresAt }

  // ── the vault ──────────────────────────────────────────────────────────
  const keySource = /^[0-9a-f]{64}$/i.test(String(config.VESPR_CONNECTOR_KEY || '')) ? 'env' : 'file'
  function vaultKey () {
    if (keySource === 'env') return Buffer.from(config.VESPR_CONNECTOR_KEY, 'hex')
    const kf = path.join(dir, 'vault.key')
    try { const k = fs.readFileSync(kf, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(k)) return Buffer.from(k, 'hex') } catch {}
    const k = random(32).toString('hex'); fs.writeFileSync(kf, k + '\n', { mode: 0o600, flag: 'wx' }); return Buffer.from(k, 'hex')
  }
  function seal (obj) {
    const iv = random(12); const c = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv)
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
    return { v: 1, iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(data) }
  }
  function open (box) {
    const d = crypto.createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(box.iv, 'base64url'))
    d.setAuthTag(Buffer.from(box.tag, 'base64url'))
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64url')), d.final()]).toString('utf8'))
  }

  // ── storage: { users: { [id]: { families: { [f]: { vault, scopes, account, connectedAt, expiresAt, broken } }, connected: { [cid]: { at } }, dismissed: [f] } } }
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return { users: {} } } }
  function save (db) { const tmp = `${file}.tmp.${random(4).toString('hex')}`; fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file) }
  const mine = (db, userId) => { db.users = db.users || {}; const u = db.users[userId] = db.users[userId] || {}; u.families = u.families || {}; u.connected = u.connected || {}; u.dismissed = u.dismissed || []; return u }
  function audit (e) { try { fs.appendFileSync(auditFile, JSON.stringify({ at: new Date(now()).toISOString(), ...e }) + '\n', { mode: 0o600 }) } catch {} }

  // ── the operator's keys ────────────────────────────────────────────────
  function keys (fam) {
    const f = FAMILIES[fam]; if (!f) return null
    const id = config[`VESPR_CONNECT_${f.env}_ID`] || (f.signin && config[`VESPR_AUTH_${f.signin}_ID`])
    const secret = config[`VESPR_CONNECT_${f.env}_SECRET`] || (f.signin && config[`VESPR_AUTH_${f.signin}_SECRET`])
    const url = f.needsUrl ? String(config[`VESPR_CONNECT_${f.env}_URL`] || '').replace(/\/+$/, '') : ''
    if (!id || !secret || (f.needsUrl && !/^https:\/\//.test(url))) return null
    return { id, secret, url }
  }
  const endpoint = (f, k, which) => f[which].replace('{url}', k.url)
  const scopesOf = ids => { const s = new Set(); for (const id of ids) { const c = BY_ID[id]; for (const x of [...(FAMILIES[c.family].base || []), ...c.scopes]) s.add(x) } return [...s] }

  // ── what one person sees ───────────────────────────────────────────────
  function view (user) {
    const db = load(); const u = mine(db, user.id); const minor = isMinor(user); const blocked = mayConnect(user)
    const list = CONNECTORS.map(c => {
      const f = FAMILIES[c.family]; const fam = u.families[c.family]; const on = u.connected[c.id]
      let status = 'available'; let note = null
      if (on && fam) { status = fam.broken ? 'needs_reconnect' : 'connected'; if (fam.broken) note = 'The provider stopped accepting VESPR\'s access. Connect again.' }
      else if (!keys(c.family)) { status = 'not_set_up'; note = `Not set up on this server yet: the operator has to add VESPR's ${f.name} app keys.` }
      else if (c.adults && minor) { status = 'not_for_account'; note = 'Mail connectors are for adults only.' }
      else if (blocked) { status = 'not_for_account'; note = blocked }
      return { id: c.id, name: c.name, provider: f.name, family: c.family, category: c.category, what: c.what, status, note, account: on && fam ? fam.account || null : null, connectedAt: on ? on.at : null }
    })
    // after signing in with Google / Microsoft / GitHub: offer that provider's services once
    const suggest = []
    for (const fam of Object.keys((user && user.providers) || {})) {
      if (!FAMILIES[fam] || u.dismissed.includes(fam)) continue
      const ids = list.filter(c => c.family === fam && c.status === 'available').map(c => c.id)
      if (ids.length && !list.some(c => c.family === fam && c.status === 'connected')) suggest.push({ family: fam, provider: FAMILIES[fam].name, ids })
    }
    return { connectors: list, suggest, vault: keySource }
  }

  // ── connect ────────────────────────────────────────────────────────────
  const tickets = new Map() // ticket -> { userId, family, ids, app, base, expiresAt }: the one-time VESPR link start hands out
  const APPS = ['vespr', 'vespr-test'] // the desktop apps' link schemes ("Back to the VESPR app")
  const TICKET = /^[A-Za-z0-9_-]{32}$/
  const bindCookie = state => 'vespr_connect_' + state.slice(0, 12)
  const sweep = () => { for (const m of [tickets, states]) for (const [k, v] of m) if (v.expiresAt <= now()) m.delete(k) }
  function checks (user, ids) {
    if (!ids.length || ids.length > 8 || ids.some(id => !BY_ID[id])) return { status: 400, body: { error: 'ids: one to eight connector ids from the catalog' } }
    const fam = BY_ID[ids[0]].family
    if (ids.some(id => BY_ID[id].family !== fam)) return { status: 400, body: { error: 'One provider at a time: these connectors use different sign-ins' } }
    if (!keys(fam)) return { status: 409, body: { error: `${FAMILIES[fam].name} is not set up on this server yet`, code: 'not_set_up' } }
    const blocked = mayConnect(user); if (blocked) return { status: 403, body: { error: blocked, code: 'not_admitted' } }
    if (isMinor(user) && ids.some(id => BY_ID[id].adults)) return { status: 403, body: { error: 'Mail connectors are for adults only', code: 'adults_only' } }
    return null
  }

  // step 1, in the app: a one-time link to VESPR's own page (not the provider's), good for 10 minutes
  function start (user, ids, base, { app } = {}) {
    ids = [...new Set((Array.isArray(ids) ? ids : []).map(String))]
    const no = checks(user, ids); if (no) return no
    sweep()
    const ticket = b64u(random(24))
    tickets.set(ticket, { userId: user.id, family: BY_ID[ids[0]].family, ids, app: APPS.includes(app) ? app : null, base: String(base).replace(/\/+$/, ''), expiresAt: now() + STATE_TTL_MS })
    return { status: 200, body: { url: `${String(base).replace(/\/+$/, '')}/auth/connectors/go/${ticket}`, provider: FAMILIES[BY_ID[ids[0]].family].name } }
  }

  // step 2, in the browser: only the account that pressed Connect, signed in to this browser, goes on to the provider
  function go (ticket, browserUser, { secure = false } = {}) {
    sweep()
    const rec = TICKET.test(ticket) ? tickets.get(ticket) : null
    if (!rec) return page(false, 'This connect link has expired or was already used. Press Connect again in VESPR.')
    if (!browserUser) return signInFirst(ticket, FAMILIES[rec.family].name)
    if (browserUser.id !== rec.userId) {
      audit({ user: rec.userId, family: rec.family, event: 'refused_other_account', browserUser: browserUser.id })
      return page(false, `This link was made for a different VESPR account, and this browser is signed in as ${browserUser.name || 'someone else'}. Nothing was connected. Press Connect from the account you want to connect, in the browser where that account is signed in.`)
    }
    tickets.delete(ticket)
    const no = checks(browserUser, rec.ids); if (no) return page(false, no.body.error)
    const fam = rec.family; const f = FAMILIES[fam]; const k = keys(fam)
    const state = b64u(random(24)); const verifier = b64u(random(48)); const bind = b64u(random(24))
    const redirectUri = rec.base + '/auth/connectors/callback'
    states.set(state, { userId: rec.userId, family: fam, ids: rec.ids, verifier, redirectUri, bind, app: rec.app, expiresAt: now() + STATE_TTL_MS })
    const q = new URLSearchParams({ client_id: k.id, response_type: 'code', redirect_uri: redirectUri, state })
    const scopes = scopesOf(rec.ids); if (scopes.length) q.set(f.scopeParam || 'scope', scopes.join(f.sep || ' '))
    if (f.pkce) { q.set('code_challenge', b64u(crypto.createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256') }
    for (const [a, b] of Object.entries(f.extra || {})) q.set(a, b)
    const hint = f.hint && browserUser.providers && browserUser.providers[fam] && browserUser.providers[fam].email; if (hint) q.set('login_hint', hint)
    // SameSite=Lax: the provider's redirect back is a top-level navigation, which carries it; other sites' requests do not
    return { redirect: endpoint(f, k, 'authorize') + '?' + q.toString(), cookie: `${bindCookie(state)}=${bind}; HttpOnly; SameSite=Lax; Path=/auth/connectors; Max-Age=${STATE_TTL_MS / 1000}${secure ? '; Secure' : ''}` }
  }

  // not signed in to this browser yet (usual after pressing Connect in the desktop app): sign in, then the site comes back to this link
  function signInFirst (ticket, provider) {
    const back = `/auth/connectors/go/${ticket}`
    return { status: 200, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=referrer content=no-referrer><title>VESPR connectors</title>
<body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0d;color:#eee;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">Sign in to VESPR first</h1><p>To connect ${esc(provider)}, sign in to VESPR in this browser with the same account you use in the app. You will come straight back here.</p>
<p><a id=go style="color:#93c5fd" href="/signin.html">Sign in</a></p></main>
<script>try{sessionStorage.setItem('vespr-after-signin',${JSON.stringify(back)})}catch(e){}</script>` }
  }

  async function tokenCall (fam, params) {
    const f = FAMILIES[fam]; const k = keys(fam); if (!k) throw new Error('not set up')
    const headers = { Accept: 'application/json' }; const p = { ...params }
    if (f.auth === 'basic') headers.Authorization = 'Basic ' + Buffer.from(`${k.id}:${k.secret}`).toString('base64')
    else { p.client_id = k.id; p.client_secret = k.secret }
    let body
    if (f.body === 'json') { headers['Content-Type'] = 'application/json'; body = JSON.stringify(p) } else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(p).toString() }
    const r = await request({ url: endpoint(f, k, 'token'), method: 'POST', headers, body })
    let j = {}; try { j = JSON.parse(r.text) } catch {}
    const t = f.tokens ? f.tokens(j) : j
    if (r.status >= 400 || j.ok === false || !t.access_token) throw new Error(clip(j.error_description || j.error || ('the provider said ' + r.status), 160))
    return { j, t }
  }

  // step 3, back from the provider: only in the browser VESPR marked in step 2 (the mark is cleared whatever happens)
  async function callback (q, cookies = {}) {
    const r = await finish(q, cookies)
    const state = String(q.get('state') || '')
    return state ? { ...r, cookie: `${bindCookie(state)}=; HttpOnly; SameSite=Lax; Path=/auth/connectors; Max-Age=0` } : r
  }
  async function finish (q, cookies) {
    const state = String(q.get('state') || ''); const rec = states.get(state); states.delete(state)
    if (!rec || rec.expiresAt <= now()) return page(false, 'This connect link has expired or was already used. Start again from VESPR.')
    const mark = String(cookies[bindCookie(state)] || '')
    if (!(mark.length === rec.bind.length && crypto.timingSafeEqual(Buffer.from(mark), Buffer.from(rec.bind)))) {
      audit({ user: rec.userId, family: rec.family, ids: rec.ids, event: 'refused_other_browser' })
      return page(false, 'This connection was not started in this browser, so nothing was saved. If you pressed Connect yourself, press it again in VESPR and finish in the browser that opens.')
    }
    const f = FAMILIES[rec.family]; const app = rec.app
    if (q.get('error')) { audit({ user: rec.userId, family: rec.family, ids: rec.ids, event: 'declined', why: clip(q.get('error'), 60) }); return page(false, `${f.name} did not connect: ${clip(q.get('error_description') || q.get('error'), 160)}. Nothing was changed.`) }
    const code = String(q.get('code') || ''); if (!code) return page(false, 'The provider did not send a code back. Start again from VESPR.')
    const user = getUser(rec.userId); if (!user) return page(false, 'That VESPR account no longer exists.')
    let j, t
    try { ({ j, t } = await tokenCall(rec.family, { grant_type: 'authorization_code', code, redirect_uri: rec.redirectUri, ...(f.pkce ? { code_verifier: rec.verifier } : {}) })) } catch (e) {
      audit({ user: rec.userId, family: rec.family, ids: rec.ids, event: 'failed', why: clip(e.message, 160) })
      return page(false, `${f.name} did not finish connecting (${esc(e.message)}). Nothing was saved.`)
    }
    // the scopes the provider actually granted, when it says (Google, Microsoft, GitHub, Slack, ... do); a connector counts only with all of its own
    const grantedRaw = t.scope !== undefined ? t.scope : j.scope
    const granted = grantedRaw === undefined ? null : new Set(String(grantedRaw).split(/[\s,]+/).filter(Boolean))
    const got = rec.ids.filter(id => !granted || BY_ID[id].scopes.every(s => granted.has(s)))
    const missed = rec.ids.filter(id => !got.includes(id))
    let account = f.label ? clip(f.label(j) || '', 120) || null : null
    if (!account && f.account) { try { const r = await request({ url: f.account.url, headers: { Authorization: 'Bearer ' + t.access_token, Accept: 'application/json', 'User-Agent': 'VESPR' } }); if (r.status < 400) account = clip(f.account.pick(JSON.parse(r.text)) || '', 120) || null } catch {} }
    const db = load(); const u = mine(db, rec.userId); const prev = u.families[rec.family]
    let old = {}; try { if (prev && prev.vault) old = open(prev.vault) } catch {}
    const tokens = { access_token: t.access_token, refresh_token: t.refresh_token || old.refresh_token || null, token_type: t.token_type || 'Bearer' }
    const all = new Set([...(prev && prev.scopes) || [], ...(granted ? [...granted] : scopesOf(got))])
    u.families[rec.family] = { vault: seal(tokens), scopes: [...all], account: account || (prev && prev.account) || null, connectedAt: (prev && prev.connectedAt) || now(), expiresAt: t.expires_in ? now() + Number(t.expires_in) * 1000 : null, broken: false }
    for (const id of got) u.connected[id] = { at: now() }
    u.dismissed = u.dismissed.filter(x => x !== rec.family)
    save(db)
    audit({ user: rec.userId, family: rec.family, event: 'connected', ids: got, missed, account })
    const names = got.map(id => BY_ID[id].name)
    if (!got.length) return page(false, `${f.name} answered, but did not allow what ${rec.ids.map(id => BY_ID[id].name).join(', ')} needs. Try again and leave the boxes ticked.`)
    return page(true, `Connected ${names.join(', ')}${account ? ' as ' + account : ''}.${missed.length ? ` Not allowed: ${missed.map(id => BY_ID[id].name).join(', ')}.` : ''}${app ? '' : ' You can close this tab and go back to VESPR.'}`, app)
  }

  // app: the desktop app's link scheme when Connect was pressed there: the page offers (and tries once) to switch back to the app,
  // which refreshes its Connectors list when it comes to the front
  function page (ok, text, app = null) {
    const back = ok && APPS.includes(app) ? `${app}://connected` : null
    return { status: ok ? 200 : 400, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=referrer content=no-referrer><title>VESPR connectors</title>
<body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0d;color:#eee;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">${ok ? 'Connected' : 'Not connected'}</h1><p>${esc(text)}</p>
${back ? `<p><a id=back style="display:inline-block;background:#1e40af;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none" href="${back}">Back to the VESPR app</a></p><p style="font-size:13px;color:#a1a1aa">Then you can close this tab.</p><script>setTimeout(function(){location.href=${JSON.stringify(back)}},600)</script>` : '<p><a style="color:#93c5fd" href="/app/">Open VESPR</a></p>'}</main>` }
  }

  // ── disconnect, dismiss ────────────────────────────────────────────────
  async function disconnect (user, id) {
    if (!BY_ID[id]) return { status: 400, body: { error: 'No such connector' } }
    const db = load(); const u = mine(db, user.id); const fam = BY_ID[id].family
    if (!u.connected[id]) return { status: 200, body: { ok: true, already: true } }
    delete u.connected[id]
    const left = Object.keys(u.connected).filter(x => BY_ID[x] && BY_ID[x].family === fam)
    let revoked = false
    if (!left.length && u.families[fam]) {
      const f = FAMILIES[fam]
      if (f.revoke) { try { const tok = open(u.families[fam].vault); const r = await request({ url: f.revoke, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.refresh_token || tok.access_token }).toString() }); revoked = r.status < 400 } catch {} }
      delete u.families[fam]
    }
    save(db); audit({ user: user.id, family: fam, event: 'disconnected', ids: [id], revoked })
    return { status: 200, body: { ok: true, revoked, forgotten: !left.length } }
  }
  function dismiss (user, fam) {
    if (!FAMILIES[fam]) return { status: 400, body: { error: 'No such provider' } }
    const db = load(); const u = mine(db, user.id); if (!u.dismissed.includes(fam)) u.dismissed.push(fam); save(db)
    return { status: 200, body: { ok: true } }
  }

  // ── for server code: a usable access token, refreshed when needed ────────
  async function tokenFor (userId, id) {
    const c = BY_ID[id]; if (!c) return null
    const db = load(); const u = mine(db, userId); const fam = u.families[c.family]
    if (!u.connected[id] || !fam || fam.broken) return null
    let tok; try { tok = open(fam.vault) } catch { return null }
    if (!fam.expiresAt || fam.expiresAt - now() > 60 * 1000) return tok.access_token
    if (!tok.refresh_token) return tok.access_token
    try {
      const { t } = await tokenCall(c.family, { grant_type: 'refresh_token', refresh_token: tok.refresh_token })
      fam.vault = seal({ ...tok, access_token: t.access_token, refresh_token: t.refresh_token || tok.refresh_token }); fam.expiresAt = t.expires_in ? now() + Number(t.expires_in) * 1000 : null
      save(db); return t.access_token
    } catch (e) { fam.broken = true; save(db); audit({ user: userId, family: c.family, event: 'refresh_failed', why: clip(e.message, 160) }); return null }
  }

  // ── HTTP (mounted by auth.js, which brings sign-in, CSRF and the JSON helpers) ──
  // cookieUser(req): the account signed in to this browser by its session cookie only (a navigation carries no Bearer header)
  async function http (req, res, u, { requireUser, parseBody, jsonResponse, baseUrl, cookieUser, cookies = {}, secure = false }) {
    const send = r => {
      const hdr = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(r.cookie ? { 'Set-Cookie': r.cookie } : {}) }
      if (r.redirect) { res.writeHead(302, { ...hdr, Location: r.redirect }); res.end(); return true }
      if (r.html) { res.writeHead(r.status, { ...hdr, 'Content-Type': 'text/html; charset=utf-8' }); res.end(r.html); return true }
      return jsonResponse(res, r.status, r.body), true
    }
    if (req.method === 'GET' && u.pathname === '/auth/connectors/callback') return send(await callback(u.searchParams, cookies))
    const g = /^\/auth\/connectors\/go\/([^/]+)$/.exec(u.pathname)
    if (req.method === 'GET' && g) return send(go(g[1], cookieUser ? cookieUser(req) : null, { secure }))
    if (req.method === 'GET' && u.pathname === '/auth/connectors') { const user = requireUser(req, res); if (!user) return true; return jsonResponse(res, 200, view(user)), true }
    const m = /^\/auth\/connectors\/(start|disconnect|dismiss)$/.exec(u.pathname)
    if (req.method === 'POST' && m) {
      const user = requireUser(req, res, { write: true }); if (!user) return true
      let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
      if (m[1] === 'start') return send(start(user, body.ids, baseUrl, { app: body.app }))
      if (m[1] === 'disconnect') return send(await disconnect(user, String(body.id || '')))
      return send(dismiss(user, String(body.family || '')))
    }
    return false
  }

  // account deleted or terminated (server/lifecycle.js): every connector disconnected, tokens revoked at the providers where they can be
  async function forgetAll (userId) {
    const db = load(); const ids = Object.keys(((db.users || {})[userId] || {}).connected || {})
    for (const id of ids) await disconnect({ id: userId }, id)
    const d2 = load(); if (d2.users) delete d2.users[userId]; save(d2)
    return ids.length
  }

  return { http, view, start, go, callback, disconnect, dismiss, tokenFor, forgetAll }
}
