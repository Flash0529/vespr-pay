// Connectors (server/connectors.js): the catalog per person; the three steps of a connect (a one-time VESPR link, the VESPR page that
// checks the browser's account and marks the browser, the provider's return accepted only in that browser); the vault, refresh,
// disconnect, the after-sign-in suggestion, the way back into the desktop app, and the HTTP routes through auth.js.
// Providers are faked; nothing leaves this machine.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createConnectors, CONNECTORS } from '../connectors.js'
import { createAuth } from '../auth.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'connectors-'))
const GOOGLE = { VESPR_AUTH_GOOGLE_ID: 'gid', VESPR_AUTH_GOOGLE_SECRET: 'gsecret' }
const BASE = 'https://v.test'
const ann = { id: 'u1', name: 'Ann', email: 'ann@example.test', providers: { google: { id: 'g1', email: 'ann@gmail.com' } } }
const mal = { id: 'u9', name: 'Mal', email: 'mal@example.test', providers: {} }

// the three steps as the person's browser does them; returns what the provider would be sent to, and the browser's cookies
function begin (c, user, ids, opts = {}) {
  const s = c.start(user, ids, BASE, opts); if (s.status !== 200) return { s }
  const ticket = s.body.url.slice((BASE + '/auth/connectors/go/').length)
  const g = c.go(ticket, opts.browser === undefined ? user : opts.browser, { secure: true })
  if (!g.redirect) return { s, g, ticket }
  const url = new URL(g.redirect); const [name, val] = g.cookie.split(';')[0].split('=')
  return { s, g, ticket, url, state: url.searchParams.get('state'), cookies: { [name]: val } }
}
const back = (c, b, extra = {}, cookies = b.cookies) => c.callback(new URLSearchParams({ state: b.state, code: 'C', ...extra }), cookies)

// a fake provider: records every call; answers token, userinfo and revoke calls
function fakeProvider ({ scope, fail = false } = {}) {
  const calls = []; let issued = 0
  const request = async req => {
    calls.push(req)
    if (/token$|oauth\.v2\.access$/.test(req.url)) {
      if (fail) return { status: 400, text: JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) }
      issued++
      if (/slack/.test(req.url)) return { status: 200, text: JSON.stringify({ ok: true, team: { name: 'Acme' }, authed_user: { access_token: 'xoxp-' + issued, scope: 'channels:read,channels:history,chat:write,search:read' } }) }
      return { status: 200, text: JSON.stringify({ access_token: 'AT-' + issued, refresh_token: issued === 1 ? 'RT-1' : undefined, expires_in: 3600, token_type: 'Bearer', ...(scope !== undefined ? { scope } : {}) }) }
    }
    if (/userinfo$/.test(req.url)) return { status: 200, text: JSON.stringify({ email: 'ann@gmail.com' }) }
    if (/revoke$/.test(req.url)) return { status: 200, text: '' }
    return { status: 404, text: '{}' }
  }
  return { calls, request }
}

await t('no keys: every connector says not set up, and none can start', async () => {
  const c = createConnectors({ DATA: tmp(), config: {}, getUser: () => ann })
  const v = c.view(ann)
  assert.strictEqual(v.connectors.length, CONNECTORS.length)
  assert.ok(v.connectors.every(x => x.status === 'not_set_up' && /operator/.test(x.note)))
  assert.deepStrictEqual(v.suggest, [], 'nothing to suggest without keys')
  assert.strictEqual(c.start(ann, ['google_drive'], BASE).status, 409)
})

await t('Google keys: Google services available, the rest not set up, and a suggestion after Google sign-in', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann })
  const v = c.view(ann)
  assert.deepStrictEqual(v.connectors.filter(x => x.status === 'available').map(x => x.id).sort(), ['gmail', 'google_calendar', 'google_classroom', 'google_drive'])
  assert.strictEqual(v.connectors.find(x => x.id === 'slack').status, 'not_set_up')
  assert.deepStrictEqual(v.suggest.map(s => [s.family, s.ids.length]), [['google', 4]])
  c.dismiss(ann, 'google')
  assert.deepStrictEqual(c.view(ann).suggest, [], '"not now" sticks')
})

await t('step 1: the app gets a one-time VESPR link, never the provider\'s', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann })
  const s = c.start(ann, ['google_drive'], BASE)
  assert.strictEqual(s.status, 200); assert.match(s.body.url, /^https:\/\/v\.test\/auth\/connectors\/go\/[A-Za-z0-9_-]{32}$/); assert.ok(!/google\.com/.test(s.body.url))
  assert.strictEqual(c.start(ann, ['google_drive', 'github'], BASE).status, 400, 'one provider at a time')
  assert.strictEqual(c.start(ann, ['nope'], BASE).status, 400)
})

