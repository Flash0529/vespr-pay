// Live check of direct messages on the real server (VESPR_SHARE=1 VESPR_DM=1, no auth module): friends make a private room, only members open it, messages travel, share links and
// squatting do not work. Real Yjs peers over real WebSockets on 127.0.0.1. No outside network.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
const require = createRequire(import.meta.url)
const Y = require('yjs'); const { WebsocketProvider } = require('y-websocket')

const port = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const base = `http://127.0.0.1:${port}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-live-'))
const tok = Object.fromEntries(['alice', 'bob', 'carol'].map(n => [n, crypto.randomBytes(12).toString('hex')]))
fs.writeFileSync(path.join(tmp, 'tokens'), Object.entries(tok).map(([n, t]) => `${n}:${t}`).join('\n'), { mode: 0o600 })
const srv = spawn('node', ['index.js'], { cwd: path.join(import.meta.dirname, '..'), env: { PATH: process.env.PATH, HOME: tmp, VESPR_SHARE: '1', VESPR_DM: '1', MURMIO_PORT: String(port), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(tmp, 'data'), MURMIO_TOKENS_FILE: path.join(tmp, 'tokens') }, stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/healthz')).ok) break } catch {} await sleep(250) }
const api = async (who, method, p, body) => { const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + tok[who], 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) } }
const joins = (who, room) => new Promise(res => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${room}?token=${tok[who]}`); ws.on('open', () => { ws.close(); res('open') }); ws.on('unexpected-response', (q, r) => res(r.statusCode)); ws.on('error', () => res('error')) })
try {
  // not friends yet: refused
  assert.strictEqual((await api('alice', 'POST', '/api/dm/open', { with: ['bob'] })).status, 403)
  // become friends through the real friends API
  assert.strictEqual((await api('alice', 'POST', '/api/friends/request', { to: 'bob' })).status, 200); assert.strictEqual((await api('bob', 'POST', '/api/friends/accept', { from: 'alice' })).status, 200)
  const open = await api('alice', 'POST', '/api/dm/open', { with: ['bob'] }); assert.strictEqual(open.status, 200); const room = open.json.thread.room; assert.match(room, /^dm-[a-f0-9]{16}$/)
  assert.strictEqual((await api('bob', 'GET', '/api/dm/list')).json.threads[0].room, room); assert.strictEqual((await api('carol', 'GET', '/api/dm/list')).json.threads.length, 0)
  // only members open the room
  assert.strictEqual(await joins('alice', room), 'open'); assert.strictEqual(await joins('bob', room), 'open'); assert.strictEqual(await joins('carol', room), 403, 'a non-member is refused at the door')
  assert.strictEqual(await joins('alice', 'dm-0123456789abcdef'), 403, 'a room that was never made cannot be squatted'); assert.strictEqual(await joins('alice', 'ordinary-room'), 'open', 'other rooms are unchanged')
  // a share link cannot be made for it
  assert.strictEqual((await api('alice', 'POST', '/api/share/create', { room, role: 'edit' })).status, 403)
  // messages travel between the two
  const peer = who => { const doc = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${port}/ws`, room, doc, { WebSocketPolyfill: WebSocket, params: { token: tok[who] }, disableBc: true }); return { doc, p } }
  const a = peer('alice'), b = peer('bob'); await Promise.all([a, b].map(x => new Promise(r => x.p.once('sync', r))))
  a.doc.transact(() => { const m = new Y.Map(); const t = new Y.Text(); m.set('id', 'a-1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('role', 'user'); m.set('text', t); a.doc.getArray('chat').push([m]); t.insert(0, 'hello bob') })
  for (let i = 0; i < 50 && b.doc.getArray('chat').length === 0; i++) await sleep(100)
  assert.strictEqual(String(b.doc.getArray('chat').get(0).get('text')), 'hello bob', 'bob receives it'); a.p.destroy(); b.p.destroy()
  // a group: carol joins only after being friends with the opener
  assert.strictEqual((await api('alice', 'POST', '/api/dm/open', { with: ['bob', 'carol'] })).status, 403)
  console.log('direct message live tests passed: friends only, members only, squatting and share links refused, messages travel')
} catch (e) { console.error(e); process.exitCode = 1 } finally { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 200) }
