// An account's life after sign-in (server/lifecycle.js, wired in auth.js, access.js and index.js): sessions that renew while used,
// security changes that sign out other devices, the daily check of company logins (same person, updated details, groups -> rights, admin
// lost, removed), termination and deletion cutting everything off, and the domain lock for companies and schools. Logins are faked.
import assert from 'node:assert'
import crypto from 'node:crypto'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'
import { applyRules, cleanRule } from '../work.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')
const DAY = 24 * 60 * 60 * 1000

function fakeWorld () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }
  const w = { claims: null, gh: { member: 'active', role: 'member', teams: [] }, calls: [] }
  const sign = c => { const h = b64u({ alg: 'RS256', kid: 'k1' }); const p = b64u(c); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url')}` }
  w.request = async ({ url, method, body }) => {
    w.calls.push({ url, method, body }); const j = (o, s = 200) => ({ status: s, text: JSON.stringify(o) })
    const m = /^(https:\/\/[^/]+)\/\.well-known\/openid-configuration$/.exec(url)
    if (m) return j({ issuer: m[1], authorization_endpoint: m[1] + '/authorize', token_endpoint: m[1] + '/token', jwks_uri: m[1] + '/keys' })
    if (/\/keys$/.test(url)) return j({ keys: [jwk] })
    if (/okta\.com\/token$/.test(url)) {
      const p = new URLSearchParams(body)
      if (p.get('grant_type') === 'refresh_token' && w.revoked) return j({ error: 'invalid_grant' }, 400)
      const c = { ...w.claims, exp: Math.floor((w.now ? w.now() : Date.now()) / 1000) + 300 }; if (p.get('grant_type') === 'refresh_token') delete c.nonce
      return j({ id_token: sign(c), access_token: 'at', refresh_token: 'rt-' + w.calls.length })
    }
    if (url === 'https://github.com/login/oauth/access_token') return j({ access_token: 'gh-token' })
    if (url === 'https://api.github.com/user') return w.gh.revoked ? j({}, 401) : j({ id: 77, login: 'pat', name: 'Pat' })
    if (url === 'https://api.github.com/user/memberships/orgs/initech') return w.gh.member ? j({ state: w.gh.member, role: w.gh.role }) : j({}, 404)
    if (url === 'https://api.github.com/user/emails') return j([{ email: 'pat@initech.com', primary: true, verified: true }])
    if (url === 'https://api.github.com/user/teams') return j(w.gh.teams.map(slug => ({ slug, organization: { login: 'initech' } })))
    return j({}, 404)
  }
  return w
}
const COMPANIES = (extra = {}) => JSON.stringify([
  { id: 'acme', name: 'Acme', domains: ['acme.com'], login: 'okta', issuer: 'https://acme.okta.com', clientId: 'acme-client', secretEnv: 'VESPR_SSO_ACME_SECRET', scopes: ['groups'], ...extra,
    rules: [{ when: { group: 'eng' }, give: { room: 'acme-core', path: 'src/', rights: ['view', 'edit', 'make'] } }, { when: { group: 'leads' }, give: { role: 'admin' } }, { when: { everyone: true }, give: { room: 'acme-core', path: '', rights: ['view'] } }] },
  { id: 'initech', name: 'Initech', domains: ['initech.com'], login: 'github', githubOrg: 'initech', rules: [{ when: { group: 'platform' }, give: { room: 'initech-app', path: '', rights: ['view', 'edit'] } }] }
])

