// Desktop sign-in return through the real auth module over HTTP (no network beyond 127.0.0.1, no provider, no keys).
// Flow: app starts a transaction -> person signed in on the website completes it -> browser is redirected with a one-use code -> app exchanges it.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { createAuth } from '../auth.js'

const b64u = b => Buffer.from(b).toString('base64url')
const verifier = b64u(crypto.randomBytes(32)); const challenge = b64u(crypto.createHash('sha256').update(verifier).digest())
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-auth-http-'))
const servers = []

async function boot (over = {}, data = dir) {
  const auth = createAuth({ DATA: data, identifyToken: () => null, config: { NODE_ENV: 'test', VESPR_AUTH_ALLOWED_DOMAINS: '*', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/prototype.html', ...(over.config || {}) }, admissionFor: over.admissionFor })
  const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); servers.push(server)
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (method, p, { token, body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request(new URL(p, base), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
      let t = ''; res.on('data', c => { t += c }); res.on('end', () => { let json = null; try { json = JSON.parse(t) } catch {} resolve({ status: res.statusCode, json, headers: res.headers, text: t }) })
    })
    req.on('error', reject)
    if (body) { const s = JSON.stringify(body); req.setHeader('Content-Type', 'application/json'); req.setHeader('Content-Length', Buffer.byteLength(s)); req.write(s) }
    req.end()
  })
  return { auth, call }
}
const open = { admissionFor: () => ({ state: 'active', next: null, restrictions: {} }) }
const login = async (s, email, label) => {
  await s.call('POST', '/auth/register', { body: { email, password: 'Password12345!' } })
  const r = await s.call('POST', '/auth/login', { body: { email, password: 'Password12345!', deviceLabel: label } }); assert.strictEqual(r.status, 200); return r
}
const startTx = (s, o = {}) => s.call('POST', '/auth/desktop/transactions', { body: { provider: 'password', challenge, state: b64u(crypto.randomBytes(16)), redirect: 'loopback', port: 51888, deviceLabel: 'Ann desktop', clientVersion: '1.0.0', ...o } })

try {
  // ---- the whole round trip
  const s = await boot({ ...open, config: { VESPR_DESKTOP_SIGNIN_URL: 'https://vespr.test/desktop-signin.html' } })
  const ann = (await login(s, 'ann@example.com', 'Ann browser')).json.token
  const st = b64u(crypto.randomBytes(16))
  const tx = await startTx(s, { state: st }); assert.strictEqual(tx.status, 201)
  assert.strictEqual(tx.json.browserUrl, `https://vespr.test/desktop-signin.html#tx=${tx.json.txId}`, 'the id goes in the fragment, never a query string')
  assert.ok(!tx.text.includes(challenge) && !tx.text.includes(st), 'the start reply echoes no challenge or state')
  const pv = await s.call('GET', '/auth/desktop/transactions/' + tx.json.txId); assert.strictEqual(pv.status, 200)
  assert.deepStrictEqual(Object.keys(pv.json).sort(), ['createdAt', 'deviceLabel', 'expiresAt', 'provider', 'status']); assert.strictEqual(pv.json.deviceLabel, 'Ann desktop')
  assert.strictEqual((await s.call('GET', '/auth/desktop/transactions/' + 'a'.repeat(30))).status, 404)
  assert.strictEqual((await s.call('POST', '/auth/desktop/complete', { body: { txId: tx.json.txId } })).status, 401, 'completing needs a signed-in browser')
  const done = await s.call('POST', '/auth/desktop/complete', { token: ann, body: { txId: tx.json.txId } }); assert.strictEqual(done.status, 200)
  const url = new URL(done.json.redirect); assert.strictEqual(url.origin, 'http://127.0.0.1:51888'); assert.strictEqual(url.searchParams.get('state'), st)
  const code = url.searchParams.get('code')
  const ex = await s.call('POST', '/auth/desktop/exchanges', { body: { txId: tx.json.txId, code, verifier, installId: 'install-ann-0001-xyz' } })
  assert.strictEqual(ex.status, 200); assert.strictEqual(ex.json.admission.state, 'active'); const deviceTok = ex.json.token
  const devices = (await s.call('GET', '/auth/devices', { token: deviceTok })).json.devices
  assert.deepStrictEqual(devices.map(d => d.kind).sort(), ['browser', 'device'], 'the desktop is a device of its own, next to the browser session')
  assert.strictEqual(devices.find(d => d.current).label, 'Ann desktop'); assert.ok(!JSON.stringify(devices).includes(deviceTok))
  assert.ok(auth_has(s, 'ann@example.com'), 'sanity')

  // ---- replay: refused, and the session the first use made stops working
  const replay = await s.call('POST', '/auth/desktop/exchanges', { body: { txId: tx.json.txId, code, verifier, installId: 'install-ann-0001-xyz' } })
  assert.strictEqual(replay.status, 400); assert.strictEqual(replay.json.error, 'code_used')
  assert.strictEqual((await s.call('GET', '/auth/devices', { token: deviceTok })).status, 401, 'the replay closed the device session')
  assert.strictEqual((await s.call('GET', '/auth/devices', { token: ann })).status, 200, 'the browser session is untouched')

  // ---- a cookie session needs the CSRF token to complete (a cross-site page cannot do it for the person)
  const cookieLogin = await s.call('POST', '/auth/login', { body: { email: 'ann@example.com', password: 'Password12345!' } })
  const cookie = String(cookieLogin.headers['set-cookie'] || '').split(';')[0]; assert.ok(cookie.includes('='))
  const tx2 = await startTx(s)
  assert.strictEqual((await s.call('POST', '/auth/desktop/complete', { body: { txId: tx2.json.txId }, headers: { Cookie: cookie } })).status, 403, 'cookie without a CSRF token is refused')
  const me = await s.call('GET', '/auth/me', { headers: { Cookie: cookie } }); const csrf = me.json.csrfToken
  assert.strictEqual((await s.call('POST', '/auth/desktop/complete', { body: { txId: tx2.json.txId }, headers: { Cookie: cookie, 'X-CSRF-Token': csrf } })).status, 200)

  // ---- the cancel button
  const tx3 = await startTx(s); assert.strictEqual((await s.call('POST', '/auth/desktop/cancel', { body: { txId: tx3.json.txId } })).status, 200)
  assert.strictEqual((await s.call('POST', '/auth/desktop/complete', { token: ann, body: { txId: tx3.json.txId } })).status, 409)

  // ---- bad input never reaches the store
  assert.strictEqual((await startTx(s, { redirect: 'http://evil.example/cb' })).status, 400); assert.strictEqual((await startTx(s, { port: 22 })).status, 400)
  assert.strictEqual((await s.call('POST', '/auth/desktop/transactions', { body: undefined })).status, 400)

  // ---- a server restart in the middle of a sign-in: the transaction lives in the store
  const tx4 = await startTx(s); const restarted = await boot(open)
  const code4 = new URL((await restarted.call('POST', '/auth/desktop/complete', { token: ann, body: { txId: tx4.json.txId } })).json.redirect).searchParams.get('code')
  assert.strictEqual((await restarted.call('POST', '/auth/desktop/exchanges', { body: { txId: tx4.json.txId, code: code4, verifier, installId: 'install-ann-0001-xyz' } })).status, 200, 'the second server finished what the first one started')
  assert.ok(!fs.readFileSync(path.join(dir, 'auth', 'desktop-tx.json'), 'utf8').includes(code4), 'no code in the stored file')
  assert.strictEqual(fs.statSync(path.join(dir, 'auth', 'desktop-tx.json')).mode & 0o077, 0, 'the file is private (0600)')

  // ---- the default admission blocks an account that has no age, terms or guardian facts: nothing is let through by accident
  const strict = await boot({}, fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-auth-http2-')))
  const bob = (await login(strict, 'bob@example.com', 'Bob browser')).json.token
  const tx5 = await startTx(strict); const blocked = await strict.call('POST', '/auth/desktop/complete', { token: bob, body: { txId: tx5.json.txId } })
  assert.strictEqual(blocked.status, 403); assert.deepStrictEqual({ e: blocked.json.error, s: blocked.json.state, n: blocked.json.next }, { e: 'not_admitted', s: 'needs_age', n: 'age' })
  assert.ok(!blocked.text.includes('code='))
  // wrong guesses are limited per address
  let last; for (let i = 0; i < 7; i++) last = await strict.call('POST', '/auth/desktop/exchanges', { body: { txId: tx5.json.txId, code: 'x'.repeat(43), verifier, installId: 'install-bob-0001-xyz' } })
  assert.strictEqual(last.status, 429, 'repeated failed exchanges from one address are locked out')

  console.log('desktop auth http tests passed')
} finally {
  for (const sv of servers) sv.close()
  fs.rmSync(dir, { recursive: true, force: true })
}
function auth_has (s, email) { return Object.values(s.auth.getUsers()).some(u => u.email === email) }
