// Who pays in a shared chat (cost-sharing.js): each pays their own, an even split whose odd micro-cents take turns starting with
// the maker, or one person pays everything (the maker, or an acceptor who agrees). Plans bind only people who accepted, only from then on.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createCostSharing } from '../cost-sharing.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sharing-'))
let clock = 1000; const log = []
const use = (person, room, costMicros) => log.push({ ts: ++clock, person, room, costMicros })
const tokens = new Map([['tok-a', 'ana'], ['tok-b', 'bo'], ['tok-c', 'cy']])
const make = () => createCostSharing({ DATA, identify: t => tokens.get(t), entries: () => log, markup: 1, now: () => clock })
let s = make()
let n = 0
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++ }, e => { console.error('FAILED:', name); throw e })
const spent = () => Object.fromEntries(['ana', 'bo', 'cy'].map(p => [p, s.spentMicros(p)]))

await ok('no plan: everyone pays for their own prompts', () => {
  use('ana', 'r1', 100); use('bo', 'r1', 50)
  assert.deepStrictEqual(spent(), { ana: 100, bo: 50, cy: 0 })
  assert.deepStrictEqual(s.payersFor('bo', 'r1'), ['bo'])
})

await ok('split: only accepted people, only from when they accepted; odd bits take turns from the maker', () => {
  clock++; assert.strictEqual(s.setPlan('ana', 'r1', 'split').code, 200)
  use('bo', 'r1', 10) // bo has not accepted yet: his own
  assert.deepStrictEqual(spent(), { ana: 100, bo: 60, cy: 0 })
  clock++; s.accept('bo', 'r1'); clock++; s.accept('cy', 'r1')
  use('bo', 'r1', 10) // 10 / 3 = 3 each, 1 left: ana (the maker) first
  assert.deepStrictEqual(spent(), { ana: 104, bo: 63, cy: 3 })
  use('cy', 'r1', 11) // 3 each, 2 left: bo, then cy
  assert.deepStrictEqual(spent(), { ana: 107, bo: 67, cy: 7 })
  use('ana', 'r1', 1) // 0 each, 1 left: back to ana
  assert.deepStrictEqual(spent(), { ana: 108, bo: 67, cy: 7 })
  const total = Object.values(spent()).reduce((a, b) => a + b, 0)
  assert.strictEqual(total, 100 + 50 + 10 + 10 + 11 + 1, 'nothing lost or made up')
  assert.deepStrictEqual(s.payersFor('cy', 'r1'), ['ana', 'bo', 'cy'], 'everyone in the split needs credit')
})

await ok('other chats are not touched by this one\'s plan', () => {
  use('bo', 'r2', 40); assert.strictEqual(s.spentMicros('bo'), 107)
})

await ok('one payer (the maker): the maker pays everything for people who accepted', () => {
  clock++; assert.strictEqual(s.setPlan('ana', 'r3', 'one').code, 200)
  use('cy', 'r3', 30) // cy has not accepted: own
  clock++; s.accept('cy', 'r3'); use('cy', 'r3', 30)
  assert.strictEqual(s.spentMicros('cy'), 7 + 30); assert.strictEqual(s.spentMicros('ana'), 108 + 30)
  assert.deepStrictEqual(s.payersFor('cy', 'r3'), ['ana'])
})

await ok('one payer (an acceptor): nobody is charged for others until someone agrees; then only one can', () => {
  clock++; s.setPlan('bo', 'r4', 'one', 'acceptor')
  assert.strictEqual(s.view('r4', 'bo').needs_payer, true)
  clock++; s.accept('ana', 'r4'); use('ana', 'r4', 20) // no payer yet: own
  assert.strictEqual(s.spentMicros('ana'), 138 + 20)
  clock++; assert.strictEqual(s.accept('cy', 'r4', true).code, 200)
  assert.strictEqual(s.accept('ana', 'r4', true).code, 409, 'a second payer is refused')
  use('ana', 'r4', 20); use('bo', 'r4', 5)
  assert.strictEqual(s.spentMicros('cy'), 37 + 25); assert.strictEqual(s.spentMicros('ana'), 158)
})

await ok('only the maker changes a plan; a change asks everyone again', () => {
  assert.strictEqual(s.setPlan('bo', 'r1', 'each').code, 403)
  clock++; s.setPlan('ana', 'r1', 'one')
  assert.deepStrictEqual(s.view('r1', 'bo').members, ['ana'], 'bo must accept the new plan')
  use('bo', 'r1', 9); assert.strictEqual(s.spentMicros('bo'), 107 + 9, 'own until he accepts')
})

await ok('leaving: back to paying your own from now on; a leaving payer stops paying', () => {
  clock++; s.leave('cy', 'r4'); use('ana', 'r4', 4)
  assert.strictEqual(s.spentMicros('cy'), 62); assert.strictEqual(s.spentMicros('ana'), 162)
})

await ok('someone already in the chat who agrees to pay later never pays for what came before', () => {
  clock++; s.setPlan('bo', 'r6', 'one', 'acceptor'); clock++; s.accept('ana', 'r6'); clock++; s.accept('cy', 'r6')
  const [a, c] = [s.spentMicros('ana'), s.spentMicros('cy')]
  use('ana', 'r6', 8) // no payer yet: hers
  clock++; assert.strictEqual(s.accept('cy', 'r6', true).code, 200); use('ana', 'r6', 6)
  assert.strictEqual(s.spentMicros('ana'), a + 8); assert.strictEqual(s.spentMicros('cy'), c + 6)
})

await ok('bad input and history survive a restart', () => {
  assert.strictEqual(s.setPlan('ana', 'Bad Room', 'split').code, 400)
  assert.strictEqual(s.setPlan('ana', 'r9', 'free').code, 400)
  assert.strictEqual(s.accept('ana', 'nope').code, 404)
  const before = spent(); s = make(); assert.deepStrictEqual(spent(), before)
  assert.ok((fs.statSync(path.join(DATA, 'billing', 'plans.json')).mode & 0o077) === 0, 'plans file is private')
})

await ok('over HTTP: signed-in only, the maker sets, others accept, everyone sees what they paid here', async () => {
  const app = http.createServer((req, res) => { if (!s.http(req, res)) { res.writeHead(404); res.end() } })
  await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`
  const call = async (method, p, token, body) => { const r = await fetch(base + p, { method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body && JSON.stringify(body) }); return { status: r.status, j: await r.json() } }
  assert.strictEqual((await call('GET', '/api/billing/plan?room=r5')).status, 401)
  clock++; assert.strictEqual((await call('POST', '/api/billing/plan', 'tok-c', { room: 'r5', mode: 'split' })).j.mode, 'split')
  clock++; assert.deepStrictEqual((await call('POST', '/api/billing/plan/accept', 'tok-a', { room: 'r5' })).j.members, ['cy', 'ana'])
  use('ana', 'r5', 7)
  const v = (await call('GET', '/api/billing/plan?room=r5', 'tok-a')).j
  assert.strictEqual(v.joined, true); assert.strictEqual(v.paid_usd, 3 / 1e6); assert.strictEqual(v.text, 'Everyone splits every cost evenly')
  assert.strictEqual((await call('GET', '/api/billing/plan?room=r5', 'tok-c')).j.paid_usd, 4 / 1e6, 'cy made the chat, so the odd one is hers')
  app.close()
})

console.log(`cost-sharing tests passed (${n}): own by default, split with odd bits in turn from the maker, other chats untouched, maker pays, an acceptor pays (only one), maker-only changes, leaving, a late payer only pays from then, bad input and restart, over HTTP`)