async function world ({ companies = COMPANIES(), schools, clock } = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-')); const w = fakeWorld(); let tnow = clock ? clock() : Date.now()
  const google = { authorizeUrl: ({ state }) => 'https://g.example/auth?state=' + state, exchange: async () => w.googleProfile }
  const classlink = { authorizeUrl: ({ state }) => 'https://cl.example/auth?state=' + state, exchange: async () => w.classlinkProfile }
  const auth = createAuth({ DATA, identifyToken: () => null, now: () => tnow, workRequest: w.request, oauthProviders: { google, classlink }, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_COMPANIES: companies, ...(schools ? { VESPR_SCHOOLS: schools } : {}), VESPR_SSO_ACME_SECRET: 's', VESPR_AUTH_GITHUB_ID: 'gh', VESPR_AUTH_GITHUB_SECRET: 'ghs', VESPR_AUTH_ALLOWED_NEXT: '/account.html' } })
  w.now = () => tnow; const grantsSeen = []; auth.lifecycle.onGrants(e => grantsSeen.push(e))
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; let ip = 0
  const call = async (p, body, tok) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.6.0.' + (++ip % 250), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
  const viaWork = async (company, claims) => {
    const s = await fetch(base + `/auth/start/work/${company}?next=/account.html`, { redirect: 'manual' })
    if (s.status !== 302) return { status: s.status }
    const to = new URL(s.headers.get('location')); const state = to.searchParams.get('state')
    if (claims) w.claims = { iss: 'https://acme.okta.com', aud: 'acme-client', nonce: to.searchParams.get('nonce'), ...claims }
    const cb = await fetch(base + '/auth/callback/work?' + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: { cookie: 'vespr_work_state=' + state } })
    return { status: cb.status, to, token: (cb.headers.get('location') || '').split('#token=')[1], body: cb.status === 302 ? null : await cb.json() }
  }
  const viaOAuth = async provider => {
    const s = await fetch(base + `/auth/start/${provider}?next=/account.html`, { redirect: 'manual' }); const state = new URL(s.headers.get('location')).searchParams.get('state')
    const cb = await fetch(base + `/auth/callback/${provider}?` + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: { cookie: 'vespr_oauth_state=' + state } })
    return { status: cb.status, token: (cb.headers.get('location') || '').split('#token=')[1], body: cb.status === 302 ? null : await cb.json() }
  }
  const register = async (email, name) => { await call('/auth/register', { email, password: 'a-long-password-1', name }); return (await call('/auth/login', { email, password: 'a-long-password-1' })) }
  return { DATA, w, auth, call, viaWork, viaOAuth, register, grantsSeen, tick: ms => { tnow += ms }, close: () => { srv.close(); fs.rmSync(DATA, { recursive: true, force: true }) } }
}

await t('company rules: groups and roles become rights; never "manage"; bad rules dropped', () => {
  assert.strictEqual(cleanRule({ when: { group: 'x' }, give: { room: 'r1', path: '', rights: ['manage'] } }), null)
  assert.strictEqual(cleanRule({ when: { group: 'x' }, give: { room: '../etc', rights: ['view'] } }), null)
  const co = JSON.parse(COMPANIES())[0]; co.rules = co.rules.map(cleanRule)
  assert.deepStrictEqual(applyRules(co, { groups: ['eng', 'leads'] }), { role: 'admin', grants: [{ room: 'acme-core', path: 'src/', rights: ['make', 'view', 'edit'] }, { room: 'acme-core', path: '', rights: ['view'] }] })
  assert.deepStrictEqual(applyRules(co, { groups: [] }), { role: 'member', grants: [{ room: 'acme-core', path: '', rights: ['view'] }] })
})

await t('sessions renew while used (a year in the app, 30 days in a browser); closed accounts have none', async () => {
  const W = await world(); const login = await W.register('ann@example.test', 'Ann')
  const tok = login.j.token
  W.tick(20 * DAY); assert.ok(W.auth.getSessionUser(tok), 'still in after 20 days')
  W.tick(20 * DAY); assert.ok(W.auth.getSessionUser(tok), 'used at day 20, so renewed: still in at day 40')
  W.tick(31 * DAY); assert.strictEqual(W.auth.getSessionUser(tok), null, 'a browser left unused for 31 days signs in again')
  W.close()
})

await t('a security change signs out every other device and keeps the one where it was made', async () => {
  const W = await world(); const a = (await W.register('bo@example.test', 'Bo')).j.token
  const b = (await W.call('/auth/login', { email: 'bo@example.test', password: 'a-long-password-1' })).j.token
  const me = W.auth.getSessionUser(a)
  const out = W.auth.lifecycle.securityChange(me.id, 'test', { keep: crypto.createHash('sha256').update(a).digest('hex') })
  assert.strictEqual(out, 1); assert.ok(W.auth.getSessionUser(a)); assert.strictEqual(W.auth.getSessionUser(b), null)
  W.close()
})

