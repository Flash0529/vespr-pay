// Git hosting end to end with the real git binary: commit the live workspace, clone it, push back, pull live edits, blame.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import { fileStore } from '../../app/file-store.js'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-git-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: path.join(dir, 'data'), MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
const wait = ms => new Promise(r => setTimeout(r, ms))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=alice', '-c', 'user.email=a@x', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
const api = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer tok-a' }, body: body === undefined ? undefined : JSON.stringify(body) })
try {
  await wait(900)
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room7', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  const files = fileStore(d)
  const a = new Y.Text(); a.insert(0, 'def f():\n    return 1\n', { by: 'import' }); files.set('a.py', a)
  a.insert(a.length, 'def g():\n    return 2\n', { by: 'coder', ai: true, model: 'nemotron', msg: 'm1', t: Math.floor(Date.now() / 60000) })
  const gone = new Y.Text(); gone.insert(0, 'delete me\n', { by: 'import' }); files.set('old.txt', gone)
  const pv = new Y.Map(); d.transact(() => { pv.set('ts', Date.now()); pv.set('file', 'a.py'); pv.set('by', 'coder'); pv.set('model', 'nemotron'); pv.set('msgId', ''); pv.set('summary', 'edited a.py'); d.getArray('provenance').push([pv]) })
  await wait(700)

  // commit with an auto-written intent message
  let r = await api('/api/git/room7/commit', {}); assert.strictEqual(r.status, 200); let c = await r.json()
  assert.ok(c.sha && /coder/.test(c.message) && /edited a\.py/.test(c.message), 'intent-log message: ' + c.message)
  r = await api('/api/git/room7/commit', {}); assert.strictEqual((await r.json()).unchanged, true, 'nothing to commit twice')
  assert.strictEqual((await fetch(`http://127.0.0.1:${PORT}/api/git/room7/log`)).status, 401)
  const log = await (await api('/api/git/room7/log')).json(); assert.strictEqual(log.length, 1)

  // clone with any user name and the token as the password
  const clone = path.join(dir, 'clone')
  assert.throws(() => git(dir, 'clone', '-q', `http://x:wrong@127.0.0.1:${PORT}/git/room7`, path.join(dir, 'bad')), /./, 'wrong token cannot clone')
  git(dir, 'clone', '-q', `http://x:tok-a@127.0.0.1:${PORT}/git/room7`, clone)
  assert.strictEqual(fs.readFileSync(path.join(clone, 'a.py'), 'utf8'), 'def f():\n    return 1\ndef g():\n    return 2\n')
  // push: edit, add and delete files in the clone
  fs.writeFileSync(path.join(clone, 'a.py'), 'def f():\n    return 100\ndef g():\n    return 2\n')
  fs.writeFileSync(path.join(clone, 'new.md'), '# hello\n'); fs.rmSync(path.join(clone, 'old.txt'))
  git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', 'edit from my laptop'); git(clone, 'push', '-q', 'origin', 'HEAD:main')
  await wait(1200)
  assert.strictEqual(files.get('a.py').toString(), 'def f():\n    return 100\ndef g():\n    return 2\n', 'push changed the live workspace')
  assert.strictEqual(files.get('new.md').toString(), '# hello\n'); assert.strictEqual(files.get('old.txt'), undefined, 'deleted file removed from the workspace')
  const attr = files.get('a.py').toDelta().find(op => op.attributes && op.attributes.via === 'git push').attributes
  assert.strictEqual(attr.by, 'alice'); assert.strictEqual(attr.via, 'git push')
  assert.strictEqual(files.get('a.py').toDelta().find(op => op.insert.includes('def g')).attributes.by, 'coder', 'untouched lines keep their original author')
  assert.ok(d.getArray('chat').toArray().some(m => /pushed to git/.test(m.get('text').toString())), 'push announced in the shared chat')

  // a live edit is visible to the next pull
  files.get('new.md').insert(8, 'live line\n', { by: 'alice', t: 1 }); await wait(800)
  git(clone, 'pull', '-q', '--ff-only', 'origin', 'main')
  assert.strictEqual(fs.readFileSync(path.join(clone, 'new.md'), 'utf8'), '# hello\nlive line\n', 'pull gets live edits')

  // blame from authorship
  const bl = await (await api('/api/git/room7/blame?file=a.py')).json()
  assert.strictEqual(bl[0].by, 'import'); assert.strictEqual(bl[1].by, 'alice'); assert.strictEqual(bl[2].by, 'coder'); assert.strictEqual(bl[2].ai, true)
  const renamedText = files.get('new.md'); files.rename([['new.md', 'renamed.md']]); await wait(600)
  r = await api('/api/git/room7/commit', { message: 'rename keeps shared content' }); assert.strictEqual(r.status, 200)
  git(clone, 'pull', '-q', '--ff-only', 'origin', 'main')
  assert.strictEqual(fs.existsSync(path.join(clone, 'new.md')), false)
  assert.strictEqual(fs.readFileSync(path.join(clone, 'renamed.md'), 'utf8'), '# hello\nlive line\n')
  assert.strictEqual(files.get('renamed.md'), renamedText)
  console.log('git tests passed. commit message was:\n' + c.message)
  p.destroy()
} catch (e) { console.error('FAILED:', e.message, e.stderr ? String(e.stderr).slice(0, 300) : ''); process.exitCode = 1 } finally { srv.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit() }, 300) }
