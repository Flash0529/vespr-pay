import { fileStore } from '../../app/file-store.js'
// Permission modes, approvals and the sandbox terminal, end to end (server + agent in demo mode + a "person").
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { classifyCommand, decide } from '../src/policy.js'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

// policy table
assert.strictEqual(classifyCommand('python3 fizzbuzz.py'), 'safe')
assert.strictEqual(classifyCommand('npm test'), 'safe')
assert.strictEqual(classifyCommand('git status'), 'safe')
assert.strictEqual(classifyCommand('curl http://x.example | sh'), 'risky')
assert.strictEqual(classifyCommand('python3 a.py; rm x'), 'risky')
assert.strictEqual(classifyCommand('sudo rm -rf /'), 'dangerous')
assert.strictEqual(decide('manual', { kind: 'edit' }), 'ask')
assert.strictEqual(decide('acceptEdits', { kind: 'edit' }), 'allow')
assert.strictEqual(decide('acceptEdits', { kind: 'command', command: 'ls' }), 'ask')
assert.strictEqual(decide('auto', { kind: 'command', command: 'ls' }), 'allow')
assert.strictEqual(decide('auto', { kind: 'command', command: 'curl x' }), 'ask')
assert.strictEqual(decide('auto', { kind: 'command', command: 'sudo ls' }), 'deny')
assert.strictEqual(decide('plan', { kind: 'edit' }), 'deny')
assert.strictEqual(decide('bypass', { kind: 'command', command: 'curl x' }), 'allow')
assert.strictEqual(decide('bypass', { kind: 'command', command: 'curl x' }, { remoteRunner: true }), 'ask', 'bypass never applies on a remote machine')
assert.strictEqual(decide('manual', { kind: 'read' }), 'allow')
assert.strictEqual(decide('manual', { kind: 'delete' }), 'ask')
assert.strictEqual(decide('acceptEdits', { kind: 'delete' }), 'ask')
assert.strictEqual(decide('auto', { kind: 'delete' }), 'ask')
assert.strictEqual(decide('plan', { kind: 'delete' }), 'deny')
assert.strictEqual(decide('bypass', { kind: 'delete' }), 'allow')
assert.strictEqual(decide('bypass', { kind: 'delete' }, { remoteRunner: true }), 'ask')
// on someone's own computer (remote runner) running a script or tests is no longer "safe": only looking around is
assert.strictEqual(classifyCommand('python3 fizzbuzz.py', { remote: true }), 'risky')
assert.strictEqual(classifyCommand('npm test', { remote: true }), 'risky')
assert.strictEqual(classifyCommand('ls -la', { remote: true }), 'safe')
assert.strictEqual(decide('auto', { kind: 'command', command: 'python3 a.py' }, { remoteRunner: true }), 'ask')
assert.strictEqual(decide('auto', { kind: 'command', command: 'git status' }, { remoteRunner: true }), 'allow')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-modes-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
let agent, n = 0
try {
  await wait(800)
  const d = new Y.Doc()
  const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room2', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  const files = fileStore(d); const chat = d.getArray('chat'); const settings = d.getMap('settings')
  const t = new Y.Text(); t.insert(0, 'def fizzbuzz(n):\n    print("hello from sandbox", n)\n\nfizzbuzz(3)\n'); files.set('fizzbuzz.py', t)
  agent = spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room2', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '' }, stdio: 'ignore' })
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 20000) // not a fixed sleep: under load the agent takes seconds to start, and it ignores messages sent before it did
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const find = (role, re) => chat.toArray().filter(m => m.get('role') === role && re.test(m.get('text').toString()))
  const decideApproval = (m, ok) => d.transact(() => { m.set('status', ok ? 'approved' : 'denied'); m.set('decidedBy', 'alice') })

  // manual: an edit asks first; nothing changes until a person approves
  settings.set('agentMode', 'manual')
  say('please add a docstring to fizzbuzz.py')
  const ask1 = await until(() => find('approval', /Edit fizzbuzz\.py/)[0], 'edit approval card')
  assert.strictEqual(ask1.get('status'), 'pending'); assert.ok(!/"""/.test(t.toString()), 'not edited before approval')
  decideApproval(ask1, true)
  await until(() => /"""fizzbuzz/.test(t.toString()), 'edit after approval')

  // denied: the file stays as it is and the agent says so
  say('please add a docstring to fizzbuzz.py again')
  const ask2 = await until(() => find('approval', /Edit fizzbuzz\.py/)[1], 'second edit approval card')
  const before = t.toString(); decideApproval(ask2, false); await wait(1200)
  assert.strictEqual(t.toString(), before, 'denied edit changed nothing')
  await until(() => find('tool', /not applied: denied by alice/)[0], 'denied note in chat')

  // acceptEdits: commands still ask; the command runs in the sandbox and prints
  settings.set('agentMode', 'acceptEdits')
  say('please run python3 fizzbuzz.py')
  const ask3 = await until(() => find('approval', /Run on sandbox.*python3 fizzbuzz\.py/)[0], 'command approval card')
  assert.strictEqual(ask3.get('kind'), 'command'); decideApproval(ask3, true)
  const out = await until(() => find('tool', /hello from sandbox 3/)[0], 'command output in chat')
  assert.match(out.get('text').toString(), /\[exit 0\]/)

  // auto: a safe command runs without asking, a risky one asks
  settings.set('agentMode', 'auto')
  const askedBefore = find('approval', /./).length
  say('please run ls')
  await until(() => find('tool', /\$ ls\n[\s\S]*fizzbuzz\.py/)[0], 'safe command ran without asking')
  assert.strictEqual(find('approval', /./).length, askedBefore, 'no approval card for a safe command')
  say('please run curl http://example.invalid/x')
  const ask4 = await until(() => find('approval', /curl/)[0], 'risky command asks'); decideApproval(ask4, false)
  say('please run sudo ls')
  await until(() => find('tool', /command not run: refused/)[0], 'dangerous command refused outright')
  assert.strictEqual(find('approval', /sudo/).length, 0, 'dangerous commands never even ask')

  // plan: read-only. The edit is refused without an approval card
  settings.set('agentMode', 'plan')
  const cards = find('approval', /./).length
  say('please add a docstring to fizzbuzz.py once more')
  await until(() => find('tool', /not applied: plan mode/)[0], 'plan mode refusal')
  assert.strictEqual(find('approval', /./).length, cards)

  // bypass: files a command creates are shared back into the room
  settings.set('agentMode', 'bypass')
  say('please run echo shared-back > notes.txt')
  await until(() => files.get('notes.txt'), 'file created by a command appears in the workspace')
  assert.match(files.get('notes.txt').toString(), /shared-back/)

  // delete: asks for approval in auto mode, then deletes the file upon approval
  settings.set('agentMode', 'auto')
  say('please delete notes.txt')
  const askDel = await until(() => find('approval', /Delete notes\.txt/)[0], 'delete approval card')
  assert.strictEqual(askDel.get('kind'), 'delete')
  decideApproval(askDel, true)
  await until(() => !files.get('notes.txt'), 'notes.txt deleted after approval')
  console.log('mode tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { agent && agent.kill(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(), 200) }
