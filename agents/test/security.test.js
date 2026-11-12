import { fileStore } from '../../app/file-store.js'
// Hardening checks: who may start jobs on runners, what a git push may bring into the workspace, and what a peer may inject.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import { createRequire } from 'node:module'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const require = createRequire(import.meta.url)
const { safeColor } = require('../../extensions/murmio-collab/lib/binding')
assert.strictEqual(safeColor('hsl(120, 70%, 50%)'), 'hsl(120, 70%, 50%)'); assert.strictEqual(safeColor('#a1b2c3'), '#a1b2c3')
assert.strictEqual(safeColor('red;background:url(x)'), '#888888'); assert.strictEqual(safeColor('"><script>'), '#888888'); assert.strictEqual(safeColor(undefined), '#888888')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-sec-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\nagent-1:tok-g\nrunner-box:tok-r\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const procs = []
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(100) } throw new Error('timed out waiting for: ' + what) }
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=alice', '-c', 'user.email=a@x', ...a], { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: path.join(dir, 'data'), MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' }))
  await wait(900)
  procs.push(spawn('node', [path.join(here, '../../runner/index.js'), '--server', `ws://127.0.0.1:${PORT}`, '--token', 'tok-r', '--label', 'box', '--allow-room', '*', '--root', path.join(dir, 'rr'), '--isolation', 'trusted-local'], { stdio: 'ignore' }))
  const runners = await until(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/runners`, { headers: { Authorization: 'Bearer tok-a' } })
      if (!r.ok) return null
      const j = await r.json()
      return j.length ? j : null
    } catch { return null }
  }, 'runner registered')
  const job = tok => fetch(`http://127.0.0.1:${PORT}/api/run`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ runner: runners[0].id, room: 'r', files: {}, command: 'echo hi' }) })
  assert.strictEqual((await job('tok-a')).status, 403, 'a person\'s token cannot start jobs on a runner (it would skip the approval flow)')
  assert.strictEqual((await job('nope')).status, 401)
  const ok = await job('tok-g'); assert.strictEqual(ok.status, 200); assert.match(await ok.text(), /"hi/, 'an agent identity can')

  // a git push cannot plant editor config or escape the workspace
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'sec', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  const t = new Y.Text(); t.insert(0, 'ok\n'); fileStore(d).set('a.txt', t); await wait(600)
  const clone = path.join(dir, 'clone')
  git(dir, 'clone', '-q', `http://x:tok-a@127.0.0.1:${PORT}/git/sec`, clone)
  fs.mkdirSync(path.join(clone, '.vscode'), { recursive: true }); fs.writeFileSync(path.join(clone, '.vscode/tasks.json'), '{"tasks":[]}')
  fs.mkdirSync(path.join(clone, 'src'), { recursive: true }); fs.writeFileSync(path.join(clone, 'src/fine.txt'), 'fine\n')
  git(clone, 'add', '-A'); git(clone, 'commit', '-q', '-m', 'sneaky'); git(clone, 'push', '-q', 'origin', 'HEAD:main'); await wait(1500)
  const keys = [...fileStore(d).keys()]
  assert.ok(keys.includes('src/fine.txt'), 'normal files come in: ' + keys)
  assert.ok(!keys.some(k => k.includes('.vscode')), 'editor config from a push is not brought into the workspace: ' + keys)
  console.log('security tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message, e.stderr ? String(e.stderr).slice(0, 200) : ''); process.exitCode = 1 } finally { for (const x of procs) x.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0) }, 300) }
