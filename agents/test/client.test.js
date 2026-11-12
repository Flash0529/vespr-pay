// The app shell's client (app/vespr-client.js) against the real collab server: it sees an agent's chat, edits (with what was removed and who did it),
// approval cards and settings live, and what it does (messages with a thread and a quote, approvals, mode) reaches the agent through the same shared document.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { createClient } from '../../app/vespr-client.js'

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-client-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, bad, agent
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT
  alice = createClient({ server, room: 'r1', token: 'tok-a', name: 'alice', color: '#a5b4fc', deps: { Y, WebsocketProvider, WebSocketPolyfill: WebSocket } })
  const changes = []; alice.on('change', w => changes.push(w))
  const edits = []; alice.on('edit', e => edits.push(e))
  assert.strictEqual(alice.get().status, 'connecting'); assert.deepStrictEqual(alice.get().messages, [])
  await alice.ready; assert.strictEqual(alice.get().status, 'connected')
  agent = joinRoom({ server, room: 'r1', token: 'tok-c', name: 'coder', color: 'hsl(170, 70%, 55%)', model: 'fake-model' }); await agent.ready

  // people and agents come from presence
  await until(() => alice.get().agents.some(a => a.name === 'coder'), 'the agent shows up in presence')
  const snap = alice.get(); assert.ok(snap.people.find(p => p.name === 'alice' && p.me && !p.isAgent)); assert.strictEqual(snap.agents[0].model, 'fake-model')

  // a person's message with a thread and a quote reaches the agent's view unchanged
  const id = alice.send('@coder explain this', { thread: 'fix-discount', quote: { src: 'cart.py · line 8', text: 'return amount * percent / 100', by: 'coder' }, attachments: [{ name: 'deck.pptx', size: 1234, type: 'application/vnd.ms-powerpoint' }] })
  const got = await until(() => agent.chat.toArray().find(m => m.get('id') === id), 'the agent receives the message')
  assert.strictEqual(got.get('thread'), 'fix-discount'); assert.strictEqual(got.get('quote').text, 'return amount * percent / 100'); assert.strictEqual(got.get('attachments')[0].name, 'deck.pptx')
  // highlighted or pasted context, with where it came from, also reaches the agent (capped and cleaned on the way in)
  const id2 = alice.send('@coder is this right?', { contexts: [{ kind: 'code', file: 'cart.py', lines: [8, 8], by: 'coder', text: 'return amount * percent / 100', before: 'def apply_discount(amount, percent):' }, { kind: 'bogus', text: 'x'.repeat(5000) }, { text: '  ' }] })
  const got2 = await until(() => agent.chat.toArray().find(m => m.get('id') === id2), 'the agent receives the message with context')
  const ctxs = got2.get('contexts'); assert.strictEqual(ctxs.length, 2); assert.deepStrictEqual(ctxs[0].lines, [8, 8]); assert.strictEqual(ctxs[0].file, 'cart.py'); assert.strictEqual(ctxs[1].kind, 'text'); assert.strictEqual(ctxs[1].text.length, 2000)
  assert.strictEqual(alice.send('   '), null, 'empty messages are not sent')
  // the agent streams an answer: the client sees the text grow, in the same thread map
  const said = agent.say('The line takes'); said.append(' a percentage.')
  await until(() => alice.get().messages.some(m => m.isAgent && m.text === 'The line takes a percentage.'), 'streamed agent text')
  const t = alice.get().threads; assert.ok(t.find(x => x.id === 'fix-discount' && x.people.includes('alice')), 'threads group by the thread field'); assert.ok(t.find(x => x.id === 'main' && x.agents.includes('coder')))

  // live edits with what was removed, what was added and who did it (drives the red/green diff)
  agent.write('cart.py', 'def f(a, p):\n    return a * p / 100\n', 'm1')
  await until(() => alice.read('cart.py') !== null && edits.length, 'the new file arrives')
  assert.deepStrictEqual(alice.get().files, ['cart.py']); assert.strictEqual(alice.read('cart.py'), 'def f(a, p):\n    return a * p / 100\n')
  assert.strictEqual(edits[0].created, true); assert.strictEqual(edits[0].by, 'coder'); assert.strictEqual(edits[0].removed, ''); assert.ok(edits[0].added.startsWith('def f'))
  const n0 = edits.length
  agent.replace('cart.py', 'a * p / 100', 'a * (1 - p / 100)', 'm2')
  await until(() => edits.length > n0, 'the edit event')
  const e = edits[edits.length - 1]
  assert.strictEqual(e.file, 'cart.py'); assert.strictEqual(e.by, 'coder'); assert.strictEqual(e.ai, true); assert.strictEqual(e.model, 'fake-model'); assert.strictEqual(e.msg, 'm2')
  assert.ok(e.removed.includes('p / 100') && e.added.includes('1 - p'), 'removed ' + JSON.stringify(e.removed) + ' added ' + JSON.stringify(e.added)); assert.strictEqual(e.line, 2)

  // approvals: the shell sees the card, the first answer decides, a second does nothing
  const asked = agent.requestApproval({ kind: 'command', summary: 'Run python3 -m unittest', detail: '' })
  const card = await until(() => alice.get().approvals.pending[0], 'pending approval card'); assert.strictEqual(card.kind, 'command')
  assert.strictEqual(alice.decide(card.id, true), true)
  const verdict = await asked; assert.deepStrictEqual(verdict, { approved: true, by: 'alice' })
  assert.strictEqual(alice.decide(card.id, false), false, 'already decided'); assert.strictEqual(alice.get().approvals.pending.length, 0)
  assert.strictEqual(alice.decide('nope', true), false)

  // settings reach the agent, and leave a line in the room
  alice.setMode('plan'); await until(() => agent.mode() === 'plan', 'mode reaches the agent')
  assert.throws(() => alice.setMode('yolo'), /unknown mode/); assert.strictEqual(alice.get().mode, 'plan')

  // History: edits, the approval and the setting change in one list, newest first
  agent.say('$ python3 -m unittest -q\nOK\n[exit 0]', 'tool')
  await until(() => alice.history().some(h => h.type === 'run'), 'a run in the history')
  const h = alice.history(); const types = new Set(h.map(x => x.type))
  for (const k of ['edit', 'approval', 'access', 'run']) assert.ok(types.has(k), 'history has ' + k + ' (got ' + [...types] + ')')
  assert.ok(h.every((x, i) => i === 0 || h[i - 1].ts >= x.ts), 'newest first')
  const ap = h.find(x => x.type === 'approval'); assert.strictEqual(ap.who, 'alice'); assert.strictEqual(ap.verb, 'approved'); assert.strictEqual(ap.kind, 'person')
  const run = h.find(x => x.type === 'run'); assert.strictEqual(run.target, 'python3 -m unittest -q'); assert.strictEqual(run.detail, '[exit 0]')

  // runners over HTTP with the same token, and a bad token is refused
  assert.deepStrictEqual(await alice.runners(), [])
  bad = createClient({ server, room: 'r1', token: 'wrong', name: 'mallory', deps: { Y, WebsocketProvider, WebSocketPolyfill: WebSocket } })
  await wait(700); assert.notStrictEqual(bad.get().status, 'connected', 'a wrong token never connects'); assert.deepStrictEqual(bad.get().messages, [])
  await assert.rejects(() => createClient({ server, room: 'r1', token: 'wrong', name: 'm', deps: { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }, fetchImpl: (u, o) => fetch(u, o) }).runners(), /HTTP 401|runners/)
  assert.ok(changes.includes('chat') && changes.includes('presence') && changes.includes('files') && changes.includes('settings'), 'change events were emitted: ' + [...new Set(changes)])
  // the command bus: the shell writes small validated commands; the log stays short
  const cid = alice.command({ type: 'open', file: 'cart.py', line: 8 }); const ui = agent.doc.getArray('ui')
  await until(() => ui.toArray().some(e => e.id === cid), 'the command reaches the room')
  assert.deepStrictEqual(ui.toArray().find(e => e.id === cid), { id: cid, ts: ui.toArray().find(e => e.id === cid).ts, by: 'alice', type: 'open', file: 'cart.py', line: 8 })
  alice.command({ type: 'follow', agent: 'coder' }); alice.command({ type: 'unfollow' })
  for (const bad of [null, { type: 'exec', cmd: 'rm -rf /' }, { type: 'open' }, { type: 'open', file: '' }, { type: 'follow' }]) assert.throws(() => alice.command(bad), /unknown command|needs/)
  for (let i = 0; i < 60; i++) alice.command({ type: 'unfollow' })
  await until(() => ui.length <= 50, 'the command log is trimmed'); assert.ok(ui.length <= 50)
  // files by a person (the explorer): create, rename, delete reach everyone, keep the text and who wrote it, show in History, and respect a file an agent holds
  const fa = alice.files; const fg = agent.files
  agent.write('notes.md', 'hello from the agent'); await until(() => fa.has('notes.md'), 'alice sees the agent file')
  alice.createFile('docs/new.py'); await until(() => fg.has('docs/new.py'), 'the agent sees the new file'); assert.strictEqual(fg.get('docs/new.py').toString(), '')
  alice.createFolder('assets'); await until(() => fg.has('assets/.keep'), 'a folder is a marker file')
  assert.throws(() => alice.createFile('docs/new.py'), /taken/); assert.throws(() => alice.createFile('../x.py'), /usable/); assert.throws(() => alice.createFile('a b.py'), /usable/); assert.throws(() => alice.createFile('.git/config'), /usable/); assert.throws(() => alice.createFile('x'.repeat(130)), /usable/)
  alice.renamePaths([['notes.md', 'docs/notes.md']]); await until(() => fg.has('docs/notes.md') && !fg.has('notes.md'), 'a rename reaches the agent')
  await until(() => fs.existsSync(path.join(dir, 'r1/tree/docs/notes.md')), 'server export uses the renamed logical path')
  assert.strictEqual(fs.readFileSync(path.join(dir, 'r1/tree/docs/notes.md'), 'utf8'), 'hello from the agent')
  assert.strictEqual(fg.get('docs/notes.md').toString(), 'hello from the agent'); assert.ok(fg.get('docs/notes.md').toDelta().some(d => d.attributes), 'who wrote it survives a rename')
  assert.throws(() => alice.renamePaths([['docs/notes.md', 'docs/new.py']]), /taken/); assert.throws(() => alice.renamePaths([['ghost.md', 'g2.md']]), /cannot rename/)
  agent.claim('docs/new.py'); await until(() => alice.doc.getMap('claims').has('docs/new.py'), 'the claim arrives')
  assert.throws(() => alice.deletePaths(['docs/new.py']), /coder is editing/); assert.throws(() => alice.renamePaths([['docs/new.py', 'docs/n2.py']]), /coder is editing/)
  agent.releaseClaims(); await until(() => !alice.doc.getMap('claims').has('docs/new.py'), 'the claim is released')
  alice.deletePaths(['docs/new.py', 'assets/.keep']); await until(() => !fg.has('docs/new.py') && !fg.has('assets/.keep'), 'a delete reaches the agent')
  assert.throws(() => alice.deletePaths(['docs/new.py']), /no such file/); assert.throws(() => alice.deletePaths([]), /nothing to delete/)
  const verbs = alice.history().filter(h => h.who === 'alice' && h.type === 'edit').map(h => h.verb); for (const v of ['created', 'renamed', 'deleted']) assert.ok(verbs.includes(v), 'History shows ' + v)
  assert.throws(() => createClient({ server }), /needs server, room, token and name/)
  console.log('client tests passed')
} catch (e) {
  console.error(e); process.exitCode = 1
} finally {
  for (const c of [alice, bad]) try { c && c.destroy() } catch {}
  try { agent && agent.destroy() } catch {}
  srv.kill(); await wait(100); fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0)
}