await t('step 2: same account in the browser -> the provider, with one consent, PKCE, offline access, a hint; the browser is marked', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann })
  const b = begin(c, ann, ['google_drive', 'google_calendar'])
  assert.strictEqual(b.url.origin + b.url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.strictEqual(b.url.searchParams.get('client_id'), 'gid'); assert.strictEqual(b.url.searchParams.get('redirect_uri'), 'https://v.test/auth/connectors/callback')
  const sc = b.url.searchParams.get('scope').split(' ')
  for (const s of ['openid', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/calendar.events']) assert.ok(sc.includes(s), s)
  assert.ok(!sc.some(s => /gmail/.test(s)), 'only what was asked for')
  assert.strictEqual(b.url.searchParams.get('code_challenge_method'), 'S256'); assert.strictEqual(b.url.searchParams.get('access_type'), 'offline')
  assert.strictEqual(b.url.searchParams.get('login_hint'), 'ann@gmail.com'); assert.ok(!b.url.searchParams.has('client_secret'))
  assert.match(b.g.cookie, /^vespr_connect_[A-Za-z0-9_-]{12}=[A-Za-z0-9_-]{32}; HttpOnly; SameSite=Lax; Path=\/auth\/connectors; Max-Age=600; Secure$/)
  assert.match(c.go(b.ticket, ann).html, /expired or was already used/, 'the VESPR link works once')
})

await t('step 2: not signed in to the browser -> sign in first and come back; another account -> refused', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann })
  const s = c.start(ann, ['google_drive'], BASE); const ticket = s.body.url.split('/go/')[1]
  const first = c.go(ticket, null)
  assert.strictEqual(first.status, 200); assert.match(first.html, /Sign in to VESPR first/); assert.ok(first.html.includes(`sessionStorage.setItem('vespr-after-signin',"/auth/connectors/go/${ticket}")`)); assert.ok(!first.redirect)
  const other = c.go(ticket, mal)
  assert.strictEqual(other.status, 400); assert.match(other.html, /different VESPR account/); assert.ok(!other.redirect, 'no provider link for another account')
  assert.ok(c.go(ticket, ann).redirect, 'still good for the right account after signing in')
})

await t('the attack: someone forwards their provider link; the victim\'s Allow saves nothing', async () => {
  const fp = fakeProvider({}); const DATA = tmp()
  const c = createConnectors({ DATA, config: GOOGLE, getUser: id => (id === mal.id ? mal : ann), request: fp.request })
  const b = begin(c, mal, ['google_drive']) // the attacker's own browser does steps 1 and 2 and copies the provider link
  const r = await back(c, b, {}, {}) // the victim's browser comes back from Google without the attacker's mark
  assert.strictEqual(r.status, 400); assert.match(r.html, /not started in this browser/)
  assert.ok(!fp.calls.some(x => /token$/.test(x.url)), 'the code is never even traded')
  assert.match(r.cookie, /Max-Age=0/)
  assert.ok(c.view(mal).connectors.every(x => x.status !== 'connected'))
  const b2 = begin(c, mal, ['google_drive'])
  assert.strictEqual((await back(c, b2, {}, { [Object.keys(b2.cookies)[0]]: 'x'.repeat(32) })).status, 400, 'a guessed mark fails too')
})

await t('minors cannot connect mail; accounts that are not admitted cannot connect at all', async () => {
  const kid = { ...ann, id: 'k1' }
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => kid, isMinor: () => true })
  assert.strictEqual(c.view(kid).connectors.find(x => x.id === 'gmail').status, 'not_for_account')
  assert.strictEqual(c.start(kid, ['gmail'], BASE).body.code, 'adults_only')
  assert.strictEqual(c.start(kid, ['google_drive'], BASE).status, 200, 'files are fine')
  const c2 = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann, mayConnect: () => 'Finish setting up your account first' })
  assert.strictEqual(c2.start(ann, ['google_drive'], BASE).body.code, 'not_admitted')
})

