import { fileStore } from '../../app/file-store.js'
// Claims (soft locks), the token meter and model-per-role, with the agent in demo mode and a fake model server for the roles.
import { spawn } from 'node:child_process'
import http from 'node:http'
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-cl-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const procs = []; const bodies = []
process.on('exit', () => { for (const x of procs) { try { x.kill('SIGKILL') } catch {} } })

// fake OpenAI-compatible server: records which model each request used
const fake = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'nvidia/Nemotron-Nano-9B' }, { id: 'nvidia/Nemotron-Super-49B' }, { id: 'nvidia/Nemotron-Ultra-253B' }] })) }
  let b = ''; req.on('data', c => { b += c }); req.on('end', () => {
    try {
      if (b) { const j = JSON.parse(b); bodies.push(j) }
    } catch {}
    res.setHeader('Content-Type', 'text/event-stream')
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Plan: do it.' } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 111, completion_tokens: 22 } })}\n\n`); res.end('data: [DONE]\n\n')
  })
})
await new Promise(r => fake.listen(0, '127.0.0.1', r))
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const start = (file, env) => { const p = spawn('node', [file], { env: { ...process.env, ...env }, stdio: 'ignore' }); procs.push(p); return p }
try {
  start(path.join(here, '../../server/index.js'), { MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') })
  await wait(800)
  const agentEnv = { MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room8', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', NEBIUS_API_KEY: '', SUGGEST_PORT: String(await freePort()) }
  const demo = start(path.join(here, '../index.js'), agentEnv)
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room8', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 15000)
  const files = fileStore(d); const chat = d.getArray('chat'); globalThis.__chat = chat; const settings = d.getMap('settings'); const claims = d.getMap('claims'); const usage = d.getMap('usage')
  const t = new Y.Text(); t.insert(0, 'def go(x):\n    return x\n'); files.set('a.py', t)
  let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const find = (role, re) => chat.toArray().filter(m => m.get('role') === role && re.test(m.get('text').toString()))

  // claims: a person typing in a file claims it; the agent then has to ask before editing it, even in accept-edits mode
  settings.set('agentMode', 'acceptEdits')
  claims.set('a.py', { by: 'alice', ai: false, since: Date.now() })
  say('please add a docstring to a.py')
  const card = await until(() => find('approval', /alice is working on a\.py/)[0], 'ask because alice has the file')
  assert.match(card.get('text').toString(), /Edit anyway\?/)
  d.transact(() => { card.set('status', 'approved'); card.set('decidedBy', 'alice') })
  await until(() => /"""go/.test(t.toString()), 'edit after approval')
  await until(() => !claims.get('a.py') || claims.get('a.py').by !== 'coder', 'the agent releases its claim when it is done')
  // an expired person's claim no longer blocks
  claims.set('a.py', { by: 'alice', ai: false, since: Date.now() - 120000 })
  const askedBefore = find('approval', /./).length
  say('please add a docstring to a.py once more'); await wait(2500)
  assert.strictEqual(find('approval', /./).length, askedBefore, 'a stale claim does not block')

  // token meter: the agent counted (estimated) tokens for itself
  const u = usage.get('coder'); assert.ok(u && u.calls >= 1 && u.prompt > 0, 'usage recorded: ' + JSON.stringify(u))

  // model per role: plan mode uses the Ultra model, everyday chat uses Super; usage comes from the provider when it reports it
  procs.splice(procs.indexOf(demo), 1); demo.kill(); await wait(500)
  start(path.join(here, '../index.js'), { ...agentEnv, NEBIUS_API_KEY: 'k', NEBIUS_BASE_URL: `http://127.0.0.1:${fake.address().port}/v1`, AGENT_NAME: 'coder2' })
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder2'), 'coder2 ready in room', 15000)
  settings.set('agentMode', 'plan'); say2('please plan the work')
  function say2 (txt) { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder2 ' + txt) }) }
  await until(() => bodies.length >= 1, 'model call for plan mode')
  assert.strictEqual(bodies[0].model, 'nvidia/Nemotron-Ultra-253B', 'plan mode uses the planning model')
  settings.set('agentMode', 'manual'); say2('hello there')
  await until(() => bodies.length >= 2, 'model call for chat')
  assert.strictEqual(bodies[1].model, 'nvidia/Nemotron-Super-49B', 'everyday chat uses the main model')
  await until(() => usage.get('coder2') && usage.get('coder2').completion >= 44, 'measured usage')
  assert.strictEqual(usage.get('coder2').prompt, 222)
  const msg = await until(() => chat.toArray().filter(m => m.get('author') === 'coder2' && m.get('role') === 'agent')[0], 'reply')
  assert.match(msg.get('model'), /Ultra/, 'the message says which model wrote it')
  console.log('claims, usage and model-per-role tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); try { console.error(JSON.stringify(globalThis.__chat?.toArray().map(m => m.get('author') + '/' + m.get('role') + ': ' + m.get('text').toString().slice(0, 80)))) } catch {} ; process.exitCode = 1 } finally { for (const x of procs) { try { x.kill('SIGKILL') } catch {} } ; try { fake.close() } catch {} ; setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} ; process.exit() }, 300) }
