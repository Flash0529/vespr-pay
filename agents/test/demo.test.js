import { fileStore } from '../../app/file-store.js'
// The demo script, end to end in demo mode, using the real sample project: run the failing tests, ask the agent to fix the bug,
// watch it edit and re-run, and see the tests pass. (With a real model this same conversation is done for real.)
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const here = path.dirname(new URL(import.meta.url).pathname)
const sample = path.join(here, '../../sample-project')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-demo-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const procs = []
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' }))
  await wait(900)
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'demo9', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: String(await freePort()) }, stdio: 'ignore' }))
  await wait(1800)
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'demo9', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 15000)
  const files = fileStore(d); const chat = d.getArray('chat')
  for (const f of fs.readdirSync(sample)) { const t = new Y.Text(); t.insert(0, fs.readFileSync(path.join(sample, f), 'utf8'), { by: 'import' }); files.set(f, t) }
  d.getMap('settings').set('agentMode', 'auto')
  let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); tx.insert(0, '@coder ' + text); chat.push([m]) }) }
  const find = (role, re) => chat.toArray().filter(m => m.get('role') === role && re.test(m.get('text').toString()))

  say('run python3 -m unittest -q')
  const red = await until(() => find('tool', /\$ python3 -m unittest -q[\s\S]*\[exit 1\]/)[0], 'failing tests')
  assert.match(red.get('text').toString(), /(?:^|\n)(?:FAILED\b|FAIL:)/) // the summary can be beyond the command display cap in a long workspace path

  say('fix the discount bug in cart.py and run the tests again')
  await until(() => /amount \* \(1 - percent \/ 100\)/.test(files.get('cart.py').toString()), 'bug fixed in the shared file')
  const green = await until(() => find('tool', /\$ python3 -m unittest -q[\s\S]*\[exit 0\]/)[0], 'tests pass after the fix')
  assert.match(green.get('text').toString(), /OK/)
  assert.strictEqual(find('approval', /./).length, 0, 'Auto mode: edit and the test run needed no approval')
  const attr = files.get('cart.py').toDelta().find(op => op.attributes && op.attributes.ai)
  assert.ok(attr && attr.attributes.by === 'coder', 'the fix is attributed to the agent')
  await until(() => find('agent', /Ran it, exit code 0/)[0], 'closing reply')
  console.log('demo scenario passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit() }, 300) }