await t('step 3: tokens sealed in the vault, only granted connectors count, account named, state single-use, mark cleared', async () => {
  const DATA = tmp(); const fp = fakeProvider({ scope: 'openid email https://www.googleapis.com/auth/drive.file' })
  const c = createConnectors({ DATA, config: GOOGLE, getUser: () => ann, request: fp.request })
  const b = begin(c, ann, ['google_drive', 'gmail'])
  const r = await back(c, b, { code: 'C1' })
  assert.strictEqual(r.status, 200); assert.match(r.html, /Connected Google Drive as ann@gmail\.com/); assert.match(r.html, /Not allowed: Gmail/)
  assert.match(r.cookie, new RegExp('^' + Object.keys(b.cookies)[0] + '=; .*Max-Age=0'))
  const tokenCall = fp.calls.find(x => /oauth2\.googleapis\.com\/token$/.test(x.url)); const p = new URLSearchParams(tokenCall.body)
  assert.strictEqual(p.get('code'), 'C1'); assert.ok(p.get('code_verifier')); assert.strictEqual(p.get('redirect_uri'), 'https://v.test/auth/connectors/callback')
  const v = c.view(ann)
  assert.deepStrictEqual([v.connectors.find(x => x.id === 'google_drive').status, v.connectors.find(x => x.id === 'google_drive').account], ['connected', 'ann@gmail.com'])
  assert.strictEqual(v.connectors.find(x => x.id === 'gmail').status, 'available')
  const raw = fs.readFileSync(path.join(DATA, 'auth', 'connections.json'), 'utf8')
  assert.ok(!raw.includes('AT-1') && !raw.includes('RT-1'), 'no token in plain text')
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(DATA, 'auth', 'connections.json')).mode & 0o777, 0o600)
  assert.match((await back(c, b)).html, /expired or was already used/)
  assert.match(fs.readFileSync(path.join(DATA, 'auth', 'connections.log.jsonl'), 'utf8'), /"event":"connected"/)
})

await t('back into the desktop app: a start from the app gets a "Back to the VESPR app" link to its own scheme; unknown schemes are ignored', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann, request: fakeProvider({}).request })
  const r = await back(c, begin(c, ann, ['google_drive'], { app: 'vespr-test' }))
  assert.match(r.html, /href="vespr-test:\/\/connected"/); assert.match(r.html, /Back to the VESPR app/)
  const w = await back(c, begin(c, ann, ['google_calendar'], { app: 'javascript' }))
  assert.ok(!/javascript:\/\//.test(w.html) && /Open VESPR/.test(w.html), 'web: no app link')
})

await t('declined or failed at the provider: nothing saved, said plainly', async () => {
  const c = createConnectors({ DATA: tmp(), config: GOOGLE, getUser: () => ann, request: fakeProvider({ fail: true }).request })
  assert.match((await back(c, begin(c, ann, ['google_drive']), { error: 'access_denied' })).html, /did not connect: access_denied/)
  const r = await back(c, begin(c, ann, ['google_drive']))
  assert.strictEqual(r.status, 400); assert.match(r.html, /Token has been expired or revoked/)
  assert.ok(c.view(ann).connectors.every(x => x.status !== 'connected'))
})

await t('tokenFor: current token, refresh when it is about to expire, needs_reconnect when the provider refuses', async () => {
  let clock = 1_000_000; const fp = fakeProvider({})
  const DATA = tmp(); const c = createConnectors({ DATA, config: GOOGLE, getUser: () => ann, request: fp.request, now: () => clock })
  await back(c, begin(c, ann, ['google_drive']))
  assert.strictEqual(await c.tokenFor(ann.id, 'google_drive'), 'AT-1')
  assert.strictEqual(await c.tokenFor(ann.id, 'gmail'), null, 'not connected')
  clock += 3590 * 1000
  assert.strictEqual(await c.tokenFor(ann.id, 'google_drive'), 'AT-2', 'refreshed')
  assert.strictEqual(new URLSearchParams(fp.calls.filter(x => /token$/.test(x.url)).pop().body).get('refresh_token'), 'RT-1', 'the refresh token is kept when the provider sends none')
  const bad = createConnectors({ DATA, config: GOOGLE, getUser: () => ann, request: fakeProvider({ fail: true }).request, now: () => clock + 7200 * 1000 })
  assert.strictEqual(await bad.tokenFor(ann.id, 'google_drive'), null)
  assert.strictEqual(bad.view(ann).connectors.find(x => x.id === 'google_drive').status, 'needs_reconnect')
})

