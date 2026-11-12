// Work sign-in (server/work.js + auth.js): company logins over OpenID Connect (Okta-style, Entra for one tenant, Google Workspace with hd),
// and GitHub organization membership. The companies and GitHub are faked; nothing leaves this machine.
import assert from 'node:assert'
import crypto from 'node:crypto'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { readCompanies } from '../work.js'
import { createAuth } from '../auth.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')
const TID = '11111111-2222-3333-4444-555555555555'
const COMPANIES = JSON.stringify([
  { id: 'acme', name: 'Acme', domains: ['acme.com'], login: 'okta', issuer: 'https://acme.okta.com', clientId: 'acme-client', secretEnv: 'VESPR_SSO_ACME_SECRET' },
  { id: 'contoso', name: 'Contoso', domains: ['contoso.com'], login: 'entra', tenantId: TID },
  { id: 'globex', name: 'Globex', domains: ['globex.com'], login: 'google-workspace' },
  { id: 'initech', name: 'Initech', domains: ['initech.com'], login: 'github', githubOrg: 'initech' },
  { id: 'nosecret', name: 'No Secret', domains: ['nosecret.com'], login: 'okta', issuer: 'https://ns.okta.com', clientId: 'x', secretEnv: 'VESPR_SSO_MISSING' }
])

// one fake world: three OIDC issuers sharing a key, plus GitHub
function fakeWorld () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256' }
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const w = { claims: null, key: privateKey, gh: { member: 'active', role: 'member', email: 'pat@initech.com' }, calls: [] }
  const sign = (c, key) => { const h = b64u({ alg: 'RS256', kid: 'k1' }); const p = b64u(c); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url')}` }
  w.other = other
  w.request = async ({ url, method, body }) => {
    w.calls.push({ url, method, body })
    const j = (o, s = 200) => ({ status: s, text: JSON.stringify(o) })
    const m = /^(https:\/\/[^/]+(?:\/[^/]+\/v2\.0)?)\/\.well-known\/openid-configuration$/.exec(url)
    if (m) return j({ issuer: m[1], authorization_endpoint: m[1] + '/authorize', token_endpoint: m[1] + '/token', jwks_uri: m[1] + '/keys' })
    if (/\/keys$/.test(url)) return j({ keys: [jwk] })
    if (/\/token$/.test(url)) return w.claims ? j({ id_token: sign(w.claims, w.key), access_token: 'at', refresh_token: 'rt' }) : j({ error: 'invalid_grant' }, 400)
    if (url === 'https://github.com/login/oauth/access_token') return j({ access_token: 'gh-token' })
    if (url === 'https://api.github.com/user') return j({ id: 4242, login: 'pat', name: 'Pat Ghithub' })
    if (url === 'https://api.github.com/user/memberships/orgs/initech') return w.gh.member ? j({ state: w.gh.member, role: w.gh.role }) : j({ message: 'Not Found' }, 404)
    if (url === 'https://api.github.com/user/emails') return j([{ email: w.gh.email, primary: true, verified: true }])
    return j({}, 404)
  }
  return w
}

