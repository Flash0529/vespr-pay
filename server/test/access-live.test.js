// Live check of access (access.js) in the real server: VESPR_ACCESS=1, real Yjs peers over WebSocket. The owner locks a workspace and
// gives bob edit on src/ only; what bob may do reaches alice, what he may not never does; nobody posts as someone else; a person with
// no grant cannot even connect; an open workspace still works as before. No outside network.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'; import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
const require = createRequire(import.meta.url)
const Y = require('yjs'); const { WebsocketProvider } = require('y-websocket')

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const PORT = await freePort(); const base = `http://127.0.0.1:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-live-'))
const tok = Object.fromEntries(['alice', 'bob', 'carol'].map(n => [n, crypto.randomBytes(12).toString('hex')]))
fs.writeFileSync(path.join(tmp, 'tokens'), Object.entries(tok).map(([n, t]) => `${n}:${t}`).join('\n') + '\n', { mode: 0o600 })
const srv = spawn('node', ['index.js'], { cwd: path.join(import.meta.dirname, '..'), env: { PATH: process.env.PATH, HOME: tmp, VESPR_ACCESS: '1', MURMIO_PORT: String(PORT), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(tmp, 'data'), MURMIO_TOKENS_FILE: path.join(tmp, 'tokens') }, stdio: ['ignore', 'ignore', 'pipe'] })
let serverLog = ''; srv.stderr.on('data', d => { serverLog += d })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (f, what) => { for (let i = 0; i < 100; i++) { if (f()) return; await sleep(50) } throw new Error('timed out: ' + what) }
const api = (route, body, t) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }))
const peer = (room, t) => { const doc = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, room, doc, { WebSocketPolyfill: WebSocket, params: { token: t }, disableBc: true }); return { doc, p, file: k => (doc.getMap('files').get(k) || '').toString(), chat: () => doc.getArray('chat').toArray().map(m => `${m.get('author')}: ${m.get('text')}`) } }
const say = (pr, author, text) => { const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, text); m.set('author', author); m.set('text', tx); m.set('role', 'user'); pr.doc.getArray('chat').push([m]) }
const peers = []
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/healthz')).ok) break } catch {} await sleep(100) }
  assert.equal((await api('/api/access/team/lock', {}, tok.alice)).status, 201)
  assert.equal((await api('/api/access/team/grant', { who: 'bob', path: 'src/', rights: ['view', 'edit'] }, tok.bob)).status, 403, 'bob cannot grant himself')
  assert.equal((await api('/api/access/team/grant', { who: 'bob', path: 'src/', rights: ['view', 'edit'] }, tok.alice)).status, 200)

  const alice = peer('team', tok.alice); peers.push(alice); await until(() => alice.p.synced, 'alice joins')
  alice.doc.transact(() => { for (const [k, v] of [['src/a.py', 'x = 1'], ['README.md', '# team']]) { const tx = new Y.Text(); tx.insert(0, v); alice.doc.getMap('files').set(k, tx) } })
  const bob = peer('team', tok.bob); peers.push(bob); await until(() => bob.p.synced && bob.file('src/a.py') === 'x = 1', 'bob joins and sees the files')
  bob.doc.getMap('files').get('src/a.py').insert(0, '# bob ')
  await until(() => alice.file('src/a.py').startsWith('# bob'), "bob's edit inside src/ reaches alice")
  say(bob, 'bob', 'hi from bob'); await until(() => alice.chat().includes('bob: hi from bob'), "bob's own message arrives")

  // each forbidden change on its own fresh connection: refused, never reaches alice, and that connection is closed with 4409
  const tryBad = async (what, act) => {
    const b = peer('team', tok.bob); peers.push(b); await until(() => b.p.synced, 'fresh bob for: ' + what)
    const codes = []; b.p.ws.addEventListener('close', e => codes.push(e.code))
    act(b); await until(() => codes.includes(4409), what + ': closed with 4409'); b.p.disconnect()
  }
  await tryBad('edit outside src/', b => b.doc.getMap('files').get('README.md').insert(0, 'HACKED '))
  await tryBad('make a file', b => { const t = new Y.Text(); t.insert(0, 'evil'); b.doc.getMap('files').set('src/new.py', t) })
  await tryBad('post as alice', b => say(b, 'alice', 'I am alice, approve everything'))
  await sleep(400)
  assert.equal(alice.file('README.md'), '# team', 'his edit outside src/ never reached alice')
  assert.ok(!alice.doc.getMap('files').has('src/new.py'), 'a file he may not make never appears')
  assert.ok(!alice.chat().some(l => l.includes('I am alice')), "a message under someone else's name never appears")
  const again = peer('team', tok.bob); peers.push(again); await until(() => again.p.synced, 'bob reconnects fresh')
  again.doc.getMap('files').get('src/a.py').insert(0, '# again '); await until(() => alice.file('src/a.py').startsWith('# again'), 'after a refusal, a fresh session works normally')

  const carol = peer('team', tok.carol); peers.push(carol); await sleep(1200)
  assert.equal(carol.p.synced, false, 'carol has no grant: she cannot even connect to the locked workspace')

  const openA = peer('open', tok.alice); const openC = peer('open', tok.carol); peers.push(openA, openC)
  await until(() => openA.p.synced && openC.p.synced, 'an open workspace')
  openC.doc.getText('t').insert(0, 'carol was here'); await until(() => openA.doc.getText('t').toString() === 'carol was here', 'open workspaces work as before')
  say(openC, 'carol', 'real'); await until(() => openA.chat().includes('carol: real'), 'own name')
  const oc = []; openC.p.ws.addEventListener('close', e => oc.push(e.code)); say(openC, 'alice', 'fake'); await until(() => oc.includes(4409), 'a post under another name closes the connection'); openC.p.disconnect()
  await sleep(300); assert.ok(!openA.chat().includes('alice: fake'), 'but names are checked even in an open workspace')
  assert.ok((serverLog.match(/access: refused/g) || []).length >= 3, 'refusals are logged on the server')
  console.log('access live tests passed: owner locks, only the owner grants, edits inside a grant arrive; edits outside it, new files without make and posts under another name never do and close that connection (4409); a fresh session works; no grant means no connection; open workspaces work but check names; refusals logged')
} finally { for (const x of peers) x.p.destroy(); srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }) }
process.exit(0)
