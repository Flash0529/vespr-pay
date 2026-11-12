// A rejected model key (or an unreachable provider) must not crash the agent: it stays up as the scripted demo agent and says why.
// (A wrong key once put a live agent in a restart loop; this test keeps that from coming back.)
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-kf-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const SPORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(150) } throw new Error('timed out waiting for: ' + what) }
const rejecting = http.createServer((req, res) => { res.statusCode = 401; res.end('{"error":"invalid key"}') })
const port = await freePort(); await new Promise(r => rejecting.listen(port, '127.0.0.1', r))
const procs = []; let log = ''
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' }))
  await wait(900)
  const agent = spawn('node', [path.join(here, '../index.js')], { env: { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room9', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(SPORT), NEBIUS_API_KEY: 'not-a-real-key', NEBIUS_BASE_URL: `http://127.0.0.1:${rejecting.address().port}/v1` }, stdio: ['ignore', 'pipe', 'pipe'] })
  agent.stdout.on('data', c => { log += c }); agent.stderr.on('data', c => { log += c }); procs.push(agent)
  await until(() => /ready in room/.test(log), 'the agent to come up despite the rejected key')
  assert.strictEqual(agent.exitCode, null, 'the agent is still running')
  assert.match(log, /falling back to the scripted demo agent/, 'it says it fell back')
  assert.match(log, /HTTP 401/, 'it says why')
  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room9', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  const chat = d.getArray('chat')
  const m = new Y.Map(); const tx = new Y.Text()
  d.transact(() => { m.set('id', 'u1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder hello') })
  await until(() => chat.toArray().find(x => x.get('role') === 'agent'), 'a reply from the scripted agent')
  console.log('key fallback tests passed')
  p.destroy()
} catch (e) { console.error('FAILED:', e.message, '\n', log.slice(-400)); process.exitCode = 1 } finally { for (const x of procs) x.kill(); rejecting.close(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(), 200) }