async function server (w, extra = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'work-'))
  const auth = createAuth({ DATA, identifyToken: () => null, workRequest: w.request, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_COMPANIES: COMPANIES, VESPR_SSO_ACME_SECRET: 'acme-secret', VESPR_AUTH_MICROSOFT_ID: 'ms-app', VESPR_AUTH_MICROSOFT_SECRET: 'ms-s', VESPR_AUTH_GOOGLE_ID: 'g-app', VESPR_AUTH_GOOGLE_SECRET: 'g-s', VESPR_AUTH_GITHUB_ID: 'gh-app', VESPR_AUTH_GITHUB_SECRET: 'gh-s', VESPR_AUTH_ALLOWED_NEXT: '/account.html', ...extra } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  // start -> the company's page (we read its query) -> the callback with the state cookie
  const signIn = async (company, claimsFor, { cookie = true, hint } = {}) => {
    const s = await fetch(base + `/auth/start/work/${company}?next=/account.html` + (hint ? '&login_hint=' + encodeURIComponent(hint) : ''), { redirect: 'manual' })
    if (s.status !== 302) return { status: s.status, body: await s.json() }
    const to = new URL(s.headers.get('location')); const state = to.searchParams.get('state')
    w.claims = claimsFor ? claimsFor(to.searchParams.get('nonce')) : null
    const cb = await fetch(base + '/auth/callback/work?' + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: cookie ? { cookie: 'vespr_work_state=' + state } : {} })
    const loc = cb.headers.get('location') || ''
    return { status: cb.status, to, token: loc.split('#token=')[1], body: cb.status === 302 ? null : await cb.json() }
  }
  return { auth, base, signIn, close: () => { srv.close(); fs.rmSync(DATA, { recursive: true, force: true }) } }
}
const now = () => Math.floor(Date.now() / 1000)
const okta = (nonce, extra = {}) => ({ iss: 'https://acme.okta.com', aud: 'acme-client', sub: 'okta-1', email: 'sam@acme.com', name: 'Sam Acme', nonce, exp: now() + 300, ...extra })

await t('companies: each login type read; free-mail domains and bad entries dropped', () => {
  const cs = readCompanies({ DATA: os.tmpdir(), config: { VESPR_COMPANIES: JSON.stringify([...JSON.parse(COMPANIES), { id: 'free', name: 'Free', domains: ['gmail.com'], login: 'okta', issuer: 'https://f.okta.com', clientId: 'x' }, { id: 'BAD id', name: 'x', domains: ['x.com'], login: 'okta' }]) } })
  assert.deepStrictEqual(cs.map(c => [c.id, c.login]), [['acme', 'okta'], ['contoso', 'entra'], ['globex', 'google-workspace'], ['initech', 'github'], ['nosecret', 'okta']])
  assert.strictEqual(cs.find(c => c.id === 'contoso').issuer, `https://login.microsoftonline.com/${TID}/v2.0`)
})

