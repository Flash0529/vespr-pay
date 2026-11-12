// Sign-in wiring tests for server/auth.js and server/mail.js, all against fakes: no network beyond 127.0.0.1, no real provider, no real mail, no real SMS.
// Covers: TOTP against RFC 6238 vectors, a fake OAuth provider (authorization code + state + PKCE) for Google/Microsoft/GitHub, session cookies,
// CSRF and Origin checks, lockout, SMS codes at login, the mail transport (fake, allow-list, header injection, SMTP client against a local fake relay).
// Run: node server/test/auth-wiring.test.js
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import { createAuth, generateTOTP, base32Encode } from '../auth.js'
import { createMailer, createFakeTransport, createSmtpTransport, mailerFromEnv } from '../mail.js'
import { fakeSms, fakeProvider } from './auth-fakes.js'
import { seedUsers } from '../tools/seed-users.js'

let passed = 0
const check = (cond, msg) => { assert.ok(cond, msg); passed++ }
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); passed++ }

const usedTestPorts = new Set()
function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(err => {
        if (err) return reject(err)
        if (usedTestPorts.has(p)) return resolve(freePort())
        usedTestPorts.add(p)
        resolve(p)
      })
    })
  })
}

function request (base, pathName, { method = 'GET', headers = {}, json, raw } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathName, base), { method, headers, agent: false }, res => { // agent: false = a fresh connection per request (a reused idle one can be closed under it on a busy machine)
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(body) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, json: parsed, body })
      })
    })
    req.on('error', reject)
    if (json !== undefined) {
      const p = JSON.stringify(json)
      req.setHeader('Content-Type', 'application/json'); req.setHeader('Content-Length', Buffer.byteLength(p)); req.write(p)
    } else if (raw !== undefined) {
      req.setHeader('Content-Type', 'application/x-www-form-urlencoded'); req.setHeader('Content-Length', Buffer.byteLength(raw)); req.write(raw)
    }
    req.end()
  })
}
const cookieOf = (res, name) => {
  const all = [].concat(res.headers['set-cookie'] || [])
  const line = all.find(c => c.startsWith(name + '='))
  return line ? { line, value: line.split(';')[0].slice(name.length + 1) } : null
}

