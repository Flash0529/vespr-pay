import { fileStore } from '../../app/file-store.js'
// Catch-up digest in demo mode: someone was away, others chatted, approved, ran things and edited; the agent lists what they missed.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-dig-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\nbob:tok-b\ncoder:tok-c\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const join = async token => { const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room4', d, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true }); await new Promise(r => p.once('sync', r)); return { d, p } }
let agent
try {
  await wait(800)
  const alice = await join('tok-a'); const bob = await join('tok-b')
  const t = new Y.Text(); t.insert(0, 'line one\n', { by: 'import' }); fileStore(alice.d).set('notes.txt', t)
  agent = spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room4', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: String(await freePort()) }, stdio: 'ignore' })
  await until(() => [...alice.p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 30000) // not a fixed sleep: a loaded machine takes seconds to start the agent, and it ignores messages sent before it did
  const since = Date.now() - 1000
  const msg = (d, author, text, extra = {}) => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', author + Math.random().toString(36).slice(2, 6)); m.set('ts', Date.now()); m.set('author', author); m.set('isAgent', false); m.set('role', extra.role || 'user'); m.set('text', tx); for (const [k, v] of Object.entries(extra)) if (k !== 'role') m.set(k, v); d.getArray('chat').push([m]); tx.insert(0, text) }); return m }
  // while bob was away, alice talked, approved something, switched the mode and edited the notes
  msg(alice.d, 'alice', 'I am rewriting the intro, please do not touch notes.txt')
  msg(alice.d, 'alice', 'set the agent mode to auto', { role: 'tool' })
  msg(alice.d, 'coder', 'Run on sandbox: python3 a.py', { role: 'approval', isAgent: true, status: 'approved', decidedBy: 'alice', kind: 'command', detail: '' })
  msg(alice.d, 'coder', 'coder asked to pay $25.00 for Logo design invoice (approved by alice; PayPal captured it). PayPal sandbox, no real money.', { role: 'payment', isAgent: true, status: 'captured', decidedBy: 'alice' })
  msg(alice.d, 'coder', 'coder asks to pay $9.00 for Still waiting (waiting for a person to approve). PayPal sandbox, no real money.', { role: 'payment', isAgent: true, status: 'pending' })
  t.insert(t.length, 'line two\nline three\nline four\n', { by: 'alice', t: Math.floor(Date.now() / 60000) })
  await wait(600)
  const ask = msg(bob.d, 'bob', '@coder catch me up', { since })
  const reply = await until(() => bob.d.getArray('chat').toArray().find(m => m.get('author') === 'coder' && m.get('role') === 'agent' && /Catch-up for bob/.test(m.get('text').toString())), 'digest reply')
  const text = reply.get('text').toString()
  assert.match(text, /alice said: I am rewriting the intro/); assert.match(text, /alice switched agents to auto mode/); assert.match(text, /alice approved "Run on sandbox: python3 a\.py"/)
  assert.match(text, /coder asked to pay \$25\.00 for Logo design invoice \(approved by alice; PayPal captured it\)/, 'a payment with an outcome is in the digest'); assert.ok(!/Still waiting/.test(text), 'a payment still waiting is not an event yet')
  assert.match(text, /alice changed notes\.txt \(about 3 lines\)/); assert.ok(!/bob said/.test(text), 'does not repeat the asker\'s own messages')
  // nothing missed
  const ask2 = msg(alice.d, 'alice', '@coder catch me up', { since: Date.now() + 1000 })
  const r2 = await until(() => alice.d.getArray('chat').toArray().find(m => m.get('author') === 'coder' && /Catch-up for alice/.test(m.get('text').toString()) && /Nothing happened/.test(m.get('text').toString())), 'empty digest')
  console.log('digest tests passed:\n' + text)
  alice.p.destroy(); bob.p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { agent && agent.kill(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(), 200) }
