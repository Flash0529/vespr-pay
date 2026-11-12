// Device revocation: signing a device out (or logging out) must also close what that session already opened, and never touch anyone else's.
// Real auth module, fake sockets (same idea as share.test.js), no network.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAuth } from '../auth.js'
import { createSocketRegistry, CLOSE_SIGNED_OUT } from '../sockets.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-device-revoke-'))
let clock = 1_800_000_000_000
const auth = createAuth({
  DATA: dir,
  identifyToken: t => (t === 'static-tok' ? 'judge' : null),
  config: { NODE_ENV: 'test', VESPR_AUTH_ALLOWED_DOMAINS: '*', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/prototype.html' },
  now: () => clock
})
const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

function call (method, p, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(p, base), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers } }, res => {
      let t = ''; res.on('data', c => { t += c }); res.on('end', () => { let json = null; try { json = JSON.parse(t) } catch {} resolve({ status: res.statusCode, json }) })
    })
    req.on('error', reject)
    if (body) { const s = JSON.stringify(body); req.setHeader('Content-Type', 'application/json'); req.setHeader('Content-Length', Buffer.byteLength(s)); req.write(s) }
    req.end()
  })
}
async function newUser (email) {
  assert.strictEqual((await call('POST', '/auth/register', { body: { email, password: 'Password12345!' } })).status, 201)
}
async function login (email, deviceLabel) {
  const r = await call('POST', '/auth/login', { body: { email, password: 'Password12345!', deviceLabel } })
  assert.strictEqual(r.status, 200, 'login ' + email)
  return r.json.token
}
// A fake websocket: records the close code and fires 'close' handlers like a real one does.
function fakeWs () {
  const w = { closed: null, handlers: [], on (ev, fn) { if (ev === 'close') w.handlers.push(fn) }, close (code, reason) { if (w.closed) return; w.closed = { code, reason }; w.handlers.forEach(f => f()) } }
  return w
}