async function boot (opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-wiring-'))
  const clock = { t: Date.UTC(2026, 9, 29, 12, 0, 0) }
  const auth = createAuth({ DATA: dir, config: { VESPR_AUTH_ALLOWED_DOMAINS: '*', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/,/prototype.html', ...(opts.config || {}) }, now: () => clock.t, smsTransport: opts.sms, mailer: opts.mailer, oauthProviders: opts.providers || {} })
  const port = await freePort()
  const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  return { auth, clock, dir, base: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}

async function signup (env, email, password = 'CorrectHorseBattery9!') {
  const reg = await request(env.base, '/auth/register', { method: 'POST', json: { email, password } })
  eq(reg.status, 201, 'register ' + email)
  const login = await request(env.base, '/auth/login', { method: 'POST', json: { email, password } })
  eq(login.status, 200, 'login ' + email)
  const cookie = cookieOf(login, 'vespr_session')
  return { email, password, token: login.json.token, cookie: `vespr_session=${cookie.value}`, loginRes: login }
}

// ── 1. TOTP against RFC 6238 Appendix B (SHA-1, 8 digits, key "12345678901234567890") ─────────────────────────────
{
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]
  for (const [t, code] of vectors) eq(generateTOTP(secret, t, 30, 8), code, `RFC 6238 vector at T=${t}`)
  eq(generateTOTP(secret, 59), '287082', 'the 6-digit code is the last six digits of the RFC value')
}

// ── 2. Fake OAuth: Google, Microsoft, GitHub (code flow, state cookie, PKCE) ───────────────────────────────────────
{
  const profiles = {
    google: { id: 'g-1', email: 'gina@example.com', name: 'Gina', emailVerified: true },
    microsoft: { id: 'tenant:m-1', email: 'max@example.com', name: 'Max', emailVerified: true },
    github: { id: '77', email: 'octo@example.com', name: 'Octo', username: 'octo', emailVerified: true }
  }
  const providers = Object.fromEntries(Object.entries(profiles).map(([n, p]) => [n, fakeProvider(n, p)]))
  const env = await boot({ providers })
  try {
    const prov = (await request(env.base, '/auth/providers')).json
    check(prov.google && prov.microsoft && prov.github, 'configured providers are reported as configured')
    eq(prov.clever, false, 'Clever stays unconfigured')
    for (const name of ['google', 'microsoft', 'github']) {
      const start = await request(env.base, `/auth/start/${name}?next=/`)
      eq(start.status, 302, name + ' start redirects')
      const authUrl = new URL(start.headers.location)
      eq(authUrl.hostname, `fake-${name}.invalid`, name + ' sends the browser to the provider')
      eq(authUrl.searchParams.get('code_challenge_method'), 'S256', name + ' uses PKCE S256')
      check(authUrl.searchParams.get('code_challenge').length >= 43, name + ' challenge is a SHA-256 digest')
      const stateCookie = cookieOf(start, 'vespr_oauth_state')
      check(stateCookie && /HttpOnly/.test(stateCookie.line) && /SameSite=Lax/.test(stateCookie.line), name + ' state cookie is HttpOnly + SameSite')
      eq(stateCookie.value, authUrl.searchParams.get('state'), name + ' state cookie equals state parameter')
      const { code, state } = providers[name].approve(start.headers.location)

      // callback without the cookie (a different browser than the one that started the flow) is refused
      const noCookie = await request(env.base, `/auth/callback/${name}?code=${code}&state=${state}`)
      eq(noCookie.status, 400, name + ' callback without state cookie refused')
      // and the refusal burned the state, so even the right browser cannot reuse it
      const again = await request(env.base, `/auth/callback/${name}?code=${code}&state=${state}`, { headers: { Cookie: `vespr_oauth_state=${state}` } })
      eq(again.status, 400, name + ' state is single-use')

      const start2 = await request(env.base, `/auth/start/${name}?next=/`)
      const a2 = providers[name].approve(start2.headers.location)
      const wrongCookie = await request(env.base, `/auth/callback/${name}?code=${a2.code}&state=${a2.state}`, { headers: { Cookie: 'vespr_oauth_state=deadbeef' } })
      eq(wrongCookie.status, 400, name + ' callback with a different state cookie refused')

      const start3 = await request(env.base, `/auth/start/${name}?next=/`)
      const a3 = providers[name].approve(start3.headers.location)
      const ok = await request(env.base, `/auth/callback/${name}?code=${a3.code}&state=${a3.state}`, { headers: { Cookie: `vespr_oauth_state=${a3.state}` } })
      eq(ok.status, 302, name + ' good callback redirects')
      eq((await request(env.base, `/auth/callback/${name}?code=${a3.code}&state=${a3.state}`, { headers: { Cookie: `vespr_oauth_state=${a3.state}` } })).status, 400, name + ' a finished sign-in cannot be replayed')
      check(ok.headers.location.startsWith('/#token='), name + ' redirect carries the token in the fragment, not the query')
      const sess = cookieOf(ok, 'vespr_session')
      check(sess && /HttpOnly/.test(sess.line), name + ' sets an HttpOnly session cookie')
      const me = await request(env.base, '/auth/me', { headers: { Cookie: `vespr_session=${sess.value}` } })
      eq(me.status, 200, name + ' session cookie is accepted')
      eq(me.json.user.email, profiles[name].email, name + ' session cookie identifies the user')
      // the provider will not honor the same code twice
      await assert.rejects(() => providers[name].exchange({ code: a3.code, codeVerifier: 'x', redirectUri: 'x' }))
    }

    // PKCE is actually enforced end to end: a provider that saw a different challenge rejects the exchange, so sign-in fails
    const start = await request(env.base, '/auth/start/google?next=/')
    const a = providers.google.approve(start.headers.location)
    providers.google.issued.get(a.code).challenge = crypto.createHash('sha256').update('some-other-verifier').digest('base64url')
    const tampered = await request(env.base, `/auth/callback/google?code=${a.code}&state=${a.state}`, { headers: { Cookie: `vespr_oauth_state=${a.state}` } })
    eq(tampered.status, 401, 'a PKCE mismatch fails the sign-in')
    check(!cookieOf(tampered, 'vespr_session'), 'no session cookie on a failed sign-in')

    // open redirects are refused
    for (const next of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '/%0d%0aSet-Cookie:x=1', 'javascript:alert(1)']) {
      eq((await request(env.base, `/auth/start/github?next=${encodeURIComponent(next)}`)).status, 400, 'next refused: ' + next)
    }
    // unconfigured provider
    eq((await request(env.base, '/auth/start/clever?next=/')).status, 404, 'unconfigured provider has no start')
  } finally { env.close() }

  const bare = await boot()
  try {
    const p = (await request(bare.base, '/auth/providers')).json
    check(!p.google && !p.microsoft && !p.github && !p.sms, 'with nothing configured every provider and SMS report false')
    eq((await request(bare.base, '/auth/start/google?next=/')).status, 404, 'unconfigured Google has no start')
  } finally { bare.close() }
}

// ── 3. Session cookie, CSRF, Origin, content type ─────────────────────────────────────────────────────────────────
{
  const env = await boot({ config: { VESPR_AUTH_TRUST_PROXY: '1' } })
  try {
    const u = await signup(env, 'cora@example.com')
    check(/HttpOnly/.test(u.loginRes.headers['set-cookie'][0]) && /SameSite=Lax/.test(u.loginRes.headers['set-cookie'][0]), 'session cookie is HttpOnly + SameSite=Lax')
    check(!/Secure/.test(u.loginRes.headers['set-cookie'][0]), 'no Secure flag over plain http')
    // the proxy headers only count when the operator says a proxy is in front
    const open = await boot()
    try {
      const o = await signup(open, 'olga@example.com')
      const spoof = await request(open.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-Proto': 'https' }, json: { email: o.email, password: o.password } })
      check(!/; Secure/.test(spoof.headers['set-cookie'][0]), 'X-Forwarded-Proto is ignored without VESPR_AUTH_TRUST_PROXY')
      for (let i = 0; i < 5; i++) await request(open.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': `10.0.0.${i}` }, json: { email: 'nobody@example.com', password: 'wrong-wrong-' + i } })
      eq((await request(open.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': '10.9.9.9' }, json: { email: 'other@example.com', password: 'wrong-wrong-x' } })).status, 429, 'a spoofed X-Forwarded-For does not reset the per-address lockout')
    } finally { open.close() }
    const prox = await boot({ config: { VESPR_AUTH_TRUST_PROXY: '1' } })
    try {
      for (let i = 0; i < 5; i++) await request(prox.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.7' }, json: { email: `p${i}@example.com`, password: 'wrong-wrong-' + i } })
      eq((await request(prox.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.7' }, json: { email: 'q@example.com', password: 'wrong-wrong-q' } })).status, 429, 'behind a trusted proxy the forwarded client address is locked')
      eq((await request(prox.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.8' }, json: { email: 'r@example.com', password: 'wrong-wrong-r' } })).status, 401, 'and other clients behind the same proxy are not')
    } finally { prox.close() }
    const https = await request(env.base, '/auth/login', { method: 'POST', headers: { 'X-Forwarded-Proto': 'https' }, json: { email: u.email, password: u.password } })
    check(/; Secure/.test(https.headers['set-cookie'][0]), 'Secure flag when the request came in over https')

    const me = await request(env.base, '/auth/me', { headers: { Cookie: u.cookie } })
    eq(me.status, 200, 'cookie authenticates /auth/me')
    const csrf = me.json.csrfToken
    check(/^[0-9a-f]{64}$/.test(csrf), '/auth/me hands the page its CSRF token')
    eq(me.headers['cache-control'].includes('no-store'), true, 'auth responses are not cacheable')

    eq((await request(env.base, '/auth/2fa/totp/setup', { method: 'POST', headers: { Cookie: u.cookie } })).status, 403, 'cookie POST without CSRF header refused')
    eq((await request(env.base, '/auth/2fa/totp/setup', { method: 'POST', headers: { Cookie: u.cookie, 'X-CSRF-Token': 'f'.repeat(64) } })).status, 403, 'cookie POST with a wrong CSRF token refused')
    eq((await request(env.base, '/auth/2fa/totp/setup', { method: 'POST', headers: { Cookie: u.cookie, 'X-CSRF-Token': csrf } })).status, 200, 'cookie POST with the right CSRF token works')
    eq((await request(env.base, '/auth/2fa/totp/setup', { method: 'POST', headers: { Authorization: `Bearer ${u.token}` } })).status, 200, 'Bearer token needs no CSRF (it is not ambient)')

    eq((await request(env.base, '/auth/login', { method: 'POST', headers: { Origin: 'https://evil.example' }, json: { email: u.email, password: u.password } })).status, 403, 'cross-site Origin refused on login')
    eq((await request(env.base, '/auth/login', { method: 'POST', headers: { Origin: `http://${env.host}` }, json: { email: u.email, password: u.password } })).status, 200, 'same-site Origin accepted')
    eq((await request(env.base, '/auth/login', { method: 'POST', raw: JSON.stringify({ email: u.email, password: u.password }) })).status, 400, 'a body sent as a form (not application/json) is refused even if it parses as JSON')

    eq((await request(env.base, '/auth/logout', { method: 'POST', headers: { Cookie: u.cookie } })).status, 403, 'logout with cookie needs CSRF')
    const out = await request(env.base, '/auth/logout', { method: 'POST', headers: { Cookie: u.cookie, 'X-CSRF-Token': csrf } })
    eq(out.status, 200, 'logout works with CSRF')
    check(/Max-Age=0/.test(out.headers['set-cookie'][0]), 'logout clears the cookie')
    eq((await request(env.base, '/auth/me', { headers: { Cookie: u.cookie } })).status, 401, 'the session is gone server-side')
    eq(fs.readFileSync(path.join(env.dir, 'auth', 'sessions.json'), 'utf8').includes(u.token), false, 'only a hash of the session token is stored')
  } finally { env.close() }
}

// ── 4. Lockout ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const env = await boot()
  try {
    const u = await signup(env, 'lena@example.com')
    for (let i = 0; i < 5; i++) eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: 'wrong-password-' + i } })).status, 401, 'wrong password ' + i)
    const locked = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })
    eq(locked.status, 429, 'the right password is refused while locked')
    eq(locked.json.locked, true, 'response says locked')
    check(Number(locked.headers['retry-after']) > 0 && locked.json.retryAfterSec === Number(locked.headers['retry-after']), 'Retry-After tells how long')
    env.clock.t += 16 * 60 * 1000
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })).status, 200, 'sign-in works again after the window')
    // sign-ups are limited per address too
    let last
    for (let i = 0; i < 7; i++) last = await request(env.base, '/auth/register', { method: 'POST', json: { email: `bulk${i}@example.com`, password: 'CorrectHorseBattery9!' } })
    eq(last.status, 429, 'bulk sign-ups from one address are limited')
  } finally { env.close() }
}

// ── 5. Authenticator app (TOTP) and recovery codes, end to end ───────────────────────────────────────────────────
{
  const env = await boot()
  try {
    const u = await signup(env, 'tom@example.com')
    const H = { Authorization: `Bearer ${u.token}` }
    const setup = await request(env.base, '/auth/2fa/totp/setup', { method: 'POST', headers: H })
    check(setup.json.qrUri.startsWith('otpauth://totp/VESPR:') && setup.json.qrUri.includes('secret=' + setup.json.secret), 'setup returns an otpauth URI')
    const secs = () => Math.floor(env.clock.t / 1000)
    eq((await request(env.base, '/auth/2fa/totp/verify', { method: 'POST', headers: H, json: { code: '000000' } })).status, 400, 'wrong enrollment code refused')
    const enrol = await request(env.base, '/auth/2fa/totp/verify', { method: 'POST', headers: H, json: { code: generateTOTP(setup.json.secret, secs()) } })
    eq(enrol.status, 200, 'enrollment accepts a real code')
    eq(enrol.json.recoveryCodes.length, 10, 'ten recovery codes')

    const need = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })
    check(need.json.require2fa === true && need.json.method === 'totp' && !need.json.token, 'password alone is not enough once 2FA is on')
    const replay = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: generateTOTP(setup.json.secret, secs()) } })
    eq(replay.status, 401, 'the code used at enrollment cannot be replayed')
    env.clock.t += 31000
    const good = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: generateTOTP(setup.json.secret, secs()) } })
    eq(good.status, 200, 'a fresh code signs in')
    const reuse = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: generateTOTP(setup.json.secret, secs()) } })
    eq(reuse.status, 401, 'a code cannot be used twice')
    const rec = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, recoveryCode: enrol.json.recoveryCodes[0] } })
    eq(rec.status, 200, 'a recovery code signs in')
    const rec2 = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, recoveryCode: enrol.json.recoveryCodes[0] } })
    eq(rec2.status, 401, 'a recovery code works once')
    const raw = fs.readFileSync(path.join(env.dir, 'auth', 'users.json'), 'utf8')
    check(!raw.includes(enrol.json.recoveryCodes[1].replace('-', '')), 'recovery codes are stored hashed')
  } finally { env.close() }
}

