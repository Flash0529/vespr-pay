// The app's client (app/vespr-client.js) carries the live activity log and the checklist into its snapshot: a tool step's tool, status
// and times (running first, then done), each agent's plan, and old-style tool entries with backward-compatible defaults ('' and null).
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { createClient } from '../../app/vespr-client.js'

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => (err ? reject(err) : resolve(p))) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-activity-client-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, agent
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT
  alice = createClient({ server, room: 'act', token: 'tok-a', name: 'alice', color: '#a5b4fc', deps: { Y, WebsocketProvider, WebSocketPolyfill: WebSocket } })
  const changes = []; alice.on('change', w => changes.push(w))
  assert.deepStrictEqual(alice.get().plans, {}, 'before connecting the snapshot already has an empty plans map')
  await alice.ready
  agent = joinRoom({ server, room: 'act', token: 'tok-c', name: 'coder', color: 'hsl(170, 70%, 55%)', model: 'fake-model' }); await agent.ready

  // a live step: visible as running (no end time) before it finishes
  const step = agent.startStep('read_file', 'Reading a.py')
  const running = await until(() => alice.get().messages.find(m => m.id === step.id), 'the running step reaches the client')
  assert.strictEqual(running.role, 'tool'); assert.strictEqual(running.tool, 'read_file'); assert.strictEqual(running.status, 'running')
  assert.strictEqual(running.text, 'Reading a.py'); assert.ok(Number.isFinite(running.started)); assert.strictEqual(running.ended, null)

  // finished in place: the note replaces the running text, with status and an end time
  await wait(20); step.finish('read a.py', true)
  const done = await until(() => { const m = alice.get().messages.find(x => x.id === step.id); return m && m.status === 'done' && m }, 'the step finishes')
  assert.strictEqual(done.text, 'read a.py'); assert.strictEqual(done.tool, 'read_file')
  assert.ok(Number.isFinite(done.ended) && done.ended >= done.started, 'start and end times are numbers')

  // a failed step keeps its own status
  const bad = agent.startStep('run_command', '$ false'); bad.finish('$ false\n[exit 1]', false)
  const failed = await until(() => { const m = alice.get().messages.find(x => x.id === bad.id); return m && m.status === 'failed' && m }, 'the failed step arrives')
  assert.match(failed.text, /\[exit 1\]$/)

  // an old-style tool entry (no tool/status/times, as older agents and git push write them) gets safe defaults
  agent.say('read old.py', 'tool')
  const old = await until(() => alice.get().messages.find(m => m.role === 'tool' && m.text === 'read old.py'), 'the old-style entry arrives')
  assert.strictEqual(old.tool, ''); assert.strictEqual(old.started, null); assert.strictEqual(old.ended, null); assert.strictEqual(old.status, '')

  // the checklist: plain objects in the snapshot, and a change redraws the chat
  const before = changes.filter(w => w === 'chat').length
  agent.setPlan([{ text: 'Read', status: 'done' }, { text: 'Fix', status: 'in_progress' }])
  const plan = await until(() => alice.get().plans.coder, 'the plan reaches the client')
  assert.deepStrictEqual(plan.items, [{ text: 'Read', status: 'done' }, { text: 'Fix', status: 'in_progress' }])
  assert.ok(Number.isFinite(plan.updated))
  await until(() => changes.filter(w => w === 'chat').length > before, 'a plan change fires a chat change')

  // History: a timed command step shows how long it took; an untimed one stays as before
  const cmd = agent.startStep('run_command', '$ python3 -m unittest -q'); await wait(30); cmd.finish('$ python3 -m unittest -q\nOK\n[exit 0]', true)
  await until(() => { const m = alice.get().messages.find(x => x.id === cmd.id); return m && m.status === 'done' }, 'the command step finishes')
  const h = alice.history().find(e => e.id === 'r-' + cmd.id)
  assert.ok(h, 'the command is in History'); assert.match(h.detail, /^\[exit 0\] · \d+(\.\d)?s$/)
  const hOld = alice.history().find(e => e.id === 'r-' + bad.id); assert.match(hOld.detail, /^\[exit 1\] · \d+(\.\d)?s$/)
  console.log('activity client tests passed')
} catch (e) {
  console.error(e); process.exitCode = 1
} finally {
  try { alice && alice.destroy() } catch {}
  try { agent && agent.destroy() } catch {}
  srv.kill(); await wait(100); fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0)
}