try {
  await newUser('ann@example.com'); await newUser('bob@example.com')
  const annLaptop = await login('ann@example.com', 'Ann laptop')
  const annPhone = await login('ann@example.com', 'Ann phone')
  const bob = await login('bob@example.com')

  // --- listing: own devices only, never a token or hash
  assert.strictEqual((await call('GET', '/auth/devices')).status, 401, 'listing needs a session')
  const list = (await call('GET', '/auth/devices', { token: annLaptop })).json.devices
  assert.strictEqual(list.length, 2)
  assert.deepStrictEqual(list.map(d => d.label).sort(), ['Ann laptop', 'Ann phone'])
  assert.strictEqual(list.filter(d => d.current).length, 1)
  assert.strictEqual(list.find(d => d.current).label, 'Ann laptop', 'the caller\'s own device is marked current')
  const flat = JSON.stringify(list)
  for (const secret of [annLaptop, annPhone, bob]) assert.ok(!flat.includes(secret), 'a token must never be listed')
  assert.ok(list.every(d => /^[0-9a-f]{16}$/.test(d.deviceId) && !flat.includes(d.deviceId + d.deviceId)), 'device ids are opaque ids')
  assert.strictEqual((await call('GET', '/auth/devices', { token: bob })).json.devices.length, 1, 'bob sees only his own device')

  // --- sockets opened by each session
  const live = new Set(); const reg = createSocketRegistry({ sessionKey: auth.sessionKey, sessionLive: auth.sessionLive })
  auth.onRevoke(({ keys }) => reg.closeSessions(keys))
  const wsLaptop1 = fakeWs(); const wsLaptop2 = fakeWs(); const wsPhone = fakeWs(); const wsBob = fakeWs(); const wsStatic = fakeWs()
  assert.strictEqual(reg.attach(wsLaptop1, annLaptop), true); reg.attach(wsLaptop2, annLaptop); reg.attach(wsPhone, annPhone); reg.attach(wsBob, bob)
  assert.strictEqual(reg.attach(wsStatic, 'static-tok'), false, 'a static token is not a session: not tracked, never closed by a revoke')
  assert.strictEqual(reg.size(), 4)

  // --- revoke one device: its token dies, its sockets close, nothing else changes
  const phoneId = list.find(d => d.label === 'Ann phone').deviceId
  const bobId = (await call('GET', '/auth/devices', { token: bob })).json.devices[0].deviceId
  assert.strictEqual((await call('POST', '/auth/devices/revoke', { token: annLaptop, body: { deviceId: bobId } })).status, 404, 'cannot revoke someone else\'s device (looks like no device)')
  assert.ok(auth.identify(bob), 'bob is untouched by ann\'s attempt')
  assert.strictEqual((await call('POST', '/auth/devices/revoke', { token: annLaptop })).status, 400, 'a device id is required')
  const rv = await call('POST', '/auth/devices/revoke', { token: annLaptop, body: { deviceId: phoneId } })
  assert.strictEqual(rv.status, 200); assert.strictEqual(rv.json.revoked, 1)
  assert.strictEqual(auth.identify(annPhone), null, 'a copied token is refused after revoke')
  assert.deepStrictEqual(wsPhone.closed && wsPhone.closed.code, CLOSE_SIGNED_OUT, 'the revoked device\'s socket is closed')
  assert.strictEqual(wsLaptop1.closed, null); assert.strictEqual(wsLaptop2.closed, null); assert.strictEqual(wsBob.closed, null); assert.strictEqual(wsStatic.closed, null)
  assert.strictEqual(reg.size(), 3, 'the closed socket left the registry')
  assert.strictEqual((await call('POST', '/auth/devices/revoke', { token: annLaptop, body: { deviceId: phoneId } })).status, 404, 'revoking twice is a clean not-found, not a crash')
  assert.strictEqual((await call('GET', '/auth/devices', { token: annPhone })).status, 401, 'the revoked token cannot list devices')

  // --- logout of one device closes that device's sockets only
  assert.strictEqual((await call('POST', '/auth/logout', { token: annLaptop })).status, 200)
  assert.strictEqual(auth.identify(annLaptop), null)
  assert.ok(wsLaptop1.closed && wsLaptop2.closed, 'logout closes every socket that session opened')
  assert.strictEqual(wsLaptop1.closed.code, CLOSE_SIGNED_OUT)
  assert.strictEqual(wsBob.closed, null, 'another user\'s socket stays open')
  assert.strictEqual(reg.size(), 1)

  // --- revoking the current device from itself is allowed and closes its own sockets
  const ann2 = await login('ann@example.com', 'Ann tablet'); const ws2 = fakeWs(); reg.attach(ws2, ann2)
  const id2 = (await call('GET', '/auth/devices', { token: ann2 })).json.devices[0].deviceId
  assert.strictEqual((await call('POST', '/auth/devices/revoke', { token: ann2, body: { deviceId: id2 } })).status, 200)
  assert.ok(ws2.closed, 'signing out this device closes its own sockets')

  // --- expiry: the sweep closes sockets whose session ran out, without any request
  const wsOld = fakeWs(); reg.attach(wsOld, bob)
  assert.strictEqual(reg.sweep(), 0, 'nothing expired yet')
  clock += 31 * 24 * 60 * 60 * 1000
  assert.strictEqual(auth.identify(bob), null, 'the session expired')
  assert.strictEqual(reg.sweep(), 2, 'both of bob\'s sockets are closed by the sweep')
  assert.ok(wsOld.closed && wsBob.closed); assert.strictEqual(reg.size(), 0)

  // --- a socket that closes by itself leaves the registry
  clock += 0
  const ann3 = await login('ann@example.com', 'again'); const wsSelf = fakeWs(); reg.attach(wsSelf, ann3)
  assert.strictEqual(reg.size(), 1); wsSelf.close(1000, 'client left'); assert.strictEqual(reg.size(), 0, 'no leak when a client disconnects')

  // --- the registry is safe to call with nonsense
  assert.strictEqual(reg.attach(fakeWs(), ''), false); assert.strictEqual(reg.attach(fakeWs(), undefined), false)
  assert.doesNotThrow(() => reg.closeSessions(['no-such-session', null, undefined]))
  void live
  console.log('device revoke tests passed')
} finally {
  server.close(); fs.rmSync(dir, { recursive: true, force: true })
}
