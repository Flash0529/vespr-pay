// One computer, one person (auth.js deviceGate): a computer (the desktop app's hashed hardware ID, x-vespr-device) takes at most one
// personal and one business account; another account of the same kind is refused; the bound account can release it; browsers
// (no key) are not affected.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'device-binding-'))
const auth = createAuth({ DATA, identifyToken: () => null, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1' } })
const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
let ip = 0
const post = async (p, body, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.0.' + (++ip), ...headers }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
const PW = 'a-long-password-1'
const K = 'a'.repeat(64), K2 = 'b'.repeat(64)
const login = (email, key) => post('/auth/login', { email, password: PW }, key ? { 'x-vespr-device': key } : {})
const tokenOf = r => r.j.token || r.j.sessionToken
let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

await t('one personal and one business account per computer; release frees it; browsers are not bound', async () => {
  for (const [email, name] of [['ann@gmail.com', 'Ann'], ['ben@gmail.com', 'Ben'], ['cy@acme-corp.test', 'Cy'], ['di@acme-corp.test', 'Di']]) assert.ok([200, 201].includes((await post('/auth/register', { email, password: PW, name })).s), 'register ' + name)
  const a = await login('ann@gmail.com', K); assert.strictEqual(a.s, 200, 'the first personal account binds this computer')
  const b = await login('ben@gmail.com', K); assert.strictEqual(b.s, 403); assert.strictEqual(b.j.code, 'device_bound'); assert.match(b.j.error, /already used by Ann for personal work/)
  assert.strictEqual((await login('cy@acme-corp.test', K)).s, 200, 'a business account (work email) takes the other slot')
  assert.strictEqual((await login('di@acme-corp.test', K)).s, 403, 'but only one')
  assert.strictEqual((await login('ann@gmail.com', K)).s, 200, 'switching back is fine')
  assert.strictEqual((await login('ben@gmail.com')).s, 200, 'a browser sends no key: not bound')
  assert.strictEqual((await login('ben@gmail.com', 'not-a-key')).s, 200, 'a malformed key is ignored, not trusted')
  assert.strictEqual((await login('ben@gmail.com', K2)).s, 200, 'another computer is free')
  assert.strictEqual((await post('/auth/device/release', {}, { 'x-vespr-device': K })).s, 401, 'release needs sign-in')
  const rel = await post('/auth/device/release', {}, { 'x-vespr-device': K, Authorization: 'Bearer ' + tokenOf(a) })
  assert.deepStrictEqual([rel.s, rel.j.released], [200, true], 'Ann releases this computer')
  assert.strictEqual((await login('ben@gmail.com', K)).s, 200, 'now Ben may use it')
  const raw = fs.readFileSync(path.join(DATA, 'auth', 'device-bindings.json'), 'utf8'); assert.doesNotMatch(raw, /ann@|ben@|password/i, 'only ids and hashed keys are stored')
  assert.strictEqual(fs.statSync(path.join(DATA, 'auth', 'device-bindings.json')).mode & 0o077, 0, 'private file')
})

srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`device binding tests passed (${n})`)
