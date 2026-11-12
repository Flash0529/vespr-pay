import { fileStore } from '../../app/file-store.js'
// "Run it": stack detection, background processes with a preview, and the whole thing through the agent (demo mode) and the realtime server.
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { detectProject } from '../src/project.js'
import { ProcessManager } from '../src/processes.js'
import { previewHandler, rewriteHtml } from '../src/preview.js'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const project = files => ({ list: () => Object.keys(files), read: p => files[p] })

// ---- 1. detection (pure)
let d = detectProject(project({ 'package.json': JSON.stringify({ name: 'dice', scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } }) }))
assert.strictEqual(d.stack, 'vite'); assert.match(d.dev, /--port \$PORT .*--base \$BASE_PATH/); assert.strictEqual(d.keepPrefix, true); assert.match(d.command, /^npm install.* && npm run dev/)
d = detectProject(project({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js', test: 'echo "Error: no test specified" && exit 1' }, dependencies: { express: '4' } }), 'server.js': '' }))
assert.strictEqual(d.stack, 'node-server'); assert.strictEqual(d.dev, 'npm start'); assert.strictEqual(d.test, null, 'the npm placeholder test script is not a test')
d = detectProject(project({ 'package.json': JSON.stringify({ scripts: { dev: 'next dev' }, dependencies: { next: '15' } }) }))
assert.strictEqual(d.stack, 'next'); assert.match(d.dev, /-p \$PORT/); assert.ok(d.notes.length, 'Next.js previews come with a warning')
d = detectProject(project({ 'requirements.txt': 'flask==3\n', 'app.py': 'from flask import Flask' }))
assert.strictEqual(d.stack, 'flask'); assert.match(d.dev, /flask --app app run --host 0\.0\.0\.0 --port \$PORT/); assert.match(d.install, /pip install/)
d = detectProject(project({ 'index.html': '<h1>hi</h1>' }))
assert.strictEqual(d.stack, 'static'); assert.match(d.dev, /http\.server \$PORT/)
d = detectProject(project({ 'cart.py': 'x = 1', 'test_cart.py': '' }))
assert.strictEqual(d.dev, null); assert.strictEqual(d.test, 'python3 -m unittest -q'); assert.ok(d.notes.length)
d = detectProject(project({ 'notes.txt': 'x' })); assert.strictEqual(d.stack, 'unknown'); assert.strictEqual(d.command, null)
assert.match(rewriteHtml('<html><head></head><a href="/x"><img src="/a.png"><a href="//cdn/x"><a href="y">', '/preview/abc/'), /<base href="\/preview\/abc\/"[\s\S]*href="\/preview\/abc\/x"[\s\S]*src="\/preview\/abc\/a\.png"[\s\S]*href="\/\/cdn\/x"[\s\S]*href="y"/)

// ---- 2. a real background process behind the preview proxy
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-runit-'))
const procs = []; let pm; let front
try {
  const files = { 'server.js': `require('http').createServer((q,s)=>{ if(q.url==='/about'){s.setHeader('content-type','text/plain');return s.end('about page')} s.setHeader('content-type','text/html'); s.end('<html><head></head><body><a href="/about">about</a></body></html>') }).listen(process.env.PORT,'0.0.0.0',()=>console.log('listening on '+process.env.PORT))` }
  const room = { roomName: 'runit', list: () => Object.keys(files), read: p => files[p] }
  pm = new ProcessManager({ root: path.join(dir, 'procs'), ttlMs: 60000 })
  const started = await pm.start({ room, name: 'web', command: 'node server.js' })
  assert.match(started.previewPath, /^\/preview\/[0-9a-f]{24}\/$/)
  const ready = await pm.waitReady('runit', 'web', 15000)
  assert.strictEqual(ready.status, 'running'); assert.ok(ready.port >= 4100)
  await until(() => /listening on \d+/.test(pm.logs('runit', 'web')), 'logs show listening')
  assert.match(pm.logs('runit', 'web'), /listening on \d+/)
  const handler = previewHandler(pm)
  front = http.createServer((req, res) => { if (!handler(req, res)) { res.writeHead(404); res.end() } })
  const FP = await freePort(); await new Promise(r => front.listen(FP, '127.0.0.1', r))
  const get = async p => { const r = await fetch(`http://127.0.0.1:${FP}${p}`, { redirect: 'manual' }); return { status: r.status, text: await r.text(), loc: r.headers.get('location') } }
  const noSlash = await get(started.previewPath.slice(0, -1)); assert.strictEqual(noSlash.status, 308)
  const page = await get(started.previewPath); assert.strictEqual(page.status, 200)
  assert.ok(page.text.includes(`<base href="${started.previewPath}">`) && page.text.includes(`href="${started.previewPath}about"`), 'links stay under the preview prefix: ' + page.text)
  assert.strictEqual((await get(started.previewPath + 'about')).text, 'about page')
  assert.strictEqual((await get('/preview/' + 'f'.repeat(24) + '/')).status, 404, 'unknown token')
  assert.strictEqual((await get('/other')).status, 404, 'not a preview path')
  assert.strictEqual(await pm.stop('runit', 'web'), true)
  assert.strictEqual((await get(started.previewPath)).status, 404, 'a stopped preview is gone')
  // limit per room
  for (const n of ['a', 'b', 'c']) await pm.start({ room, name: n, command: 'sleep 30' })
  await assert.rejects(() => pm.start({ room, name: 'd', command: 'sleep 30' }), /limit 3/)
  pm.stopAll()

  // ---- 3. through the agent (demo mode) and the realtime server
  fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
  const PORT = await freePort(); const SPORT = await freePort()
  const here = path.dirname(new URL(import.meta.url).pathname)
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), MURMIO_SUGGEST_UPSTREAM: `http://127.0.0.1:${SPORT}/suggest` }, stdio: 'ignore' }))
  await wait(900)
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'runit2', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(SPORT), MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), MURMIO_PUBLIC_URL: `http://127.0.0.1:${PORT}`, NEBIUS_API_KEY: '' }, stdio: 'ignore' }))
  await wait(1800)
  const doc = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'runit2', doc, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  await until(() => [...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'), 'coder ready in room', 15000)
  const filesMap = fileStore(doc); const chat = doc.getArray('chat')
  const t = new Y.Text(); t.insert(0, '<html><head><title>x</title></head><body><h1>hello from the agent</h1></body></html>', { by: 'import' }); filesMap.set('index.html', t)
  doc.getMap('settings').set('agentMode', 'manual')
  const m = new Y.Map(); const tx = new Y.Text()
  doc.transact(() => { m.set('id', 'u1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); tx.insert(0, '@coder start the website'); chat.push([m]) })
  const card = await until(() => chat.toArray().find(x => x.get('role') === 'approval' && /http\.server/.test(x.get('text').toString())), 'an approval card for starting the server')
  doc.transact(() => { card.set('status', 'approved'); card.set('decidedBy', 'alice') })
  const note = await until(() => chat.toArray().find(x => x.get('role') === 'tool' && /started "web": http/.test(x.get('text').toString())), 'the start note with a link', 60000)
  const url = /started "web": (\S+)/.exec(note.get('text').toString())[1]
  assert.ok(url.startsWith(`http://127.0.0.1:${PORT}/preview/`), 'the link goes through the realtime server: ' + url)
  const viaServer = await (await fetch(url)).text()
  assert.match(viaServer, /hello from the agent/, 'the previewed page is reachable through the server')
  const reply = await until(() => chat.toArray().find(x => x.get('role') === 'agent' && /Started it\. Open http/.test(x.get('text').toString())), 'the closing reply')
  assert.ok(reply)
  console.log('run-it tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally {
  if (pm) pm.stopAll(); if (front) front.close(); for (const x of procs) x.kill()
  setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0) }, 300)
}
