// GET /auth/session: what the client (browser app shell or the Windows desktop shell) asks on launch: who am I, what state is my account in, what may I do.
// The client displays this; the server enforces it. A blocked account still gets a 200 with its state (it needs the state to show the right screen).
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAuth } from '../auth.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-endpoint-'))
const byEmail = {
  'adult@example.com': { state: 'active', next: null, capabilities: ['chat', 'agent.start', 'account.logout'], restrictions: {}, reasons: ['internal note'] },
  'teen@example.com': { state: 'active_restricted', next: null, capabilities: ['chat'], restrictions: { modes: ['manual', 'plan'], bypass: false, remoteExecution: false }, reasons: [] },
  'new@example.com': { state: 'needs_age', next: 'age', capabilities: ['account.complete', 'account.logout', 'account.delete'], restrictions: {}, reasons: ['age not settled'] },
  'minor@example.com': { state: 'guardian_pending', next: 'guardian', capabilities: ['account.complete', 'account.logout', 'account.delete'], restrictions: {}, reasons: ['guardian not verified'] }
}
const auth = createAuth({ DATA: dir, identifyToken: () => null, config: { NODE_ENV: 'test', VESPR_AUTH_ALLOWED_DOMAINS: '*', VESPR_AUTH_SKIP_VERIFY: '1' }, admissionFor: u => byEmail[u.email] })
const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`
const call = (method, p, { token, body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request(new URL(p, base), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
    let t = ''; res.on('data', c => { t += c }); res.on('end', () => { let json = null; try { json = JSON.parse(t) } catch {} resolve({ status: res.statusCode, json, headers: res.headers, text: t }) })
  })
  req.on('error', reject)
  if (body) { const s = JSON.stringify(body); req.setHeader('Content-Type', 'application/json'); req.setHeader('Content-Length', Buffer.byteLength(s)); req.write(s) }
  req.end()
})
const signIn = async (email, deviceLabel) => {
  await call('POST', '/auth/register', { body: { email, password: 'Password12345!' } })
  const r = await call('POST', '/auth/login', { body: { email, password: 'Password12345!', deviceLabel } }); assert.strictEqual(r.status, 200); return r
}

try {
  assert.strictEqual((await call('GET', '/auth/session')).status, 401, 'no session, no answer')
  assert.strictEqual((await call('GET', '/auth/session', { token: 'not-a-token' })).status, 401)

  const adult = (await signIn('adult@example.com', 'Ann laptop')).json.token
  const a = await call('GET', '/auth/session', { token: adult }); assert.strictEqual(a.status, 200)
  assert.deepStrictEqual(Object.keys(a.json).sort(), ['admission', 'device', 'user'])
  assert.deepStrictEqual(Object.keys(a.json.user).sort(), ['id', 'name'], 'no e-mail, no provider ids, no 2FA facts')
  assert.deepStrictEqual(a.json.admission, { state: 'active', next: null, capabilities: ['chat', 'agent.start', 'account.logout'], restrictions: {} }, 'the internal reasons are not sent')
  assert.deepStrictEqual({ label: a.json.device.label, kind: a.json.device.kind, current: a.json.device.current }, { label: 'Ann laptop', kind: 'browser', current: true })
  assert.ok(/^[0-9a-f]{16}$/.test(a.json.device.deviceId)); assert.ok(!a.text.includes(adult), 'the token is never echoed')
  assert.match(a.headers['cache-control'], /no-store/, 'never cached')

  const teen = (await signIn('teen@example.com')).json.token
  assert.deepStrictEqual((await call('GET', '/auth/session', { token: teen })).json.admission.restrictions, { modes: ['manual', 'plan'], bypass: false, remoteExecution: false })

  // blocked accounts still get 200 and their state: the client needs it to show the right screen. Capabilities are only the sign-up pages.
  for (const [email, state, next] of [['new@example.com', 'needs_age', 'age'], ['minor@example.com', 'guardian_pending', 'guardian']]) {
    const tok = (await signIn(email)).json.token; const r = await call('GET', '/auth/session', { token: tok })
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.admission.state, state); assert.strictEqual(r.json.admission.next, next)
    assert.deepStrictEqual(r.json.admission.capabilities, ['account.complete', 'account.logout', 'account.delete'])
  }

  // a cookie session works too (GET needs no CSRF token), and a device made by the desktop return reports kind 'device'
  const cookie = String((await call('POST', '/auth/login', { body: { email: 'adult@example.com', password: 'Password12345!' } })).headers['set-cookie'] || '').split(';')[0]
  assert.strictEqual((await call('GET', '/auth/session', { headers: { Cookie: cookie } })).status, 200)
  assert.strictEqual((await call('POST', '/auth/session', { token: adult })).status, 404, 'read-only: no other method answers')

  // after sign-out or revoke the answer is 401 at once
  assert.strictEqual((await call('POST', '/auth/logout', { token: adult })).status, 200)
  assert.strictEqual((await call('GET', '/auth/session', { token: adult })).status, 401)
  console.log('session endpoint tests passed')
} finally {
  server.close(); fs.rmSync(dir, { recursive: true, force: true })
}