await t('disconnect: the token is revoked and forgotten when the provider\'s last connector goes', async () => {
  const fp = fakeProvider({}); const DATA = tmp()
  const c = createConnectors({ DATA, config: GOOGLE, getUser: () => ann, request: fp.request })
  await back(c, begin(c, ann, ['google_drive', 'google_calendar']))
  const a = await c.disconnect(ann, 'google_drive'); assert.deepStrictEqual([a.body.forgotten, a.body.revoked], [false, false], 'Calendar still uses it')
  assert.strictEqual(await c.tokenFor(ann.id, 'google_calendar'), 'AT-1')
  const b = await c.disconnect(ann, 'google_calendar'); assert.deepStrictEqual([b.body.forgotten, b.body.revoked], [true, true])
  assert.ok(fp.calls.some(x => /revoke$/.test(x.url)))
  assert.ok(!JSON.parse(fs.readFileSync(path.join(DATA, 'auth', 'connections.json'), 'utf8')).users.u1.families.google)
})

await t('Slack: user scopes, comma separated, the user token from authed_user, the workspace as the account', async () => {
  const fp = fakeProvider({})
  const c = createConnectors({ DATA: tmp(), config: { VESPR_CONNECT_SLACK_ID: 'sid', VESPR_CONNECT_SLACK_SECRET: 'ss' }, getUser: () => ann, request: fp.request })
  const b = begin(c, ann, ['slack'])
  assert.strictEqual(b.url.searchParams.get('user_scope'), 'channels:read,channels:history,chat:write,search:read'); assert.ok(!b.url.searchParams.has('scope'))
  assert.match((await back(c, b)).html, /Connected Slack as Acme/)
  assert.strictEqual(await c.tokenFor(ann.id, 'slack'), 'xoxp-1')
})

await t('HTTP through auth.js: start -> the VESPR page (signed-in browser only) -> the provider -> back, marked browser only', async () => {
  const DATA = tmp(); const fp = fakeProvider({})
  const auth = createAuth({ DATA, identifyToken: () => null, connectorRequest: fp.request, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_TERMS_SHA256: 'a'.repeat(64), ...GOOGLE } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; let ip = 0
  const call = async (p, body, tok, cookie) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.3.0.' + (++ip), ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) }); const text = await r.text(); let j = {}; try { j = JSON.parse(text) } catch {} return { s: r.status, j, text, h: r.headers } }
  await call('/auth/register', { email: 'bo@example.test', password: 'a-long-password-1', name: 'Bo' })
  const login = await call('/auth/login', { email: 'bo@example.test', password: 'a-long-password-1' }); const tok = login.j.token
  const session = (login.h.get('set-cookie') || '').split(';')[0]; assert.match(session, /^vespr_session=/)
  assert.strictEqual((await call('/auth/connectors')).s, 401)
  assert.strictEqual((await call('/auth/connectors/start', { ids: ['google_drive'] }, tok)).j.code, 'not_admitted', 'age and Terms first')
  await call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, tok)
  assert.strictEqual((await call('/auth/connectors', null, tok)).j.connectors.find(x => x.id === 'google_drive').status, 'available')
  const st = await call('/auth/connectors/start', { ids: ['google_drive'], app: 'vespr' }, tok); assert.strictEqual(st.s, 200)
  const goPath = new URL(st.j.url).pathname
  const anon = await call(goPath); assert.strictEqual(anon.s, 200); assert.match(anon.text, /Sign in to VESPR first/)
  const gone = await call(goPath, null, null, session); assert.strictEqual(gone.s, 302)
  const prov = new URL(gone.h.get('location')); assert.ok(prov.searchParams.get('redirect_uri').endsWith('/auth/connectors/callback'))
  const mark = (gone.h.get('set-cookie') || '').split(';')[0]; assert.match(mark, /^vespr_connect_/)
  const q = '/auth/connectors/callback?' + new URLSearchParams({ state: prov.searchParams.get('state'), code: 'C' })
  const cb = await call(q, null, null, mark)
  assert.strictEqual(cb.s, 200); assert.match(cb.text, /Connected Google Drive/); assert.match(cb.text, /vespr:\/\/connected/)
  assert.strictEqual((await call('/auth/connectors', null, tok)).j.connectors.find(x => x.id === 'google_drive').status, 'connected')
  assert.strictEqual(await auth.connectors.tokenFor(Object.values(auth.getUsers())[0].id, 'google_drive'), 'AT-1')
  assert.strictEqual((await call('/auth/connectors/disconnect', { id: 'google_drive' }, tok)).j.forgotten, true)
  srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
})

console.log(`connectors tests passed (${n})`)
