// One bad WebSocket frame must close that one connection, never take the whole server down. `ws` emits 'error' on the socket for a frame over the size limit, an unmasked
// client frame or invalid bytes; with no listener Node treats it as an uncaught exception and the realtime server exits, so any signed-in person (or share-link guest)
// could end everyone's session. Covers the room socket (server/index.js) and the runner link (server/runners.js).
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import net from 'node:net'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const PORT = await freePort(); const base = `http://127.0.0.1:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-frame-errors-'))
const tok = { alice: crypto.randomBytes(12).toString('hex'), bob: crypto.randomBytes(12).toString('hex') }
fs.writeFileSync(path.join(tmp, 'tokens'), Object.entries(tok).map(([n, t]) => `${n}:${t}`).join('\n') + '\n', { mode: 0o600 })
const srv = spawn('node', ['index.js'], { cwd: path.join(import.meta.dirname, '..'), env: { PATH: process.env.PATH, HOME: tmp, MURMIO_PORT: String(PORT), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(tmp, 'data'), MURMIO_TOKENS_FILE: path.join(tmp, 'tokens'), VESPR_LIMIT_MESSAGE_MB: '1' }, stdio: ['ignore', 'ignore', 'pipe'] })
let log = ''; srv.stderr.on('data', d => { log += d })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }
const alive = async what => { await sleep(700); assert.equal(srv.exitCode, null, `the server must still be running after ${what}:\n` + log.slice(-400)); assert.equal((await fetch(base + '/healthz')).status, 200, 'and still answering after ' + what); n++ }
const open = (p, t) => new Promise((resolve, reject) => { const ws = new WebSocket(`ws://127.0.0.1:${PORT}${p}?token=${t}`); const st = { close: null }; ws.on('close', (c) => { st.close = c }); ws.on('error', () => {}); ws.on('open', () => resolve({ ws, st })); setTimeout(() => reject(new Error('no open for ' + p)), 8000).unref() })
// an unmasked client frame, written by hand after a real upgrade (a browser can never send one; a script can)
const rawUnmasked = (p, t) => new Promise((resolve, reject) => {
  const s = net.connect(PORT, '127.0.0.1'); let got = ''; let sent = false
  s.on('data', d => { got += d.toString('latin1'); if (!sent && /\r\n\r\n/.test(got)) { sent = true; s.write(Buffer.from([0x81, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f])) } }) // FIN+text, length 5, NO mask bit
  s.on('error', () => {}); s.on('close', () => resolve(/^HTTP\/1.1 101/.test(got)))
  s.write(`GET ${p}?token=${t} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`)
  setTimeout(() => { s.destroy(); reject(new Error('the unmasked frame did not close the socket')) }, 6000).unref()
})
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/healthz')).ok) break } catch {} await sleep(100) }
  const a = await open('/ws/r1', tok.alice); const b = await open('/ws/r1', tok.bob)
  a.ws.send(Buffer.alloc(2 * 1024 * 1024, 1)); await alive('one oversized room frame (2 MB against a 1 MB limit)')
  ok(a.st.close === 1009, 'the sender is closed with 1009 (message too big), got ' + a.st.close); ok(b.st.close === null, 'another person in the room is not disconnected')
  const c = await open('/ws/r2', tok.bob); c.ws.send(Buffer.alloc(3 * 1024 * 1024, 2)); await alive('a second oversized frame')
  ok(await rawUnmasked('/ws/r3', tok.alice), 'the room socket upgraded, then closed on the unmasked frame'); await alive('an unmasked frame on the room socket')
  ok(await rawUnmasked('/runner', tok.alice), 'the runner link upgraded, then closed on the unmasked frame'); await alive('an unmasked frame on the runner link')
  const r = await open('/runner?label=x&os=linux&arch=x64&y=1'.split('?')[0], tok.bob); r.ws.send(Buffer.alloc(120 * 1024 * 1024, 3)); await alive('a 120 MB frame on the runner link (its limit is the 100 MB default)')
  const d = await open('/ws/r4', tok.alice); ok(d.ws.readyState === 1, 'and a fresh session works normally afterwards')
  console.log(`ws frame error tests passed (${n}): an oversized frame (1009) or an unmasked frame closes only its sender, on the room socket and on the runner link; the server and the other person carry on`)
} finally { srv.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }) }
process.exit(0)
