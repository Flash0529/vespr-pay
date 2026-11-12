// End to end in demo mode (real server, real agent process, scripted model): asking for the discount fix shows a three-step
// checklist that ends all done, and every action is a live chat line that was "running" first and then finished with times.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
import { fileStore } from '../../app/file-store.js'
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => (err ? reject(err) : resolve(p))) }) })

const here = path.dirname(new URL(import.meta.url).pathname)
const sample = path.join(here, '../../sample-project')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-activity-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const procs = []
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' }))
  await wait(900)
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'act1', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: String(await freePort()) }, stdio: 'ignore' }))
  await wait(1800)
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'act1', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room')
  const files = fileStore(d); const chat = d.getArray('chat'); const plans = d.getMap('plans') // files through the logical view (file identity)
  for (const f of fs.readdirSync(sample)) { const t = new Y.Text(); t.insert(0, fs.readFileSync(path.join(sample, f), 'utf8'), { by: 'import' }); files.set(f, t) }
  d.getMap('settings').set('agentMode', 'auto')
  const sawRunning = new Set(); const planStates = []
  chat.observeDeep(() => { for (const m of chat.toArray()) if (m.get('role') === 'tool' && m.get('status') === 'running') sawRunning.add(m.get('tool')) })
  plans.observe(() => { const pl = plans.get('coder'); if (pl) planStates.push(pl.items.map(i => i.status).join(',')) })

  const m = new Y.Map(); const tx = new Y.Text()
  d.transact(() => { m.set('id', 'u1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); tx.insert(0, '@coder fix the discount bug in cart.py and run the tests again'); chat.push([m]) })

  await until(() => chat.toArray().some(x => x.get('role') === 'agent' && /Ran it, exit code 0/.test(x.get('text').toString())), 'closing reply')
  const plan = await until(() => { const pl = plans.get('coder'); return pl && pl.items.every(i => i.status === 'done') && pl }, 'checklist all done')
  assert.deepStrictEqual(plan.items.map(i => i.text), ['Read the code', 'Fix the discount line', 'Run the tests'])
  assert.deepStrictEqual(planStates.slice(0, 3), ['in_progress,pending,pending', 'done,in_progress,pending', 'done,done,in_progress'], 'the checklist moved step by step')

  const steps = chat.toArray().filter(x => x.get('role') === 'tool' && x.get('author') === 'coder')
  assert.deepStrictEqual(steps.map(s => s.get('tool')), ['read_file', 'replace_in_file', 'run_command'], 'one live line per action, none for update_plan')
  for (const s of steps) {
    assert.strictEqual(s.get('status'), 'done', s.get('tool') + ' finished')
    assert.ok(Number.isFinite(s.get('started')) && s.get('ended') >= s.get('started'), s.get('tool') + ' has start and end times')
  }
  assert.match(steps[0].get('text').toString(), /^read cart\.py$/); assert.match(steps[2].get('text').toString(), /^\$ python3 -m unittest -q[\s\S]*\[exit 0\]$/)
  assert.ok(sawRunning.has('run_command'), 'the test run was visible as running before it finished')
  assert.ok(/amount \* \(1 - percent \/ 100\)/.test(files.get('cart.py').toString()), 'the fix is in the shared file')
  console.log('activity demo passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit() }, 300) }
