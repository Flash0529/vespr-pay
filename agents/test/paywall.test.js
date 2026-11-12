// The paywall (src/ledger.js createPaywall): the agent asks before spending on someone, remembers the answer briefly, never
// blocks work when the server cannot answer, and when the person is out it makes no model call and posts the usage-limit card.
import assert from 'node:assert'
import { createPaywall, LIMIT } from '../src/ledger.js'
import { respond } from '../src/agent.js'
import { suggest } from '../src/suggest.js'

let n = 0
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++ }, e => { console.error('FAILED:', name); throw e })

function fakeServer (answers) {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization })
    const a = answers(new URL(url).searchParams.get('person'))
    if (a instanceof Error) throw a
    return { ok: a.status ? a.status < 400 : true, status: a.status || 200, json: async () => a }
  }
  return { calls, fetchImpl }
}

await ok('asks the server with the agent token and remembers a yes', async () => {
  let t = 0; const s = fakeServer(() => ({ ok: true }))
  const allowed = createPaywall({ server: 'ws://collab:8241/', token: 'tok-agent', fetchImpl: s.fetchImpl, now: () => t, log: () => {} })
  assert.deepStrictEqual(await allowed('ana b'), { ok: true })
  assert.strictEqual(s.calls[0].url, 'http://collab:8241/api/billing/allowance?person=ana%20b&room=', 'http base, person encoded')
  assert.strictEqual(s.calls[0].auth, 'Bearer tok-agent')
  t = 29000; await allowed('ana b'); assert.strictEqual(s.calls.length, 1, 'a yes is kept for 30 s')
  t = 31000; await allowed('ana b'); assert.strictEqual(s.calls.length, 2, 'then asked again')
  await allowed('ana b', 'team-x'); assert.strictEqual(s.calls.length, 3, 'each chat is asked on its own (who pays can differ)')
  assert.match(s.calls[2].url, /person=ana%20b&room=team-x$/)
})

await ok('a no is rechecked within seconds, so buying more unlocks quickly', async () => {
  let t = 0; let paid = false; const s = fakeServer(() => ({ ok: paid }))
  const allowed = createPaywall({ server: 'http://x', token: 'k', fetchImpl: s.fetchImpl, now: () => t, log: () => {} })
  assert.strictEqual((await allowed('ana')).ok, false)
  paid = true; t = 4000; assert.strictEqual((await allowed('ana')).ok, false, 'still the cached no')
  t = 6000; assert.strictEqual((await allowed('ana')).ok, true, 'rechecked after 5 s')
})

await ok('only an explicit yes counts', async () => {
  const s = fakeServer(() => ({ ok: 'yes' }))
  const allowed = createPaywall({ server: 'http://x', token: 'k', fetchImpl: s.fetchImpl, log: () => {} })
  assert.strictEqual((await allowed('ana')).ok, false)
})

await ok('server down or refusing: the work goes ahead, the miss is logged, nothing is cached', async () => {
  const logs = []; let mode = 'down'
  const s = fakeServer(() => mode === 'down' ? new Error('ECONNREFUSED') : { status: 403, error: 'agents only' })
  const allowed = createPaywall({ server: 'http://x', token: 'k', fetchImpl: s.fetchImpl, log: m => logs.push(m) })
  assert.deepStrictEqual(await allowed('ana'), { ok: true, unchecked: true })
  mode = 'refused'; assert.deepStrictEqual(await allowed('ana'), { ok: true, unchecked: true })
  assert.strictEqual(s.calls.length, 2, 'not cached'); assert.match(logs.join('\n'), /ECONNREFUSED/); assert.match(logs.join('\n'), /HTTP 403/)
})

await ok('nobody to bill (a system task) is never checked', async () => {
  const s = fakeServer(() => ({ ok: false }))
  const allowed = createPaywall({ server: 'http://x', token: 'k', fetchImpl: s.fetchImpl })
  assert.deepStrictEqual(await allowed(''), { ok: true }); assert.strictEqual(s.calls.length, 0)
})

const trigger = { get: k => ({ id: 'm1', author: 'ana', isAgent: false, text: '@coder fix it' })[k] }
const noModel = { complete () { throw new Error('the model was called') }, once () { throw new Error('the model was called') }, modelFor: () => 'm', label: 'm' }

await ok('respond: out of usage posts the limit card for the asker and makes no model call', async () => {
  const cards = []; const asked = []
  const room = { roomName: 'r', limit: (p, l) => cards.push([p, l]) }
  await respond({ room, llm: noModel, trigger, paywall: async p => { asked.push(p); return { ok: false } } })
  assert.deepStrictEqual(asked, ['ana']); assert.deepStrictEqual(cards, [['ana', LIMIT]])
  assert.deepStrictEqual(LIMIT, { title: 'Usage limit reached', detail: 'Get more usage to keep working' }, "the card's wording")
})

await ok('respond: a delegated task is checked against the person who created it', async () => {
  const cards = []
  await respond({ room: { roomName: 'r', limit: p => cards.push(p) }, llm: noModel, task: { id: 't1', createdBy: 'bo', text: 'x' }, paywall: async () => ({ ok: false }) })
  assert.deepStrictEqual(cards, ['bo'])
})

await ok('suggest: out of usage returns no text and the limit, with no model call', async () => {
  const v = await suggest({ room: { roomName: 'r' }, llm: noModel, user: 'ana', file: 'a.js', prefix: 'x', suffix: '', paywall: async () => ({ ok: false }) })
  assert.strictEqual(v.text, ''); assert.deepStrictEqual(v.limit, LIMIT)
})

console.log(`paywall tests passed (${n}): asks with the agent token, remembers yes, rechecks no quickly, explicit yes only, fails open with a log, system tasks free, respond posts the card without a model call, tasks bill their creator, suggest stops too`)
