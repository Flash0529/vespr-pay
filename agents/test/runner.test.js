import { fileStore } from '../../app/file-store.js'
// Runner protocol end to end: server + a runner process + the agent (demo mode) + a "person".
// The command must run in the RUNNER's own folder, files it creates must come back, other workspaces are refused,
// and bypass mode must not apply to a remote machine.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-rn-'))
const runnerRoot = path.join(dir, 'runner-root')
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\nrunner-box:tok-r\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const procs = []
const start = (file, env) => { const p = spawn('node', [file, ...(env.__args || [])], { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
try {
  start(path.join(here, '../../server/index.js'), { MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), MURMIO_RUN_USERS: 'coder' })
  await wait(800)
  // This fixture tests owner-approved host execution and the wire protocol.
  // Required native Linux isolation is covered separately in runner/test/.
  start(path.join(here, '../../runner/index.js'), { __args: ['--server', `ws://127.0.0.1:${PORT}`, '--token', 'tok-r', '--label', 'testbox', '--allow-room', 'room6', '--root', runnerRoot, '--isolation', 'trusted-local'] })
  start(path.join(here, '../index.js'), { MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room6', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: String(await freePort()) })
  const list = await until(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/runners`, { headers: { Authorization: 'Bearer tok-a' } })
      if (!r.ok) return null
      const j = await r.json()
      return j.length === 1 ? j : null
    } catch { return null }
  }, 'runner registered', 15000)
  assert.strictEqual(list.length, 1); assert.strictEqual(list[0].label, 'testbox'); assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/api/runners`)).status, 401)
  const rid = list[0].id

  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room6', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room')
  const files = fileStore(d); const chat = d.getArray('chat'); const settings = d.getMap('settings')
  const t = new Y.Text(); t.insert(0, 'print("hi")\n'); files.set('a.py', t)
  let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const find = (role, re) => chat.toArray().filter(m => m.get('role') === role && re.test(m.get('text').toString()))
  const approve = async re => { const c = await until(() => find('approval', re).find(m => m.get('status') === 'pending'), 'approval card ' + re); d.transact(() => { c.set('status', 'approved'); c.set('decidedBy', 'alice') }); return c }

  settings.set('agentMode', 'acceptEdits'); settings.set('runner', rid)
  say('please run pwd')
  const card = await approve(/Run on testbox/)
  assert.match(card.get('text').toString(), /\(\w+\)/, 'approval card names the machine and its OS')
  const out = await until(() => find('tool', /\$ pwd[\s\S]*\[exit 0\]/)[0], 'pwd output')
  assert.ok(out.get('text').toString().includes('runner-root'), 'the command ran in the runner\'s own folder: ' + out.get('text').toString())

  say('please run echo from-runner > made.txt')
  await approve(/made\.txt/)
  await until(() => files.get('made.txt'), 'file created on the runner comes back into the workspace')
  assert.match(files.get('made.txt').toString(), /from-runner/)
  assert.strictEqual(files.get('made.txt').toDelta()[0].attributes.by, 'coder', 'returned files carry the agent as author')

  // bypass never applies on a remote machine: a risky command still asks
  settings.set('agentMode', 'bypass')
  const before = find('approval', /./).length
  say('please run curl http://example.invalid')
  await until(() => find('approval', /curl/).length, 'bypass downgraded: remote runner still asks')
  const c3 = find('approval', /curl/)[0]; d.transact(() => { c3.set('status', 'denied'); c3.set('decidedBy', 'alice') })

  // a runner that is not connected: the agent refuses instead of falling back to the sandbox
  settings.set('agentMode', 'acceptEdits'); settings.set('runner', 'rn-gone')
  say('please run echo nope'); await approve(/echo nope/).catch(() => null)
  await until(() => find('tool', /runner .*offline|runner is offline/i)[0] || find('tool', /the chosen runner is offline/)[0], 'offline runner refused')
  console.log('runner tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0) }, 300) }
