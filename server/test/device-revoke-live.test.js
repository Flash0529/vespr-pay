// The real server process: signing a device out closes the websockets and runner link that device opened, and nobody else's.
// Starts server/index.js with accounts on (MURMIO_AUTH=1), registers two people, opens real sockets. No network beyond 127.0.0.1.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'

const PORT = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'device-revoke-live-'))
const staticTok = crypto.randomBytes(12).toString('hex')
fs.writeFileSync(path.join(tmp, 'tokens'), `judge:${staticTok}\n`, { mode: 0o600 })
const srv = spawn('node', ['index.js'], { cwd: path.join(import.meta.dirname, '..'), stdio: 'ignore', env: {
  PATH: process.env.PATH, HOME: tmp, MURMIO_AUTH: '1', VESPR_AUTH_ALLOWED_DOMAINS: '*', VESPR_AUTH_SKIP_VERIFY: '1',
  MURMIO_PORT: String(PORT), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(tmp, 'data'), MURMIO_TOKENS_FILE: path.join(tmp, 'tokens') } })
const base = `http://127.0.0.1:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (f, what) => { for (let i = 0; i < 100; i++) { if (await f()) return; await sleep(50) } throw new Error('timed out: ' + what) }
const api = (route, body, tok, method = 'POST') => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }))

// open a socket and record how it ends
function open (url) {
  const s = { ws: new WebSocket(url), open: false, closed: null }
  s.ws.on('open', () => { s.open = true })
  s.ws.on('close', code => { s.closed = code })
  s.ws.on('error', () => {})
  return s
}

try {
  await until(async () => { try { return (await fetch(base + '/auth/providers')).ok } catch { return false } }, 'server up')
  const user = async (email, label) => {
    await api('/auth/register', { email, password: 'Password12345!' })
    return (await api('/auth/login', { email, password: 'Password12345!', deviceLabel: label })).json.token
  }
  const ann1 = await user('ann@example.com', 'laptop')
  const ann2 = (await api('/auth/login', { email: 'ann@example.com', password: 'Password12345!', deviceLabel: 'phone' })).json.token
  assert.ok(ann1 && ann2 && ann1 !== ann2, 'two devices, two tokens')

  const a1 = open(`ws://127.0.0.1:${PORT}/ws/room-one?token=${ann1}`)
  const a2 = open(`ws://127.0.0.1:${PORT}/ws/room-one?token=${ann2}`)
  const st = open(`ws://127.0.0.1:${PORT}/ws/room-one?token=${staticTok}`)
  const rn = open(`ws://127.0.0.1:${PORT}/runner?token=${ann1}&label=ann-laptop&os=linux&arch=x64`)
  await until(() => a1.open && a2.open && st.open && rn.open, 'all sockets open')
  const runners = (await api('/api/runners', null, ann1, 'GET')).json
  assert.ok(runners.some(r => r.label === 'ann-laptop'), 'the runner link is registered')

  // a socket with a bad token never opens (unchanged behaviour)
  const bad = open(`ws://127.0.0.1:${PORT}/ws/room-one?token=nope`)
  await until(() => bad.closed !== null || bad.ws.readyState === 3, 'bad token refused'); assert.strictEqual(bad.open, false)

  // revoke the laptop: its document socket and its runner link close with 4401; the phone and the static-token socket stay
  const devices = (await api('/auth/devices', null, ann2, 'GET')).json.devices
  const laptopId = devices.find(d => d.label === 'laptop').deviceId
  assert.strictEqual((await api('/auth/devices/revoke', { deviceId: laptopId }, ann2)).status, 200)
  await until(() => a1.closed !== null && rn.closed !== null, 'revoked sockets closed')
  assert.strictEqual(a1.closed, 4401); assert.strictEqual(rn.closed, 4401)
  await sleep(200)
  assert.strictEqual(a2.closed, null, 'the other device stays connected'); assert.strictEqual(st.closed, null, 'a static-token socket is not a session')
  assert.strictEqual((await api('/auth/devices', null, ann1, 'GET')).status, 401, 'the copied laptop token is refused')
  assert.ok(!(await api('/api/runners', null, ann2, 'GET')).json.some(r => r.label === 'ann-laptop'), 'the runner left the list')

  // logout closes what that session opened
  assert.strictEqual((await api('/auth/logout', {}, ann2)).status, 200)
  await until(() => a2.closed !== null, 'logout closed the socket')
  assert.strictEqual(a2.closed, 4401); assert.strictEqual(st.closed, null)
  console.log('device revoke live tests passed')
} catch (e) {
  console.error(e)
  process.exitCode = 1
} finally {
  srv.kill()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(process.exitCode || 0)
}