await t('the daily check: same person -> details and rights updated; admin lost -> signed out; removed -> company access ends', async () => {
  const W = await world()
  const r = await W.viaWork('acme', { sub: 'okta-1', email: 'sam@acme.com', name: 'Sam', groups: ['eng', 'leads'] })
  assert.strictEqual(r.status, 302); assert.match(r.to.searchParams.get('scope'), /offline_access/); assert.match(r.to.searchParams.get('scope'), /groups/)
  let u = W.auth.getSessionUser(r.token)
  assert.deepStrictEqual([u.work.role, u.work.groups, u.work.grants.length], ['admin', ['eng', 'leads'], 2])
  assert.deepStrictEqual(W.grantsSeen.at(-1).grants.map(g => g.path), ['src/', ''])
  const raw = fs.readFileSync(path.join(W.DATA, 'auth', 'work-tokens.json'), 'utf8'); assert.ok(!raw.includes('rt-'), 'the lasting access is sealed')
  // a day later: renamed, moved out of leads: rights narrowed, admin lost = a security change
  W.w.claims = { iss: 'https://acme.okta.com', aud: 'acme-client', sub: 'okta-1', email: 'sam.lee@acme.com', name: 'Sam Lee', groups: ['eng'] }
  W.tick(DAY + 1000)
  const s1 = await W.auth.lifecycle.recheckAll(); assert.deepStrictEqual([s1.checked, s1.ok], [1, 1])
  u = Object.values(W.auth.getUsers())[0]
  assert.deepStrictEqual([u.name, u.email, u.work.role], ['Sam Lee', 'sam.lee@acme.com', 'member'])
  assert.strictEqual(W.auth.getSessionUser(r.token), null, 'admin lost: signed out')
  assert.deepStrictEqual(W.grantsSeen.at(-1).previousWho, 'Sam', 'grants under the old name are cleared')
  assert.strictEqual((await W.auth.lifecycle.recheckAll()).checked, 0, 'once a day')
  // removed at Acme: the company's access ends; this account only existed through Acme, so it is closed
  const again = await W.viaWork('acme', { sub: 'okta-1', email: 'sam.lee@acme.com', name: 'Sam Lee', groups: ['eng'] })
  W.w.revoked = true; W.tick(DAY + 1000)
  const s2 = await W.auth.lifecycle.recheckAll(); assert.strictEqual(s2.ended, 1)
  u = Object.values(W.auth.getUsers())[0]
  assert.deepStrictEqual([u.activation, W.auth.getSessionUser(again.token)], ['suspended', null])
  assert.deepStrictEqual(W.grantsSeen.at(-1).grants, [], 'its rights are taken away')
  W.w.revoked = false
  assert.strictEqual((await W.viaWork('acme', { sub: 'okta-1', email: 'sam.lee@acme.com', name: 'Sam Lee', groups: [] })).status, 403, 'a closed account cannot sign in again')
  W.close()
})

await t('GitHub organization: teams become rights; leaving the org ends the company access but keeps a personal account', async () => {
  const W = await world()
  const own = await W.register('pat@initech.com', 'Pat')
  W.w.gh = { member: 'active', role: 'member', teams: ['platform'] }
  const r = await W.viaWork('initech')
  const u = W.auth.getSessionUser(r.token); assert.strictEqual(u.id, Object.values(W.auth.getUsers()).find(x => x.email === 'pat@initech.com').id, 'linked to the existing account (Initech owns the domain)')
  assert.deepStrictEqual(u.work.grants, [{ room: 'initech-app', path: '', rights: ['view', 'edit'] }])
  W.w.gh.member = null; W.tick(DAY + 1000)
  assert.strictEqual((await W.auth.lifecycle.recheckAll()).ended, 1)
  const after = Object.values(W.auth.getUsers())[0]
  assert.deepStrictEqual([after.activation || 'active', after.work, W.auth.getSessionUser(own.j.token)], ['active', undefined, null], 'personal account kept, devices signed out')
  W.close()
})

await t('deletion: everything cut off, sign-in methods removed, the email freed, sponsored kids back to waiting', async () => {
  const W = await world()
  const adult = (await W.register('mom@example.test', 'Mom')).j.token
  await W.call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, adult)
  const users = W.auth.getUsers(); const mom = Object.values(users).find(u => u.email === 'mom@example.test')
  const kidId = 'kid1'; users[kidId] = { id: kidId, name: 'Kid', email: null, sponsor: { required: true, state: 'approved', by: { id: mom.id, name: 'Mom', role: 'parent' } }, guardian: { state: 'verified', method: 'parent_approval', by: mom.id }, providers: {} }
  users[mom.id].sponsoring = [kidId]; fs.writeFileSync(path.join(W.DATA, 'auth', 'users.json'), JSON.stringify(users))
  assert.strictEqual((await W.call('/auth/account/delete', { confirm: 'nope' }, adult)).s, 400)
  assert.strictEqual((await W.call('/auth/account/delete', { confirm: 'delete' }, adult)).s, 200)
  assert.strictEqual(W.auth.getSessionUser(adult), null)
  assert.strictEqual((await W.call('/auth/login', { email: 'mom@example.test', password: 'a-long-password-1' })).s, 401, 'the old password no longer opens anything')
  const after = W.auth.getUsers(); assert.deepStrictEqual([after[mom.id].activation, after[mom.id].email, after[kidId].sponsor.state, after[kidId].guardian.state], ['deletion_requested', null, 'pending', 'required_pending'])
  assert.strictEqual((await W.register('mom@example.test', 'Mom Again')).s, 200, 'the email can start a new account')
  W.close()
})

