import { fileStore } from '../../app/file-store.js'
// End to end without a model key: real server + the agent worker in demo mode + a "person" client.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-agent-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(100) } throw new Error('timed out waiting for: ' + what) }
let agent
try {
  await wait(800)
  const d = new Y.Doc()
  const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room1', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  p.awareness.setLocalStateField('user', { name: 'alice', isAgent: false })
  await new Promise(r => p.once('sync', r))
  const t = new Y.Text(); t.insert(0, 'def fizzbuzz(n):\n    for i in range(n):\n        print(i)\n'); fileStore(d).set('fizzbuzz.py', t)
  d.getMap('settings').set('agentMode', 'acceptEdits') // this test is about the chat and the edit, not approvals
  agent = spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room1', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '' }, stdio: 'ignore' })
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room')
  const m = new Y.Map(); const tx = new Y.Text()
  d.transact(() => { m.set('id', 'm1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); d.getArray('chat').push([m]); tx.insert(0, '@coder please add a docstring to fizzbuzz.py') })
  await until(() => {
    const chat = d.getArray('chat').toArray().map(x => ({ who: x.get('author'), role: x.get('role'), text: x.get('text').toString() }))
    return /"""fizzbuzz: added live/.test(t.toString()) && chat.some(c => c.who === 'coder' && c.role === 'tool' && /edited fizzbuzz\.py/.test(c.text))
  }, 'agent edited file and posted tool step')
  assert.match(t.toString(), /"""fizzbuzz: added live/, 'agent edited the shared file')
  assert.match(t.toString(), /^def fizzbuzz\(n\):\n    """/, 'docstring is placed right under the def line')
  const chat = d.getArray('chat').toArray().map(x => ({ who: x.get('author'), role: x.get('role'), text: x.get('text').toString() }))
  assert(chat.some(c => c.who === 'coder' && c.role === 'agent' && /Opening fizzbuzz\.py/.test(c.text)), 'agent replied in the shared chat')
  assert(chat.some(c => c.who === 'coder' && c.role === 'tool' && /edited fizzbuzz\.py/.test(c.text)), 'tool step shown in chat')
  const delta = t.toDelta()
  const docOp = delta.find(op => op.insert.includes('fizzbuzz: added live'))
  assert(docOp && docOp.attributes && docOp.attributes.by === 'coder' && docOp.attributes.ai === true && docOp.attributes.msg === 'm1', 'agent insert carries authorship (who, ai, triggering message)')
  assert.strictEqual(delta[0].attributes, undefined, 'original text was seeded without attributes')
  const prov = d.getArray('provenance').toArray()
  assert.strictEqual(prov.length, 1); assert.strictEqual(prov[0].get('by'), 'coder'); assert.strictEqual(prov[0].get('msgId'), 'm1')
  assert.strictEqual(d.getMap('handled').get('m1'), 'coder', 'message was claimed')
  const states = [...p.awareness.getStates().values()]
  const c = states.find(s => s.user && s.user.name === 'coder')
  assert(c && c.user.isAgent, 'agent shows up in presence as an agent')
  assert(c.cursor && c.cursor.file === 'fizzbuzz.py', 'agent cursor is on the edited file')
  console.log('agent tests passed. chat:', JSON.stringify(chat.map(x => `${x.who}/${x.role}: ${x.text.slice(0, 60)}`)))
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { agent && agent.kill(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 200) }
