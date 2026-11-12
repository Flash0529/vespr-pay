// Usage ledger: only agents with a static token may record, the server prices every entry itself, a retried report counts once,
// people see only their own usage, and the ledger survives a restart. Run: node server/test/usage-ledger.test.js
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createLedger, priceEntry, DEFAULT_PRICES } from '../usage-ledger.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'))
const tokens = new Map([['tok-coder', 'coder'], ['tok-alice', 'alice'], ['tok-bob', 'bob'], ['sess-fake-coder', 'coder']])
const writers = new Set(['tok-coder']) // the static agent token, not an account that merely calls itself "coder"
let clock = Date.UTC(2026, 10, 4, 12)
const make = () => createLedger({ DATA, identify: t => tokens.get(t), isWriter: t => writers.has(t), markup: 1.3, now: () => clock })
let ledger = make()
const srv = http.createServer((req, res) => { if (!ledger.http(req, res)) { res.writeHead(404); res.end() } })
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
const call = async (method, p, token, body) => { const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) } }
const entry = (over = {}) => ({ id: 'call-' + Math.random().toString(36).slice(2, 12), room: 'shop', person: 'alice', feature: 'agent', model: 'nvidia/nemotron-3-super-120b-a12b', input: 18617, cached: 0, output: 337, ...over })

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

await t('prices come from the server table: the measured single-agent fix costs $0.0059', () => {
  const { costMicros, unknownModel } = priceEntry(DEFAULT_PRICES, { model: 'nvidia/nemotron-3-super-120b-a12b', input: 18617, cached: 0, output: 337 })
  assert.strictEqual(costMicros, 5888.4); assert.strictEqual(unknownModel, false)
  assert.strictEqual(priceEntry(DEFAULT_PRICES, { model: 'nvidia/Nemotron-3_5-Lightning', input: 1200, cached: 1000, output: 40 }).costMicros, 51.6, 'cached input at the cached rate, ids case-insensitive')
  const odd = priceEntry(DEFAULT_PRICES, { model: 'made-up', input: 1000, cached: 0, output: 1000 })
  assert.deepStrictEqual(odd, { costMicros: 4000, unknownModel: true }, 'an unknown model is billed at the dearest known one, never free')
})

await t('only an agent with its static token records; nobody else, whatever they call themselves', async () => {
  assert.strictEqual((await call('POST', '/api/usage/record', null, entry())).status, 401)
  assert.strictEqual((await call('POST', '/api/usage/record', 'tok-alice', entry())).status, 403, 'a person cannot bill anyone')
  assert.strictEqual((await call('POST', '/api/usage/record', 'sess-fake-coder', entry())).status, 403, 'an account named "coder" is not the agent')
  const ok = await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-alice-0001', costMicros: 1 }))
  assert.strictEqual(ok.status, 201); assert.strictEqual(ok.j.costMicros, 5888.4, 'a cost the agent sends is ignored')
})

await t('a retried report counts once', async () => {
  const again = await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-alice-0001' }))
  assert.deepStrictEqual([again.status, again.j.duplicate], [200, true]); assert.strictEqual(ledger.size, 1)
})

await t('bad reports are refused', async () => {
  for (const bad of [{ person: '' }, { input: -1 }, { input: 1.5 }, { output: 9e9 }, { cached: 20000 }, { model: '' }, { id: 'x' }]) {
    assert.strictEqual((await call('POST', '/api/usage/record', 'tok-coder', entry(bad))).status, 400, JSON.stringify(bad))
  }
  assert.strictEqual(ledger.size, 1)
})

await t('people see only their own usage, in tokens and at the 1.30x price, by day, feature, agent and model', async () => {
  await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-alice-0002', feature: 'suggest', model: 'nvidia/Nemotron-3_5-Lightning', input: 1200, cached: 0, output: 40 }))
  await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-bob-0001', person: 'bob', input: 50000, output: 2000 }))
  const me = await call('GET', '/api/usage/me', 'tok-alice')
  assert.strictEqual(me.status, 200)
  assert.deepStrictEqual([me.j.total.calls, me.j.total.input, me.j.total.output], [2, 19817, 377])
  assert.strictEqual(me.j.total.price_usd, Math.round((5888.4 + 81.6) * 1.3) / 1e6, 'provider cost x 1.30, in dollars')
  assert.deepStrictEqual(Object.keys(me.j.byFeature).sort(), ['agent', 'suggest'])
  assert.deepStrictEqual(Object.keys(me.j.byDay), ['2026-11-04'])
  assert.ok(!JSON.stringify(me.j).includes('bob'), "bob's usage is not in alice's view")
  assert.strictEqual((await call('GET', '/api/usage/me', null)).status, 401)
})

await t('older usage drops out of the window', async () => {
  clock += 40 * 86_400_000
  assert.strictEqual((await call('GET', '/api/usage/me?days=30', 'tok-alice')).j.total.calls, 0)
  assert.strictEqual((await call('GET', '/api/usage/me?days=92', 'tok-alice')).j.total.calls, 2)
})

await t('the ledger survives a restart, files are private, and a replayed id still counts once', async () => {
  const files = fs.readdirSync(path.join(DATA, 'ledger')); assert.deepStrictEqual(files, ['2026-11.jsonl'])
  assert.strictEqual(fs.statSync(path.join(DATA, 'ledger', files[0])).mode & 0o077, 0, 'no one but the server user can read it')
  ledger = make(); assert.strictEqual(ledger.size, 3)
  assert.strictEqual((await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-alice-0001' }))).j.duplicate, true)
})

await t('a prices.json in the data folder replaces the built-in table', async () => {
  fs.writeFileSync(path.join(DATA, 'prices.json'), JSON.stringify({ 'nvidia/nemotron-3-super-120b-a12b': { input: 0.6, cached: 0.1, output: 1.8 } }))
  const r = await call('POST', '/api/usage/record', 'tok-coder', entry({ id: 'call-alice-0099', input: 1000, output: 0 }))
  assert.strictEqual(r.j.costMicros, 600)
})

srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`usage-ledger tests passed (${n}): server-side prices, agent-only writes, retries count once, validation, own usage only, window, restart, price file`)
