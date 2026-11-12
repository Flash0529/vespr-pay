// Live check of the share hooks in server/index.js: starts the real server on 127.0.0.1:9461 with a temp data dir and generated tokens,
// then two real Yjs peers prove that a view link cannot write, an edit link can, and revoke closes the socket. No outside network.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
const require = createRequire(import.meta.url)
const Y = require('yjs'); const { WebsocketProvider } = require('y-websocket')

import net from 'node:net'
const usedTestPorts = new Set()
const freePort = () => new Promise((resolve, reject) => {
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
const PORT = await freePort(); const base = `http://127.0.0.1:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'share-live-'))
const aliceTok = crypto.randomBytes(12).toString('hex')
fs.writeFileSync(path.join(tmp, 'tokens'), `alice:${aliceTok}\n`, { mode: 0o600 })
const srv = spawn('node', ['index.js'], { cwd: path.join(import.meta.dirname, '..'), env: { PATH: process.env.PATH, HOME: tmp, VESPR_SHARE: '1', MURMIO_PORT: String(PORT), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(tmp, 'data'), MURMIO_TOKENS_FILE: path.join(tmp, 'tokens') }, stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (f, what) => { for (let i = 0; i < 100; i++) { if (f()) return; await sleep(50) } throw new Error('timed out: ' + what) }
const api = (route, body, tok) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }))
const peer = (room, token) => { const doc = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, room, doc, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true }); return { doc, p, text: () => doc.getText('t').toString() } }
const closes = []
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break } catch {} await sleep(100) }
  const viewL = (await api('/api/share/create', { room: 'live', role: 'view' }, aliceTok)).json
  const editL = (await api('/api/share/create', { room: 'live', role: 'edit' }, aliceTok)).json
  assert.ok(viewL.token && editL.token)
  const alice = peer('live', aliceTok); await until(() => alice.p.synced, 'alice sync')
  alice.doc.getText('t').insert(0, 'hello')
  const viewer = peer('live', viewL.token); await until(() => viewer.p.synced, 'viewer sync')
  assert.equal(viewer.text(), 'hello', 'a view guest sees the room')
  viewer.p.ws.addEventListener('close', e => closes.push(e.code))
  viewer.doc.getText('t').insert(5, ' from viewer'); await sleep(600)
  assert.equal(alice.text(), 'hello', 'the view guest\'s edit never reaches the room')
  alice.doc.getText('t').insert(5, '!'); await sleep(400); assert.ok(viewer.text().includes('!'), 'the view guest still receives live edits')
  const editor = peer('live', editL.token); await until(() => editor.p.synced, 'editor sync')
  editor.doc.getText('t').insert(6, ' hi'); await until(() => alice.text() === 'hello! hi', 'edit link write')
  const other = peer('other-room', viewL.token); await sleep(800); assert.equal(other.p.synced, false, 'a link opens only its own room')
  assert.equal((await fetch(base + '/api/friends', { headers: { Authorization: 'Bearer ' + viewL.token } })).status, 401, 'a link token is not a login')
  await api('/api/share/revoke', { id: viewL.id }, aliceTok); await until(() => closes.includes(4403), 'revoke closes the socket')
  for (const x of [alice, viewer, editor, other]) x.p.destroy()
  console.log('live share tests passed: view guest reads but cannot write, edit guest writes, other room refused, link is not a login, revoke closes the socket (4403)')
} finally { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }) }
process.exit(0)
