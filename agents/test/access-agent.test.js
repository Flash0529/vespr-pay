// An agent in a locked workspace (server/access.js on): it knows its rights, never sends a file change the server would refuse (so it is
// never disconnected), asks for what it lacks with request_access, a person allows it in the chat card, and then the change goes through.
// Against the real server, with the real agent room (agents/src/room.js) and the real tool runner (agent.js runTool via request_access).
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import { joinRoom } from '../src/room.js'

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-access-agent-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), VESPR_ACCESS: '1', VESPR_AGENT_NAMES: 'coder' }, stdio: 'ignore' })
const base = 'http://127.0.0.1:' + PORT
const api = async (p, tok, body) => { const r = await fetch(base + '/api/access/work' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json() } }
let owner, agent, refused = 0
try {
  await until(async () => { try { return (await fetch(base + '/api/access/work', { headers: { Authorization: 'Bearer tok-a' } })).status === 200 } catch { return false } }, 'the server')
  owner = joinRoom({ server: 'ws://127.0.0.1:' + PORT, room: 'work', token: 'tok-a', name: 'alice', color: '#aaa', model: '', onRefused: () => {} }); await owner.ready
  owner.write('README.md', '# hi\n'); owner.write('src/a.py', 'x = 1\n')
  assert.strictEqual((await api('/lock', 'tok-a', {})).s, 201)
  assert.strictEqual((await api('/grant', 'tok-a', { who: 'coder', path: '', rights: ['view'] })).s, 200)
  agent = joinRoom({ server: 'ws://127.0.0.1:' + PORT, room: 'work', token: 'tok-c', name: 'coder', color: '#0aa', model: 'fake', onRefused: () => { refused++ } })
  await agent.ready; await agent.accessReady
  assert.strictEqual(agent.may('edit', 'src/a.py'), false, 'it knows it may only view')
  await until(() => agent.read('src/a.py') === 'x = 1\n', 'the agent sees the files')

  // 1. it does not send what would be refused, and says what to do instead
  const w = agent.replace('src/a.py', 'x = 1', 'x = 2', 'm1')
  assert.match(w.error || '', /don't have edit on src\/a\.py.*request_access/, 'a clear message pointing at request_access')
  assert.match(agent.write('src/new.py', 'y').error || '', /don't have make/)
  assert.match(agent.delete('README.md', 'm1').error || '', /don't have delete/)
  agent.claim('src/a.py'); agent.setPlan([{ text: 'fix a.py', status: 'in_progress' }]); agent.say('working on it')
  await wait(400)
  assert.strictEqual(refused, 0, 'its own checklist, chat and a claim it may not make never get it disconnected')
  assert.ok(owner.chat.toArray().some(m => m.get('author') === 'coder'), 'its chat arrived')

  // 2. it asks; the card appears for the owner; she allows edit for an hour; the agent goes on
  const asked = agent.requestAccess({ path: 'src/', rights: ['edit'], reason: 'fix the failing test in src/a.py' }, 8000)
  const cardId = await until(() => { const m = owner.chat.toArray().find(x => x.get('role') === 'access'); return m && m.get('id') }, 'the request card')
  const card = owner.chat.toArray().find(x => x.get('id') === cardId)
  assert.deepStrictEqual([card.get('author'), card.get('status'), card.get('request').path, card.get('request').rights], ['coder', 'pending', 'src/', ['edit']])
  assert.strictEqual((await api('/answer', 'tok-c', { id: card.get('request').id, approve: true })).s, 403, 'the agent cannot answer itself')
  assert.strictEqual((await api('/answer', 'tok-a', { id: card.get('request').id, approve: true, for: '1h' })).s, 200)
  const r = await asked
  assert.strictEqual(r.granted, true); assert.strictEqual(r.by, 'alice'); assert.notStrictEqual(r.until, 'always')
  assert.strictEqual(agent.may('edit', 'src/a.py'), true, 'its rights were refreshed')
  assert.deepStrictEqual(agent.replace('src/a.py', 'x = 1', 'x = 2', 'm2'), { ok: true, line: 1 })
  await until(() => owner.read('src/a.py') === 'x = 2\n', 'the edit reaches the owner')
  assert.strictEqual(agent.may('edit', 'README.md'), false, 'only where it asked')

  // 3. a no is final for a while, and is reported as such
  const asked2 = agent.requestAccess({ path: 'README.md', rights: ['delete'], reason: 'tidy up' }, 8000)
  const card2 = await until(() => owner.chat.toArray().find(x => x.get('role') === 'access' && x.get('request').path === 'README.md'), 'the second card')
  await api('/answer', 'tok-a', { id: card2.get('request').id, approve: false })
  const r2 = await asked2
  assert.strictEqual(r2.granted, false); assert.match(r2.hint, /alice said no/)
  assert.match((await agent.requestAccess({ path: 'README.md', rights: ['delete'], reason: 'again' }, 500)).error || '', /said no/, 'not again right away')
  assert.strictEqual(refused, 0, 'never disconnected')
  console.log('access agent tests passed: an agent knows its rights, never sends a refused change, asks in chat, a person allows it for an hour, then it edits; a no is final for a while')
} finally {
  if (agent) agent.destroy(); if (owner) owner.destroy(); srv.kill(); fs.rmSync(dir, { recursive: true, force: true })
}