await t('Okta-style login: PKCE, nonce, hint; a new work account; an existing account with that work email is the same person', async () => {
  const w = fakeWorld(); const s = await server(w)
  await fetch(s.base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@acme.com', password: 'a-long-password-1', name: 'Sam' }) })
  const before = Object.values(s.auth.getUsers()).find(u => u.email === 'sam@acme.com')
  const r = await s.signIn('acme', nonce => okta(nonce), { hint: 'sam@acme.com' })
  assert.strictEqual(r.to.origin + r.to.pathname, 'https://acme.okta.com/authorize')
  for (const [k, v] of [['client_id', 'acme-client'], ['response_type', 'code'], ['code_challenge_method', 'S256'], ['login_hint', 'sam@acme.com']]) assert.strictEqual(r.to.searchParams.get(k), v, k)
  assert.ok(r.to.searchParams.get('redirect_uri').endsWith('/auth/callback/work'))
  assert.strictEqual(r.status, 302); const u = s.auth.getSessionUser(r.token)
  assert.strictEqual(u.id, before.id, 'the company owns acme.com, so its login may sign in the account with that email')
  assert.deepStrictEqual([u.work.company, u.work.via, u.providers['work:acme'].id], ['acme', 'okta', 'okta-1'])
  const tokenCall = w.calls.find(c => /acme\.okta\.com\/token$/.test(c.url)); const p = new URLSearchParams(tokenCall.body)
  assert.ok(p.get('code_verifier') && p.get('client_secret') === 'acme-secret')
  s.close()
})

await t('Okta-style login refusals: a personal email, a forged statement, a wrong nonce, another browser, no secret set', async () => {
  const w = fakeWorld(); const s = await server(w)
  assert.match((await s.signIn('acme', nonce => okta(nonce, { email: 'sam@gmail.com' }))).body.error, /work email/)
  w.key = w.other; assert.strictEqual((await s.signIn('acme', nonce => okta(nonce))).status, 401); w.key = undefined
  const w2 = fakeWorld(); const s2 = await server(w2)
  assert.strictEqual((await s2.signIn('acme', () => okta('not-the-nonce'))).status, 401)
  assert.strictEqual((await s2.signIn('acme', nonce => okta(nonce), { cookie: false })).status, 400)
  assert.strictEqual((await s2.signIn('nosecret', null)).status, 409)
  assert.strictEqual((await s2.signIn('nobody', null)).status, 404)
  s.close(); s2.close()
})

await t('Microsoft for one company: the tenant must match', async () => {
  const w = fakeWorld(); const s = await server(w)
  const iss = `https://login.microsoftonline.com/${TID}/v2.0`
  const r = await s.signIn('contoso', nonce => ({ iss, aud: 'ms-app', sub: 's', oid: 'oid-7', tid: TID, preferred_username: 'lee@contoso.com', name: 'Lee', nonce, exp: now() + 300 }))
  assert.strictEqual(r.to.origin + r.to.pathname, iss + '/authorize')
  assert.strictEqual(r.status, 302); assert.strictEqual(s.auth.getSessionUser(r.token).providers['work:contoso'].id, 'oid-7')
  const bad = await s.signIn('contoso', nonce => ({ iss, aud: 'ms-app', sub: 's', oid: 'o', tid: 'another-tenant', preferred_username: 'lee@contoso.com', nonce, exp: now() + 300 }))
  assert.strictEqual(bad.status, 403)
  s.close()
})

await t('Google Workspace for one company: hd asked for and required', async () => {
  const w = fakeWorld(); const s = await server(w)
  const g = (nonce, hd) => ({ iss: 'https://accounts.google.com', aud: 'g-app', sub: 'g-9', email: 'kim@globex.com', email_verified: true, hd, nonce, exp: now() + 300 })
  const r = await s.signIn('globex', nonce => g(nonce, 'globex.com')); assert.strictEqual(r.to.searchParams.get('hd'), 'globex.com'); assert.strictEqual(r.status, 302)
  assert.strictEqual((await s.signIn('globex', nonce => g(nonce, undefined))).status, 403, 'a personal Google account with a look-alike email fails')
  s.close()
})

await t('GitHub organization: active members only; admins kept as admins', async () => {
  const w = fakeWorld(); const s = await server(w)
  w.gh = { member: 'active', role: 'admin', email: 'pat@initech.com' }
  const r = await s.signIn('initech', null); assert.strictEqual(r.status, 302)
  assert.match(r.to.searchParams.get('scope'), /read:org/)
  const u = s.auth.getSessionUser(r.token); assert.deepStrictEqual([u.work.company, u.work.role, u.accountKind], ['initech', 'admin', 'business'])
  w.gh = { member: 'pending', role: 'member', email: 'x@initech.com' }
  assert.match((await s.signIn('initech', null)).body.error, /not an active member/)
  w.gh = { member: null }
  assert.strictEqual((await s.signIn('initech', null)).status, 403)
  s.close()
})

await t('auto sign-in finds the company from a work email or its name', async () => {
  const w = fakeWorld(); const s = await server(w)
  const look = async q => (await fetch(s.base + '/auth/discover?q=' + encodeURIComponent(q))).json()
  assert.deepStrictEqual(await look('sam@acme.com'), { kind: 'provider', provider: 'work', company: 'acme', label: 'Okta', name: 'Acme', hint: 'sam@acme.com' })
  assert.deepStrictEqual(await look('Contoso'), { kind: 'provider', provider: 'work', company: 'contoso', label: 'Microsoft', name: 'Contoso' })
  assert.deepStrictEqual(await look('x@nosecret.com'), { kind: 'not_ready', provider: 'work', label: 'No Secret (Okta)' })
  s.close()
})

console.log(`work sign-in tests passed (${n})`)
