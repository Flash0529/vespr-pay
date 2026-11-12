// The agent's usage reporting: the right body (tokens, never a price), retries while the server is down, never throws into the work,
// and end to end: a real server with the ledger on, a real agent, and a person whose request shows up in her own usage view.
import assert from 'node:assert'
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import net from 'node:net'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { fileStore } from '../../app/file-store.js'
import { createLedgerReporter } from '../src/ledger.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const wait = ms => new Promise(r => setTimeout(r, ms))

await t('the report carries tokens and who it was for, never a price; cached never exceeds input', async () => {
  const calls = []
  const report = createLedgerReporter({ server: 'ws://h:1', token: 'tok-c', id: () => 'u-fixed-0001', fetchImpl: async (url, o) => { calls.push({ url, o }); return { ok: true, status: 201 } } })
  assert.strictEqual(report({ person: 'alice', room: 'shop', feature: 'agent', model: 'nvidia/nemotron-3-super-120b-a12b', usage: { prompt: 100.4, completion: 7, cached: 500, estimated: true } }), 'u-fixed-0001')
  await wait(10)
  assert.strictEqual(calls[0].url, 'http://h:1/api/usage/record'); assert.strictEqual(calls[0].o.headers.Authorization, 'Bearer tok-c')
  assert.deepStrictEqual(JSON.parse(calls[0].o.body), { id: 'u-fixed-0001', room: 'shop', person: 'alice', feature: 'agent', model: 'nvidia/nemotron-3-super-120b-a12b', input: 100, cached: 100, output: 7, estimated: true })
  assert.strictEqual(report({ person: '', usage: { prompt: 1 } }), null, 'nobody to bill: nothing sent')
})

await t('a server that is down is retried, and a failure never reaches the agent', async () => {
  let tries = 0; const logs = []
  const report = createLedgerReporter({ server: 'ws://h:1', token: 't', retryMs: [5, 5], log: m => logs.push(m), fetchImpl: async () => { tries++; if (tries < 3) throw new Error('ECONNREFUSED'); return { ok: true, status: 201 } } })
  report({ person: 'alice', feature: 'agent', model: 'm', usage: { prompt: 1, completion: 1 } }); await wait(60)
  assert.strictEqual(tries, 3); assert.deepStrictEqual(logs, [])
  const never = createLedgerReporter({ server: 'ws://h:1', token: 't', retryMs: [1], log: m => logs.push(m), fetchImpl: async () => { throw new Error('down') } })
  assert.doesNotThrow(() => never({ person: 'a', feature: 'agent', model: 'm', usage: { prompt: 1, completion: 1 } })); await wait(30)
  assert.match(logs[0], /usage not recorded after 2 tries: down/)
})

await t('end to end: alice asks the agent, and her usage is in her own view (not in anyone else\'s)', async () => {
  const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-e2e-'))
  fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\nbob:tok-b\ncoder:tok-c\n')
  const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
  const env = { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), VESPR_LEDGER: '1', VESPR_LEDGER_WRITERS: 'coder' }
  const srv = spawn('node', [path.join(here, '../../server/index.js')], { env, stdio: 'ignore' })
  let agent
  try {
    await wait(800)
    const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'room1', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
    p.awareness.setLocalStateField('user', { name: 'alice', isAgent: false }); await new Promise(r => p.once('sync', r))
    const f = new Y.Text(); f.insert(0, 'def fizzbuzz(n):\n    for i in range(n):\n        print(i)\n'); fileStore(d).set('fizzbuzz.py', f)
    d.getMap('settings').set('agentMode', 'acceptEdits')
    const aenv = { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'room1', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(await freePort()), VESPR_LEDGER: '1' }; delete aenv.NEBIUS_API_KEY
    agent = spawn('node', [path.join(here, '../index.js')], { env: aenv, stdio: 'ignore' })
    for (let i = 0; i < 150 && ![...p.awareness.getStates().values()].some(s => s.user && s.user.name === 'coder'); i++) await wait(100)
    const m = new Y.Map(); const tx = new Y.Text()
    d.transact(() => { m.set('id', 'm1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); d.getArray('chat').push([m]); tx.insert(0, '@coder please add a docstring to fizzbuzz.py') })
    const usage = async tok => (await fetch(`http://127.0.0.1:${PORT}/api/usage/me`, { headers: { Authorization: 'Bearer ' + tok } })).json()
    let mine = null
    for (let i = 0; i < 150; i++) { mine = await usage('tok-a'); if (mine.total && mine.total.calls >= 2) break; await wait(100) }
    assert.ok(mine.total.calls >= 2, `alice's calls recorded: ${JSON.stringify(mine.total)}`)
    assert.deepStrictEqual(Object.keys(mine.byAgent), ['coder']); assert.deepStrictEqual(Object.keys(mine.byFeature), ['agent'])
    assert.ok(mine.total.price_usd > 0 && mine.total.input > 0)
    assert.strictEqual((await usage('tok-b')).total.calls, 0, "bob's view is empty")
    const r = await fetch(`http://127.0.0.1:${PORT}/api/usage/record`, { method: 'POST', headers: { Authorization: 'Bearer tok-a', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'forged-000001', person: 'bob', model: 'x', input: 1, output: 1 }) })
    assert.strictEqual(r.status, 403, 'a person cannot write the ledger')
    d.getMap('usage').set('alice', { calls: 999, prompt: 1, completion: 1 }) // the room's live meter is writable by anyone...
    await wait(300); assert.ok((await usage('tok-a')).total.calls < 999, '...and changes nothing in the ledger')
    p.destroy()
  } finally { if (agent) agent.kill(); srv.kill(); await wait(300); fs.rmSync(dir, { recursive: true, force: true }) }
})

console.log(`ledger tests passed (${n}): report body, retries without throwing, end to end with a real server and agent`)
setTimeout(() => process.exit(0), 100)