// ── 6. SMS codes (fake transport) ─────────────────────────────────────────────────────────────────────────────────
{
  const sms = fakeSms()
  const env = await boot({ sms, config: { NODE_ENV: 'test', TWILIO_MOCK: '1' } })
  try {
    eq((await request(env.base, '/auth/providers')).json.sms, true, 'SMS reported available when a transport exists')
    const u = await signup(env, 'sam@example.com')
    const H = { Authorization: `Bearer ${u.token}` }
    const phone = '+14155550123'
    eq((await request(env.base, '/auth/2fa/sms/send', { method: 'POST', headers: H, json: { phone: '+442071838750' } })).status, 403, 'a number outside the allowed country codes is refused')
    sms.failNext = true
    eq((await request(env.base, '/auth/2fa/sms/send', { method: 'POST', headers: H, json: { phone } })).status, 502, 'a failing carrier is reported as a failure, not as sent')
    eq((await request(env.base, '/auth/2fa/sms/verify', { method: 'POST', headers: H, json: { code: '123456' } })).status, 400, 'nothing to verify when no code was sent')
    eq((await request(env.base, '/auth/2fa/sms/send', { method: 'POST', headers: H, json: { phone } })).status, 200, 'send ok')
    eq(sms.sent.length, 1, 'one message went to the transport')
    eq((await request(env.base, '/auth/2fa/sms/verify', { method: 'POST', headers: H, json: { code: '000000' } })).status, 400, 'wrong SMS code refused')
    // the code cannot be used to confirm a different number than the one it was sent to
    eq((await request(env.base, '/auth/2fa/sms/verify', { method: 'POST', headers: H, json: { phone: '+14155550999', code: sms.last(phone) } })).status, 200, 'the number comes from the server, not the request')
    eq(JSON.parse(fs.readFileSync(path.join(env.dir, 'auth', 'users.json'), 'utf8'))[Object.keys(env.auth.getUsers())[0]].sms.phone, phone, 'the confirmed number is the one the code was sent to')

    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: '123456' } })).status, 401, 'NODE_ENV=test / TWILIO_MOCK=1 do not make 123456 a working code')
    // sign-in with SMS: the code is sent at login, only then
    const before = sms.sent.length
    const need = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })
    check(need.json.require2fa && need.json.method === 'sms' && need.json.smsSent === true && need.json.phoneHint.endsWith('0123'), 'login asks for the SMS code and says one was sent')
    eq(sms.sent.length, before + 1, 'the code really went to the transport')
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: '111111' } })).status, 401, 'wrong SMS code refused at login')
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password, code: sms.last(phone) } })).status, 200, 'right SMS code signs in')
    sms.failNext = true
    const down = await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })
    check(down.status === 502 && !down.json.smsSent, 'login says the SMS could not be sent when the carrier fails')
    // per-number send limit
    let lastStatus
    for (let i = 0; i < 8; i++) lastStatus = (await request(env.base, '/auth/login', { method: 'POST', json: { email: u.email, password: u.password } })).status
    eq(lastStatus, 429, 'repeated SMS requests hit the limit')
  } finally { env.close() }
  // wrong enrollment codes are counted, and with no transport and no Twilio settings nothing is sent anywhere
  const sms3 = fakeSms()
  const env3 = await boot({ sms: sms3 })
  try {
    const u = await signup(env3, 'wes@example.com')
    const H = { Authorization: `Bearer ${u.token}` }
    eq((await request(env3.base, '/auth/2fa/sms/send', { method: 'POST', headers: H, json: { phone: '+14155550142' } })).status, 200, 'send ok')
    for (let i = 0; i < 5; i++) eq((await request(env3.base, '/auth/2fa/sms/verify', { method: 'POST', headers: H, json: { code: '00000' + i } })).status, 400, 'wrong enrollment code ' + i)
    eq((await request(env3.base, '/auth/2fa/sms/verify', { method: 'POST', headers: H, json: { code: sms3.last('+14155550142') } })).status, 429, 'after five wrong codes even the right one waits')
  } finally { env3.close() }
  const env4 = await boot()
  try {
    const u = await signup(env4, 'noc@example.com')
    const H = { Authorization: `Bearer ${u.token}` }
    eq((await request(env4.base, '/auth/2fa/sms/send', { method: 'POST', headers: H, json: { phone: '+14155550143' } })).status, 502, 'with SMS unconfigured, send fails without touching the network')
    eq((await request(env4.base, '/auth/providers')).json.sms, false, 'and the providers list says SMS is off')
  } finally { env4.close() }
}