await t('domain lock (company): only the company login works for its domain; earlier accounts stop until they use it', async () => {
  const W = await world({ companies: COMPANIES() })
  const old = await W.register('lee@acme.com', 'Lee'); assert.strictEqual(old.s, 200, 'before the lock')
  W.close()
  const L = await world({ companies: COMPANIES({ enforce: true }) })
  assert.match((await L.call('/auth/register', { email: 'new@acme.com', password: 'a-long-password-1', name: 'New' })).j.error, /Acme asks everyone/)
  // an account made before the lock: password sign-in refused; once signed in some other way it is held at org_login_required
  const users = L.auth.getUsers(); users.x1 = { id: 'x1', email: 'lee@acme.com', name: 'Lee', emailVerified: true, providers: {}, age: { claims: [{ band: 'adult', source: 'self_declared' }] } }
  fs.writeFileSync(path.join(L.DATA, 'auth', 'users.json'), JSON.stringify(users))
  L.w.googleProfile = { id: 'g-lee', email: 'lee@acme.com', name: 'Lee', emailVerified: true }
  assert.strictEqual((await L.viaOAuth('google')).status, 403, 'Google with an Acme email is refused')
  const viaAcme = await L.viaWork('acme', { sub: 'okta-lee', email: 'lee@acme.com', name: 'Lee', groups: [] })
  assert.strictEqual(viaAcme.status, 302); const facts = (await L.call('/auth/account/facts', null, viaAcme.token)).j
  assert.notStrictEqual(facts.state, 'org_login_required', 'linked to the Acme login: fine')
  const tok = L.auth.lifecycle; const lee = L.auth.getUsers().x1; delete lee.providers['work:acme']
  assert.ok(tok.lockState(lee), 'without the Acme link it would be held')
  L.close()
})

await t('domain lock (school): only the school\'s own sign-in works for its domain', async () => {
  const W = await world({ schools: JSON.stringify([{ name: 'Lincoln High', domains: ['lincolnhs.org'], provider: 'classlink', enforce: true }]) })
  W.w.googleProfile = { id: 'g-kid', email: 'kid@lincolnhs.org', name: 'Kid', emailVerified: true }
  assert.match((await W.viaOAuth('google')).body.error, /Lincoln High asks everyone/)
  W.w.classlinkProfile = { id: 't1:9', email: 'kid@lincolnhs.org', name: 'Kid', emailVerified: false, staff: false }
  assert.strictEqual((await W.viaOAuth('classlink')).status, 302)
  W.close()
})

await t('company grants in a workspace: tagged, replaced by the next check, never touching grants people gave', async () => {
  const { createAccess } = await import('../access.js')
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-acl-'))
  fs.mkdirSync(path.join(DATA, 'access'), { recursive: true })
  fs.writeFileSync(path.join(DATA, 'access', 'acme-core.json'), JSON.stringify({ owner: 'Boss', grants: [{ who: 'Sam', path: 'docs/', rights: ['view'] }] }))
  const access = createAccess({ DATA, identify: () => null, Y: {}, getDoc: () => null })
  assert.strictEqual(access.setManaged('acme-core', 'company:acme', 'Sam', [{ path: 'src/', rights: ['view', 'edit', 'manage'] }]), true)
  assert.deepStrictEqual(access.aclOf('acme-core').grants, [{ who: 'Sam', path: 'docs/', rights: ['view'] }, { who: 'Sam', path: 'src/', rights: ['view', 'edit'], source: 'company:acme' }], 'manage is never given by a company rule')
  access.setManaged('acme-core', 'company:acme', 'Sam', [])
  assert.deepStrictEqual(access.aclOf('acme-core').grants, [{ who: 'Sam', path: 'docs/', rights: ['view'] }])
  assert.strictEqual(access.setManaged('open-room', 'company:acme', 'Sam', [{ path: '', rights: ['view'] }]), false, 'an open workspace needs no grant')
  fs.rmSync(DATA, { recursive: true, force: true })
})

console.log(`account lifecycle tests passed (${n})`)
