// The demo token budget: unit behaviour with a fake clock, then a live agent that stops answering with the model once the budget is gone.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { createBudget, budgetMessage } from '../src/budget.js'

let t = 1_000_000; const b = createBudget({ cap: 100, windowMs: 1000, now: () => t })
assert.strictEqual(b.exhausted(), false); b.spend(60); assert.strictEqual(b.left(), 40); b.spend(50); assert.strictEqual(b.exhausted(), true)
t += 1001; assert.strictEqual(b.exhausted(), false, 'the window rolled over'); assert.strictEqual(b.used(), 0)
assert.strictEqual(createBudget({ cap: 0 }).exhausted(), false, 'cap 0 means no limit'); assert.strictEqual(createBudget().left(), Infinity)
assert.match(budgetMessage(createBudget({ cap: 5000 })), /5,000 tokens.*refills at \d\d:\d\d UTC/)

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const here = path.dirname(new URL(import.meta.url).pathname)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-bud-')); fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const SPORT = await freePort(); const procs = []
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), MURMIO_SUGGEST_UPSTREAM: `http://127.0.0.1:${SPORT}/suggest` }, stdio: 'ignore' })); await wait(900)
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'bud', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(SPORT), MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), NEBIUS_API_KEY: '', MURMIO_TOKEN_CAP: '50' }, stdio: 'ignore' })); await wait(1800)
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'bud', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true }); await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 15000)
  const chat = d.getArray('chat'); let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); tx.insert(0, '@coder ' + text); chat.push([m]) }) }
  say('hello there'); await until(() => chat.toArray().some(x => x.get('role') === 'agent' && /demo-mode/.test(x.get('text').toString())), 'the first answer, within budget')
  say('hello again'); const msg = await until(() => chat.toArray().find(x => /AI budget for this period \(50 tokens\)/.test(x.get('text').toString())), 'the budget message once the cap is passed')
  assert.ok(msg)
  const r = await fetch(`http://127.0.0.1:${PORT}/api/suggest`, { method: 'POST', headers: { Authorization: 'Bearer tok-a', 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'a.py', language: 'python', prefix: 'def f(x):', suffix: '' }) })
  assert.strictEqual((await r.json()).text, '', 'suggestions stop too when the budget is gone')
  console.log('budget tests passed'); p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit() }, 300) }