// ── 7. Mail: verification link through the transport ─────────────────────────────────────────────────────────────
{
  const transport = createFakeTransport()
  const mailer = createMailer({ transport, from: 'noreply@vespr.test' })
  const env = await boot({ mailer, config: { VESPR_AUTH_SKIP_VERIFY: '0', VESPR_AUTH_BASE_URL: 'https://vespr.test' } })
  try {
    const reg = await request(env.base, '/auth/register', { method: 'POST', json: { email: 'mia@example.com', password: 'CorrectHorseBattery9!' } })
    eq(reg.json.mailDelivery, 'sent', 'delivery is "sent" only when the transport accepted the message')
    eq(transport.sent.length, 1, 'one message')
    eq(transport.sent[0].to, 'mia@example.com', 'to the new account')
    const link = /https:\/\/vespr\.test(\/verify-email\.html\?token=([0-9a-f]{64}))/.exec(transport.sent[0].text)
    check(link, 'the mail holds the verification page link on the configured base URL')
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: 'mia@example.com', password: 'CorrectHorseBattery9!' } })).status, 403, 'unverified accounts cannot sign in')
    eq((await request(env.base, '/auth/verify-email?token=' + 'a'.repeat(64))).status, 400, 'a guessed token is refused')
    const verifyEndpoint = '/auth/verify-email?token=' + link[2]
    eq((await request(env.base, verifyEndpoint)).status, 200, 'the page verification API accepts the emailed token')
    eq((await request(env.base, verifyEndpoint)).status, 400, 'the emailed token works once')
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: 'mia@example.com', password: 'CorrectHorseBattery9!' } })).status, 200, 'verified accounts sign in')
    eq((await request(env.base, '/auth/resend-verification', { method: 'POST', json: { email: 'nobody@example.com' } })).json.mailDelivery, 'none', 'resend does not reveal unknown accounts')
    await request(env.base, '/auth/register', { method: 'POST', json: { email: 'neo@example.com', password: 'CorrectHorseBattery9!' } })
    const res = await request(env.base, '/auth/resend-verification', { method: 'POST', json: { email: 'neo@example.com' } })
    eq(res.json.mailDelivery, 'sent', 'resend sends again'); eq(transport.sent.length, 3, 'registrations and the resend all went through the transport')
  } finally { env.close() }

  const broken = { send: async () => { throw new Error('relay refused') } }
  const env2 = await boot({ mailer: createMailer({ transport: broken, from: 'noreply@vespr.test' }), config: { VESPR_AUTH_SKIP_VERIFY: '0' } })
  try {
    eq((await request(env2.base, '/auth/register', { method: 'POST', json: { email: 'ann@example.com', password: 'CorrectHorseBattery9!' } })).json.mailDelivery, 'failed', 'a refused message is reported as failed')
  } finally { env2.close() }

  const env3 = await boot({ config: { VESPR_AUTH_SKIP_VERIFY: '0' } })
  try {
    eq((await request(env3.base, '/auth/register', { method: 'POST', json: { email: 'dev@example.com', password: 'CorrectHorseBattery9!' } })).json.mailDelivery, 'dev-log', 'with no mailer nothing is sent and the response says so')
  } finally { env3.close() }

  // allow-list and header injection
  const t2 = createFakeTransport()
  const guarded = createMailer({ transport: t2, from: 'noreply@vespr.test', allowTo: ['person@example.com'] })
  await guarded.send({ to: 'person@example.com', subject: 'hi', text: 'x' })
  await assert.rejects(() => guarded.send({ to: 'someone@else.com', subject: 'hi', text: 'x' }), /allow-list/)
  await assert.rejects(() => guarded.send({ to: 'person@example.com\r\nBcc: a@b.co', subject: 'hi', text: 'x' }), /invalid/)
  await assert.rejects(() => guarded.send({ to: 'person@example.com', subject: 'hi\r\nBcc: a@b.co', text: 'x' }), /invalid/)
  eq(t2.sent.length, 1, 'only the allowed message was sent'); passed += 3
  eq(mailerFromEnv({}), null, 'mail is off unless VESPR_MAIL_ENABLED=1')
  assert.throws(() => mailerFromEnv({ VESPR_MAIL_ENABLED: '1' }), /SMTP_HOST/); passed++
}

