// Inline suggestions end to end in demo mode: client -> realtime server (/api/suggest) -> agent worker. Teammate-aware context included.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-sug-'))
const tokens = path.join(dir, 'tokens'); fs.writeFileSync(tokens, 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const SPORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const procs = []
process.on('exit', () => { for (const x of procs) { try { x.kill('SIGKILL') } catch {} } })

const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: tokens, MURMIO_SUGGEST_UPSTREAM: `http://127.0.0.1:${SPORT}/suggest` }, stdio: 'ignore' })
procs.push(srv)
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(100) } throw new Error('timed out waiting for: ' + what) }
let agent
const ask = (token, prefix, suffix = '') => fetch(`http://127.0.0.1:${PORT}/api/suggest`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'a.py', language: 'python', prefix, suffix }) })
try {
  await wait(800)
  agent = spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room3', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: SPORT, MURMIO_TOKENS_FILE: tokens }, stdio: 'ignore' })
  procs.push(agent)
  await until(async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${SPORT}/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      return res.status !== 0
    } catch { return false }
  }, 'agent suggest upstream ready')
  assert.strictEqual((await ask('wrong', 'def f(')).status, 401, 'bad token refused')
  let r = await ask('tok-a', 'import os\n\ndef parse_args(x):')
  assert.strictEqual(r.status, 200); let j = await r.json()
  assert.match(j.text, /"""parse args\."""/, 'suggests a docstring under a def line'); assert.match(j.model, /demo/)
  r = await ask('tok-a', 'x = 1\nprint('); j = await r.json(); assert.strictEqual(j.text, '"hello")')
  r = await ask('tok-a', 'def f():\n    ', ''); j = await r.json(); assert.strictEqual(j.text, '', 'nothing useful to add: empty suggestion')
  // teammate-aware: a teammate (the agent) just edited; a blank line now gets a suggestion that uses that signal
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room3', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(res => p.once('sync', res))
  const m = new Y.Map(); d.transact(() => { m.set('ts', Date.now()); m.set('file', 'a.py'); m.set('by', 'coder'); m.set('model', 'x'); m.set('msgId', ''); m.set('summary', 'edited a.py'); d.getArray('provenance').push([m]) })
  await wait(600)
  r = await ask('tok-a', 'def f():\n    pass\n\n'); j = await r.json()
  assert.match(j.text, /coder edited a\.py/, 'uses what the teammate just did'); assert.ok(j.used.includes("coder's edit"), 'reports which signals it used')
  console.log('suggestion tests passed:', JSON.stringify(j))
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) { try { x.kill('SIGKILL') } catch {} } ; try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} ; setTimeout(() => process.exit(process.exitCode || 0), 200) }
