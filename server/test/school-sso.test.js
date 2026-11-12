// School sign-in: the Microsoft email rule (xms_edov / personal accounts), ClassLink and Clever as school accounts (found by the school's
// id only; an email that belongs to another account is never a way in; no email needed), and LTI 1.3 launches from Canvas / D2L
// (signature, issuer, audience, expiry, nonce, state, version, message type, deployment). Schools and keys are faked locally.
import assert from 'node:assert'
import crypto from 'node:crypto'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth, microsoftEmailVerified, MSA_TENANT } from '../auth.js'
import { createLti, readPlatforms } from '../lti.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'school-sso-'))
const b64u = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')

// a fake school LMS: its key pair, its published keys, and signed launch statements
function fakeLms () {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'lms-1', alg: 'RS256', use: 'sig' }
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  const sign = (claims, key = privateKey, kid = 'lms-1') => { const h = b64u({ alg: 'RS256', kid, typ: 'JWT' }); const p = b64u(claims); return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key).toString('base64url')}` }
  const request = async ({ url }) => /jwks/.test(url) ? { status: 200, text: JSON.stringify({ keys: [jwk] }) } : { status: 404, text: '' }
  return { sign, other, request }
}
const L = 'https://purl.imsglobal.org/spec/lti/claim/'
const CANVAS = JSON.stringify([{ kind: 'canvas', clientId: '10000000000123', deploymentIds: ['dep-1'] }])
const claimsFor = (nonce, extra = {}) => ({
  iss: 'https://canvas.instructure.com', aud: '10000000000123', sub: 'canvas-user-77', nonce, exp: Math.floor(Date.now() / 1000) + 300, iat: Math.floor(Date.now() / 1000),
  [L + 'version']: '1.3.0', [L + 'message_type']: 'LtiResourceLinkRequest', [L + 'deployment_id']: 'dep-1',
  [L + 'roles']: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'], [L + 'context']: { id: 'course-9', title: 'Intro to Code' }, name: 'Kid One', ...extra
})
// LMS step 1 (login) -> VESPR redirect; returns the state and nonce VESPR put in it
function begin (lti) {
  const r = lti.login({ iss: 'https://canvas.instructure.com', login_hint: 'hint-1', client_id: '10000000000123', lti_message_hint: 'mh' }, 'https://v.test')
  const u = new URL(r.redirect); return { u, state: u.searchParams.get('state'), nonce: u.searchParams.get('nonce') }
}

await t('Microsoft: only personal accounts or organizations that own the domain count as verified emails', () => {
  assert.strictEqual(microsoftEmailVerified({ tid: MSA_TENANT }), true)
  assert.strictEqual(microsoftEmailVerified({ tid: 'some-org', xms_edov: true }), true)
  assert.strictEqual(microsoftEmailVerified({ tid: 'some-org', xms_edov: '1' }), true)
  assert.strictEqual(microsoftEmailVerified({ tid: 'some-org' }), false, 'any organization can type any email')
  assert.strictEqual(microsoftEmailVerified({ tid: 'some-org', xms_edov: false }), false)
})

await t('LTI platforms: Canvas cloud and D2L presets, bad entries dropped', () => {
  const ps = readPlatforms({ DATA: tmp(), config: { VESPR_LTI_PLATFORMS: JSON.stringify([{ kind: 'canvas', clientId: 'c1' }, { kind: 'd2l', host: 'school.brightspace.com', clientId: 'd1' }, { kind: 'd2l', host: 'bad host/x', clientId: 'd2' }, { kind: 'canvas' }]) } })
  assert.deepStrictEqual(ps.map(p => [p.name, p.issuer, p.authUrl]), [
    ['Canvas', 'https://canvas.instructure.com', 'https://sso.canvaslms.com/api/lti/authorize_redirect'],
    ['D2L Brightspace', 'https://school.brightspace.com', 'https://school.brightspace.com/d2l/lti/authenticate']])
})

await t('LTI login: unknown schools are refused; a known one goes back to its LMS for a signed statement', () => {
  const lti = createLti({ DATA: tmp(), config: { VESPR_LTI_PLATFORMS: CANVAS }, signIn: async () => ({}) })
  assert.match(lti.login({ iss: 'https://evil.example', login_hint: 'x' }, 'https://v.test').html, /not set up yet/)
  const { u, state, nonce } = begin(lti)
  assert.strictEqual(u.origin + u.pathname, 'https://sso.canvaslms.com/api/lti/authorize_redirect')
  for (const [k, v] of [['scope', 'openid'], ['response_type', 'id_token'], ['response_mode', 'form_post'], ['prompt', 'none'], ['client_id', '10000000000123'], ['redirect_uri', 'https://v.test/auth/lti/launch'], ['login_hint', 'hint-1'], ['lti_message_hint', 'mh']]) assert.strictEqual(u.searchParams.get(k), v, k)
  assert.ok(state && nonce && state !== nonce)
})

await t('LTI launch: a correct statement signs the student in; every forged or stale one is refused', async () => {
  const lms = fakeLms(); const seen = []
  const lti = createLti({ DATA: tmp(), config: { VESPR_LTI_PLATFORMS: CANVAS }, request: lms.request, signIn: async a => { seen.push(a); return { token: 'TOK' } } })
  let b = begin(lti)
  const ok = await lti.launch({ state: b.state, id_token: lms.sign(claimsFor(b.nonce)) })
  assert.strictEqual(ok.status, 200); assert.match(ok.html, /\/app\/#token=TOK/); assert.match(ok.html, /Signed in from Canvas/)
  assert.deepStrictEqual([seen[0].sub, seen[0].email, seen[0].name, seen[0].roles, seen[0].context.title], ['canvas-user-77', null, 'Kid One', ['Learner'], 'Intro to Code'])
  assert.match((await lti.launch({ state: b.state, id_token: lms.sign(claimsFor(b.nonce)) })).html, /expired/, 'the state works once')
  const bad = async (claims, key, why) => { b = begin(lti); const r = await lti.launch({ state: b.state, id_token: lms.sign(typeof claims === 'function' ? claims(b.nonce) : claims, key) }); assert.strictEqual(r.status, 400, why); assert.ok(!/#token=/.test(r.html), why) }
  await bad(nonce => claimsFor(nonce), lms.other, 'signed with another key')
  await bad(() => claimsFor('wrong-nonce'), undefined, 'wrong nonce')
  await bad(nonce => claimsFor(nonce, { aud: 'someone-else' }), undefined, 'not addressed to VESPR')
  await bad(nonce => claimsFor(nonce, { iss: 'https://evil.example' }), undefined, 'wrong issuer')
  await bad(nonce => claimsFor(nonce, { exp: Math.floor(Date.now() / 1000) - 3600 }), undefined, 'expired')
  await bad(nonce => claimsFor(nonce, { [L + 'deployment_id']: 'dep-other' }), undefined, 'another installation')
  await bad(nonce => claimsFor(nonce, { [L + 'version']: '1.1' }), undefined, 'not 1.3')
  await bad(nonce => claimsFor(nonce, { [L + 'message_type']: 'LtiDeepLinkingRequest' }), undefined, 'deep linking not yet')
  assert.strictEqual(seen.length, 1, 'nobody else was signed in')
})

await t('HTTP: the LMS posts from its own site (allowed only for the launch), the school account is made once, emails never reach other accounts', async () => {
  const DATA = tmp(); const lms = fakeLms()
  const auth = createAuth({ DATA, identifyToken: () => null, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_LTI_PLATFORMS: CANVAS } })
  // the LTI module inside auth fetches the LMS keys over the network; give it the fake LMS instead
  const lti = createLti({ DATA, config: { VESPR_LTI_PLATFORMS: CANVAS }, request: lms.request, signIn: async () => ({}) }); void lti
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const jw = await (await fetch(base + '/auth/lti/jwks')).json(); assert.ok(jw.keys[0].n && jw.keys[0].kid && !jw.keys[0].d, 'the public half only')
  const cfg = await (await fetch(base + '/auth/lti/canvas.json')).json()
  assert.strictEqual(cfg.oidc_initiation_url, base + '/auth/lti/login'); assert.strictEqual(cfg.public_jwk_url, base + '/auth/lti/jwks'); assert.strictEqual(cfg.extensions[0].privacy_level, 'name_only')
  const login = await fetch(base + '/auth/lti/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://school.instructure.com' }, body: new URLSearchParams({ iss: 'https://canvas.instructure.com', login_hint: 'h', client_id: '10000000000123' }) })
  assert.strictEqual(login.status, 302, 'a cross-site POST from the LMS reaches the LTI login')
  const nonFormPost = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://school.instructure.com' }, body: '{}' })
  assert.strictEqual(nonFormPost.status, 403, 'everything else still refuses other sites')
  srv.close()
})

await t('school accounts: found by the school id; no email needed; a taken email makes a separate account, never a way into the other', async () => {
  const DATA = tmp(); const lms = fakeLms()
  // ClassLink through the generic provider hook; LTI through auth's own module with the fake LMS keys (connectorRequest is not used here)
  let profile = null
  const classlink = { authorizeUrl: ({ state }) => 'https://launchpad.example/auth?state=' + state, exchange: async () => profile }
  const auth = createAuth({ DATA, identifyToken: () => null, oauthProviders: { classlink }, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/app/' } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; let ip = 0
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.4.0.' + (++ip) }, body: JSON.stringify(body) })
  await post('/auth/register', { email: 'teacher@district.org', password: 'a-long-password-1', name: 'Ms Teacher' })
  const viaClassLink = async () => {
    const s = await fetch(base + '/auth/start/classlink?next=/app/', { redirect: 'manual' }); const state = new URL(s.headers.get('location')).searchParams.get('state')
    const cb = await fetch(base + '/auth/callback/classlink?' + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: { cookie: 'vespr_oauth_state=' + state } })
    return { status: cb.status, token: (cb.headers.get('location') || '').split('#token=')[1] }
  }
  profile = { id: 'tenant9:5551', email: null, name: null, emailVerified: false }
  const kid = await viaClassLink(); assert.strictEqual(kid.status, 302)
  const kidUser = auth.getSessionUser(kid.token)
  assert.deepStrictEqual([kidUser.email, kidUser.emailVerified, kidUser.school.via], [null, false, 'classlink']); assert.match(kidUser.name, /^Student [0-9a-f]{4}$/)
  assert.strictEqual(auth.getSessionUser((await viaClassLink()).token).id, kidUser.id, 'the same student comes back to the same account')
  profile = { id: 'tenant9:6662', email: 'Teacher@District.org', name: 'Not The Teacher', emailVerified: false }
  const imp = auth.getSessionUser((await viaClassLink()).token)
  const teacher = Object.values(auth.getUsers()).find(u => u.email === 'teacher@district.org')
  assert.notStrictEqual(imp.id, teacher.id, 'never into the existing account'); assert.strictEqual(imp.email, null, 'and the taken email is not copied')
  assert.ok(!teacher.providers || !teacher.providers.classlink)
  srv.close(); void lms
})

await t('HTTP launch end to end: Canvas posts the signed statement, the student gets a school account, the same student comes back to it', async () => {
  const DATA = tmp(); const lms = fakeLms()
  const auth = createAuth({ DATA, identifyToken: () => null, ltiRequest: lms.request, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_LTI_PLATFORMS: CANVAS } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const launchOnce = async (extra = {}) => {
    const lg = await fetch(base + '/auth/lti/login?' + new URLSearchParams({ iss: 'https://canvas.instructure.com', login_hint: 'h', client_id: '10000000000123' }), { redirect: 'manual' })
    const u = new URL(lg.headers.get('location'))
    const r = await fetch(base + '/auth/lti/launch', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://sso.canvaslms.com' }, body: new URLSearchParams({ state: u.searchParams.get('state'), id_token: lms.sign(claimsFor(u.searchParams.get('nonce'), extra)) }) })
    const html = await r.text(); const m = /#token=([0-9a-f]{64})/.exec(html); return { status: r.status, token: m && m[1], html }
  }
  const a = await launchOnce(); assert.strictEqual(a.status, 200, a.html.slice(0, 200)); assert.ok(a.token)
  const u1 = auth.getSessionUser(a.token)
  assert.deepStrictEqual([u1.name, u1.email, u1.school.via, u1.school.roles], ['Kid One', null, 'Canvas', ['Learner']])
  assert.ok(Object.keys(u1.providers)[0].startsWith('lti:'))
  assert.strictEqual(auth.getSessionUser((await launchOnce()).token).id, u1.id, 'same student, same account')
  srv.close()
})

console.log(`school sign-in tests passed (${n})`)