// ── 8. SMTP client against a local fake relay (plaintext only: TLS paths are not exercised) ────────────────────────
{
  const transcript = []
  const port = await freePort()
  const relay = net.createServer(sock => {
    let inData = false
    let buf = ''
    sock.write('220 fake.relay ESMTP\r\n')
    sock.on('data', d => {
      buf += d.toString()
      let i
      while ((i = buf.indexOf('\r\n')) !== -1 && !(inData && !buf.includes('\r\n.\r\n'))) {
        if (inData) { const end = buf.indexOf('\r\n.\r\n'); transcript.push('BODY ' + buf.slice(0, end)); buf = buf.slice(end + 5); inData = false; sock.write('250 queued\r\n'); continue }
        const line = buf.slice(0, i); buf = buf.slice(i + 2); transcript.push(line)
        if (/^EHLO/.test(line)) sock.write('250-fake.relay\r\n250 AUTH PLAIN\r\n')
        else if (/^AUTH PLAIN/.test(line)) sock.write('235 ok\r\n')
        else if (/^(MAIL|RCPT)/.test(line)) sock.write('250 ok\r\n')
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n') }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end() }
        else sock.write('500 what\r\n')
      }
    })
  })
  await new Promise(r => relay.listen(port, '127.0.0.1', r))
  try {
    const pass = crypto.randomBytes(6).toString('hex')
    const mailer = createMailer({ transport: createSmtpTransport({ host: '127.0.0.1', port, user: 'relay-user', pass, requireTls: false }), from: 'noreply@vespr.test', allowTo: ['person@example.com'] })
    await mailer.send({ to: 'person@example.com', subject: 'Test', text: 'line one\n.dot line\nlast' })
    check(transcript.includes('MAIL FROM:<noreply@vespr.test>') && transcript.includes('RCPT TO:<person@example.com>'), 'envelope sent')
    check(transcript.some(l => l === 'AUTH PLAIN ' + Buffer.from(`\0relay-user\0${pass}`).toString('base64')), 'AUTH PLAIN carried the credentials')
    const body = transcript.find(l => l.startsWith('BODY '))
    check(body.includes('Subject: Test') && body.includes('\r\n..dot line'), 'headers present and a leading dot is stuffed')
    // a relay without STARTTLS is refused when TLS is required, and nothing is sent in the clear
    transcript.length = 0
    const strict = createSmtpTransport({ host: '127.0.0.1', port, user: 'u', pass: 'p' })
    await assert.rejects(() => strict.send({ from: 'a@b.co', to: 'c@d.co', subject: 's', text: 't' }), /STARTTLS/)
    check(!transcript.some(l => /^(AUTH|MAIL|RCPT)/.test(l)), 'no credentials or mail went over plaintext'); passed++
  } finally { relay.close() }
}

