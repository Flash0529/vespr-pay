import { fileStore } from '../../app/file-store.js'
// The agent answers questions from the Code Map (demo mode), with real authorship from the shared document.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const here = path.dirname(new URL(import.meta.url).pathname)
const sample = path.join(here, '../../sample-project')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-map-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const SPORT = await freePort()
const procs = []
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' }))
  await wait(900)
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'map1', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(SPORT), MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), NEBIUS_API_KEY: '' }, stdio: 'ignore' }))
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'map1', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room')
  const files = fileStore(d); const chat = d.getArray('chat')
  for (const f of fs.readdirSync(sample)) { const t = new Y.Text(); t.insert(0, fs.readFileSync(path.join(sample, f), 'utf8'), { by: f === 'cart.py' ? 'alice' : 'import' }); files.set(f, t) }
  let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const reply = re => until(() => chat.toArray().find(x => x.get('role') === 'agent' && re.test(x.get('text').toString())), 'a reply matching ' + re)

  say('show me the map of this code')
  await reply(/4 files.*imports/s)
  assert.ok(chat.toArray().some(x => x.get('role') === 'tool' && /asked the code map: overview/.test(x.get('text').toString())), 'the tool call is visible in the chat')
  say('what depends on cart.py')
  const r = await reply(/cart\.py is imported directly by test_cart\.py/)
  assert.ok(r)
  console.log('code map agent tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0) }, 300) }