// ── 9. Seeded accounts (for two named people): verified, random password in a 0600 file, nothing sent ────────────────
{
  const env = await boot({ config: { VESPR_AUTH_SKIP_VERIFY: '0' } })
  const outFile = path.join(env.dir, 'seed-passwords.txt')
  try {
    const r = seedUsers({ dataDir: env.dir, outFile, emails: ['One@Example.com', 'two@example.com'] })
    eq(r.created.join(), 'one@example.com,two@example.com', 'both accounts created, emails lowercased')
    eq(fs.statSync(outFile).mode & 0o777, 0o600, 'the password file is private')
    eq(JSON.stringify(r).includes('\t'), false, 'the result carries no passwords')
    const pw = Object.fromEntries(fs.readFileSync(outFile, 'utf8').trim().split('\n').map(l => l.split('\t')))
    check(pw['one@example.com'].length >= 20 && pw['one@example.com'] !== pw['two@example.com'], 'long random, different passwords')
    const login = await request(env.base, '/auth/login', { method: 'POST', json: { email: 'one@example.com', password: pw['one@example.com'] } })
    eq(login.status, 200, 'a seeded account signs in with no verification step, on a server that requires verification')
    eq((await request(env.base, '/auth/login', { method: 'POST', json: { email: 'one@example.com', password: pw['two@example.com'] } })).status, 401, 'and not with the other account\'s password')
    const again = seedUsers({ dataDir: env.dir, outFile, emails: ['one@example.com'] })
    eq(again.skipped.join(), 'one@example.com', 'running it twice leaves an existing account (and its password) alone')
    eq(fs.readFileSync(outFile, 'utf8').trim().split('\n').length, 2, 'no second password line was written')
  } finally { env.close() }
}

console.log(`auth wiring: ${passed} checks passed`)
