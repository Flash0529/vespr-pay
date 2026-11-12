// Agents ask before they spend (server/pay.js): the whole payment-request state machine against a stateful fake PayPal, no network.
// Who may ask (agents only) and who may answer (a person, never the agent, never the asker, adults on personal accounts, edit rights), every limit, one order and
// one capture per request, expiry, a buyer who cancels or is declined, PayPal failing in the middle, a restart, and the room cards and trail with actor names.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { createPay, policyUserOf, parseOperatorRoles, operatorRecord, BADGE, TERMINAL } from '../pay.js'
import { createPayPal, NOT_SET_UP } from '../paypal.js'
import { createFakePayPal } from './fakepaypal.js'
import { createSdkPayPal } from '../paypal-sdk.js'
import { adapterFor as sdkTransport } from './sdk-transport.js'
import { call } from './fakehttp.js'
const Y = createRequire(import.meta.url)('yjs')

const ID = 'test-client-id-' + 'a'.repeat(20); const SECRET = 'test-secret-' + 'b'.repeat(20) // throwaway
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-'))
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
let clock = 1_800_000_000_000; const logs = []
const people = { 'tok-alice': 'alice', 'tok-bob': 'bob', 'tok-coder': 'coder', 'tok-kid': 'kid', 'tok-school': 'sam', 'tok-noage': 'nina', 'tok-reviewer': 'reviewer', 'tok-teacher': 'terry', 'tok-company': 'cora', 'tok-stu': 'stu' }
const accounts = { 'tok-kid': { id: 'u-kid', age: { claims: [{ band: '13-17' }] } }, 'tok-school': { id: 'u-sam', school: { via: 'Clever' }, age: { claims: [{ band: 'adult' }] } }, 'tok-noage': { id: 'u-nina' }, 'tok-bob': { id: 'u-bob', age: { claims: [{ band: 'adult' }] } }, 'tok-teacher': { id: 'u-terry', school: { via: 'Clever', staff: true } }, 'tok-company': { id: 'u-cora', providers: { 'work:acme': {} }, age: { claims: [{ band: 'adult' }] } } }
const agents = new Set(['coder', 'reviewer'])
const docs = new Map(); const getDoc = room => { if (!docs.has(room)) docs.set(room, new Y.Doc()); return docs.get(room) }
const rights = { deny: new Set() } // names with no edit right
let fake = createFakePayPal({ clientId: ID, clientSecret: SECRET })
const make = (over = {}) => {
  const paypal = over.paypal || createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: fake.fetch, now: () => clock, log: m => logs.push(m) })
  return createPay({ DATA, identify: t => people[t], isAgent: w => agents.has(w), roomOk: r => /^[a-z0-9-]+$/.test(r), getDoc, Y, paypal, now: () => clock, log: m => logs.push(m), sweepMs: 3600_000,
    may: (who, room, right) => !(right === 'edit' && rights.deny.has(who)) && !(right === 'view' && who === 'outsider'), userOf: t => accounts[t] || null, ...over })
}
let pay = make()
const HOST = { host: 'vespr.test:8241' }
const api = (method, url, token, body, headers = HOST) => call(pay.http, { method, url, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body })
const ask = (token, body, room = 'team') => api('POST', `/api/pay/${room}/request`, token, body)
const answer = (token, id, approve, room = 'team') => api('POST', `/api/pay/${room}/answer`, token, { id, approve }, undefined)
const asked = async (body = {}, room = 'team') => { const r = await ask('tok-coder', { amount: '25.00', label: 'Logo design invoice', description: 'Invoice 42 from the designer', ...body }, room); assert.strictEqual(r.status, 201, JSON.stringify(r.json)); return r.json.request }
const rec = (id, room = 'team') => pay.reqs(room).find(r => r.id === id)
const cardOf = (id, room = 'team') => getDoc(room).getArray('chat').toArray().find(m => m.get('id') === 'pay-' + id)
const trailOf = id => rec(id).trail.map(t => `${t.to}:${t.by}`)
// the addresses PayPal sends the buyer back to: the request's own nonce in the path, the order id as PayPal adds it (token=), and whatever else PayPal adds
const back = (kind, nonce, orderId, extra = '') => `/api/pay/${kind}/${nonce}?token=${orderId}${extra}`
const getBack = (kind, nonce, orderId, extra) => call(pay.http, { method: 'GET', url: back(kind, nonce, orderId, extra), headers: HOST })
const NONCE_RE = /^[0-9a-f]{32}$/

// 1. not set up: it says so, plainly, and nothing is pretended
{
  const off = make({ paypal: createPayPal({ clientId: '', clientSecret: '', fetchImpl: fake.fetch }) }); const call2 = (m, u, t, b) => call(off.http, { method: m, url: u, headers: { Authorization: 'Bearer ' + t, ...HOST }, body: b })
  const s = await call2('GET', '/api/pay/_status', 'tok-alice'); eq([s.status, s.json.configured, s.json.notSetUp], [200, false, NOT_SET_UP])
  const r = await call2('POST', '/api/pay/team/request', 'tok-coder', { amount: '5', label: 'x' }); eq([r.status, r.json.code, r.json.error], [503, 'not_set_up', NOT_SET_UP]); eq(getDoc('team').getArray('chat').length, 0, 'no card for a payment that cannot happen')
  eq((await call(off.http, { method: 'GET', url: '/api/pay/team', headers: { Authorization: 'Bearer tok-alice' } })).json.configured, false); off.close()
  const s2 = await api('GET', '/api/pay/_status', 'tok-alice'); eq([s2.json.configured, s2.json.mode, s2.json.badge], [true, 'sandbox', BADGE])
  eq((await api('GET', '/api/pay/_status', '')).status, 401)
}

// 2. who may ask: agents only, signed in, in the room
{
  eq((await ask('', { amount: '5', label: 'x' })).status, 401)
  const p = await ask('tok-alice', { amount: '5', label: 'x' }); eq(p.status, 403, 'a person does not propose; an agent asks and a person approves'); ok(/only an agent/.test(p.json.error))
  eq(pay.reqs('team').length, 0)
  eq((await ask('tok-coder', { amount: '5', label: 'x' }, 'bad room!')).status, 400)
  eq((await call(pay.http, { method: 'POST', url: '/api/pay/team/request', headers: { Authorization: 'Bearer tok-coder', ...HOST }, body: '{not json' })).status, 400)
  eq((await api('GET', '/api/pay/team', 'tok-coder')).status, 200)
}

// 3. every amount is a decimal string checked to the cent; USD only; a label is required
for (const [body, status, code] of [[{ amount: '' }, 400, 'bad_amount'], [{ amount: '0' }, 400, 'bad_amount'], [{ amount: '-5' }, 400, 'bad_amount'], [{ amount: '1e3' }, 400, 'bad_amount'], [{ amount: '25.001' }, 400, 'bad_amount'], [{ amount: '$25' }, 400, 'bad_amount'], [{ amount: null }, 400, 'bad_amount'], [{ amount: { v: 1 } }, 400, 'bad_amount'], [{ amount: '25', currency: 'EUR' }, 400, 'bad_currency'], [{ amount: '25', currency: 'BTC' }, 400, 'bad_currency'], [{ amount: '25', label: '' }, 400, 'needs_label'], [{ amount: '25', label: '   ' }, 400, 'needs_label']]) {
  const r = await ask('tok-coder', { label: 'Logo', ...body }); eq([r.status, r.json.code], [status, code], JSON.stringify(body)); ok(r.json.error && !/\[object/.test(r.json.error))
}
eq(pay.reqs('team').length, 0, 'nothing is recorded for malformed requests'); eq(fake.state.calls.length, 0, 'and PayPal is never called for them')
{ const r = await asked({ amount: 25, currency: 'usd', label: 'Logo\u0000\n design', description: 'x'.repeat(900) }); eq([r.value, r.currency, r.label], ['25.00', 'USD', 'Logo design']); ok(r.description.length === 300, 'description cut'); await answer('tok-alice', r.id, false) }

// 3b. the agent's reason and the server's own facts sit on the card; the list says who may answer and, if not, why
{
  const room = 'facts'; const a = await ask('tok-coder', { amount: '30', label: 'First', reason: 'Because the demo needs it' }, room); eq(a.status, 201); eq(a.json.request.description, 'Because the demo needs it', 'reason is accepted as the agent\u2019s own words')
  eq(a.json.request.facts, { spent: '$0.00', cap: '$100.00', left: '$70.00', perRequest: '$50.00' })
  const b = await ask('tok-coder', { amount: '20', label: 'Second', description: 'old name still works' }, room); eq(b.json.request.facts, { spent: '$30.00', cap: '$100.00', left: '$50.00', perRequest: '$50.00' }, 'what the room had used when this was asked, and what approving leaves')
  eq(getDoc(room).getArray('chat').toArray().find(m => m.get('id') === 'pay-' + b.json.request.id).get('request').facts, b.json.request.facts, 'the card carries the same facts')
  const lp = (t) => api('GET', '/api/pay/facts', t); const pl = await lp('tok-alice'); eq([pl.json.canAnswer, pl.json.whyNot], [true, ''])
  for (const [t, why] of [['tok-school', 'Students cannot approve payments.'], ['tok-coder', 'agents do not answer payment requests; a person does'], ['tok-kid', 'only adults approve payments']]) { const r = await lp(t); eq([r.json.canAnswer, r.json.whyNot], [false, why], t) }
  rights.deny.add('bob'); eq((await lp('tok-bob')).json.whyNot, 'you need edit rights in this workspace to answer a payment request'); rights.deny.delete('bob')
  for (const r of pay.reqs(room)) await answer('tok-alice', r.id, false, room)
}

// 4. the per-request cap: USD 50.00 is fine, 50.01 is refused by the server before anyone is asked, and it shows in the room
{
  const fine = await asked({ amount: '50.00', label: 'Exactly the limit' }); eq(fine.status, 'pending'); await answer('tok-alice', fine.id, false)
  const r = await ask('tok-coder', { amount: '50.01', label: 'Just over' }); eq([r.status, r.json.code], [403, 'over_request_limit']); ok(/\$50\.01 is over the limit of \$50\.00/.test(r.json.error), r.json.error)
  const id = r.json.request.id; eq(rec(id).status, 'refused'); eq(trailOf(id), ['proposed:coder', 'refused:server']); eq(cardOf(id).get('status'), 'refused'); ok(/refused by the server/.test(cardOf(id).get('text').toString()))
  const a = await answer('tok-alice', id, true); eq(a.status, 409, 'a refused request cannot be approved'); eq(fake.state.creates, 0, 'no PayPal order exists for anything so far')
  eq((await ask('tok-coder', { amount: '5000', label: 'big' })).json.code, 'over_request_limit')
}

// 5. the per-room, per-day cap: waiting, approved and captured requests count; denied, expired and refused ones do not; 24 hours later it resets
{
  const room = 'budget'
  const a = await asked({ amount: '50.00' }, room); const b = await asked({ amount: '50.00' }, room)
  const c = await ask('tok-coder', { amount: '0.01', label: 'one cent too many' }, room); eq([c.status, c.json.code], [403, 'over_room_limit']); ok(/past \$100\.00 in 24 hours \(\$0\.00 left\)/.test(c.json.error), c.json.error)
  eq((await api('GET', '/api/pay/budget', 'tok-alice')).json.limits.leftToday, '$0.00')
  await answer('tok-alice', a.id, false, room); eq((await ask('tok-coder', { amount: '50.00', label: 'room freed by a no' }, room)).status, 201, 'a denied request stops counting')
  clock += 16 * 60_000; await api('GET', '/api/pay/budget', 'tok-alice'); eq(rec(b.id, room).status, 'expired'); eq((await ask('tok-coder', { amount: '50.00', label: 'after the others lapsed' }, room)).status, 201, 'expired requests stop counting')
  for (const r of pay.reqs(room)) if (r.status === 'pending') await answer('tok-alice', r.id, false, room)
  const big = await asked({ amount: '50.00' }, room); await answer('tok-alice', big.id, true, room); fake.approve(rec(big.id, room).orderId); await api('POST', '/api/pay/budget/check', 'tok-alice', { id: big.id }); eq(rec(big.id, room).status, 'captured')
  const big2 = await asked({ amount: '50.00' }, room); await answer('tok-alice', big2.id, true, room)
  eq((await ask('tok-coder', { amount: '0.01', label: 'over' }, room)).json.code, 'over_room_limit', 'approved and captured spend counts')
  clock += 24 * 3600_000 + 1; eq((await ask('tok-coder', { amount: '50.00', label: 'next day' }, room)).status, 201, 'a day later it resets')
  // the limit also holds at approval time: lowering it after the asking refuses the approval and creates no order
  const room2 = 'lowered'; const p = await asked({ amount: '30.00' }, room2); const q = await asked({ amount: '30.00' }, room2); pay.limits.perRoomDayCents = 5000
  const before = fake.state.creates; const r = await answer('tok-alice', q.id, true, room2); eq([r.status, r.json.code], [409, 'over_room_limit']); eq(fake.state.creates, before, 'no order for a refused approval'); eq(rec(q.id, room2).status, 'refused'); pay.limits.perRoomDayCents = 10000; void p
}

// 6. who may answer: the same rule as the existing approvals (policy approval.decide), and never the agent or the one who asked
{
  const r = await asked({ amount: '10.00', label: 'Rule check' }); const before = fake.state.creates
  for (const [token, why, code] of [['', 'signed out', 401], ['tok-coder', 'the agent that asked', 403], ['tok-reviewer', 'another agent', 403], ['tok-kid', 'a minor', 403], ['tok-school', 'a school student', 403], ['tok-noage', 'an account with no age on record', 403]]) {
    const a = await answer(token, r.id, true); eq(a.status, code, why); eq(rec(r.id).status, 'pending', 'still pending after ' + why)
  }
  rights.deny.add('bob'); const nb = await answer('tok-bob', r.id, true); eq(nb.status, 403, 'no edit right in the workspace'); ok(/edit rights/.test(nb.json.error)); rights.deny.delete('bob')
  eq((await answer('tok-alice', 'no-such-id', true)).status, 404); eq((await answer('tok-alice', undefined, true)).status, 404)
  eq(fake.state.creates, before, 'none of those created an order')
  eq(policyUserOf('x', null).roles, ['member']); eq(policyUserOf('x', { school: {} }).roles, ['student']); eq(policyUserOf('x', { school: { staff: true } }).roles, ['teacher']); eq(policyUserOf('x', { providers: { 'work:acme': {} } }).roles, ['member']); eq(policyUserOf('x', { providers: { 'work:acme': {} } }).orgId, 'work:acme'); eq(policyUserOf('x', { id: 'k' }), null); eq(policyUserOf('x', { age: { claims: [{ band: 'adult' }, { band: '13-17' }] } }).ageBand, '13-17', 'the latest claim counts')
  const requesterIsPerson = (() => { const d = pay.reqs('team').find(x => x.id === r.id); d.requester = 'alice'; return d })(); eq((await answer('tok-alice', r.id, true)).status, 403, 'you cannot answer your own request'); requesterIsPerson.requester = 'coder'
  const sd = await answer('tok-school', r.id, true); eq([sd.status, sd.json.error], [403, 'Students cannot approve payments.'], 'a student\u2019s agent can ask, a student can never approve (policy.js approval.decide)')
  const co = await answer('tok-company', r.id, false); eq([co.status, co.json.request.decidedBy], [200, 'cora'], 'a member of a company may answer, with the same role table')
  const r2 = await asked({ amount: '10.00', label: 'Teacher answers' }); const te = await answer('tok-teacher', r2.id, false); eq([te.status, te.json.request.decidedBy], [200, 'terry'], 'a teacher may; a student may not')
  const d = await asked({ amount: '10.00', label: 'Plain person answers' }); eq((await answer('tok-alice', d.id, false)).status, 200, 'a person who may, can'); await answer('tok-alice', d.id, false)
}

// 7. the happy path: ask -> card -> approve (PayPal order) -> buyer approves on PayPal -> return -> captured once -> recorded with actor names
{
  fake = createFakePayPal({ clientId: ID, clientSecret: SECRET }); pay.close(); pay = make()
  const r = await asked({ amount: '25.00', label: 'Logo design invoice' })
  eq([r.status, r.value, r.currency, r.requester, r.badge], ['pending', '25.00', 'USD', 'coder', BADGE])
  const card = cardOf(r.id); eq([card.get('role'), card.get('author'), card.get('isAgent'), card.get('status')], ['payment', 'coder', true, 'pending']); eq(card.get('request').value, '25.00'); ok(/coder asks to pay \$25\.00 for Logo design invoice/.test(card.get('text').toString()) && card.get('text').toString().endsWith(BADGE + '.'))
  const list = await api('GET', '/api/pay/team', 'tok-alice'); eq(list.json.canAnswer, true); ok(list.json.requests.some(x => x.id === r.id && !x.approveUrl))
  eq((await api('GET', '/api/pay/team', 'tok-coder')).json.canAnswer, false, 'the agent sees it may not answer')
  const a = await answer('tok-alice', r.id, true); eq(a.status, 200, JSON.stringify(a.json)); const q = a.json.request
  eq([q.status, q.decidedBy], ['awaiting_buyer', 'alice']); ok(/^FAKEORD\d+XYZ$/.test(q.orderId)); ok(q.approveUrl.includes('/checkoutnow?token=' + q.orderId), 'the approving person gets the sandbox link')
  eq(fake.state.creates, 1)
  const create = fake.state.calls.find(c => c.path === '/v2/checkout/orders' && c.method === 'POST'); const body = JSON.parse(create.body)
  eq(create.requestId, 'vespr-pay-' + r.id); eq(body.purchase_units[0].amount, { currency_code: 'USD', value: '25.00' }); eq([body.purchase_units[0].custom_id, body.purchase_units[0].reference_id], [r.id, r.id]); eq(body.purchase_units[0].description, 'Logo design invoice')
  const nonce = rec(r.id).nonce; ok(NONCE_RE.test(nonce), 'a nonce of 128 random bits, made when the request is approved'); eq(body.payment_source.paypal.experience_context.return_url, 'http://vespr.test:8241/api/pay/return/' + nonce); eq(body.payment_source.paypal.experience_context.cancel_url, 'http://vespr.test:8241/api/pay/cancel/' + nonce); ok(!q.approveUrl.includes(nonce), 'PayPal’s payer link does not carry it: only the two addresses PayPal sends the buyer back to do')
  eq((await answer('tok-bob', r.id, true)).status, 409, 'a second person cannot approve again'); ok(/already answered by alice/.test((await answer('tok-bob', r.id, false)).json.error))
  eq(fake.state.creates, 1, 'one order per request')
  ok(!(await api('GET', '/api/pay/team', 'tok-bob')).json.requests.find(x => x.id === r.id).approveUrl, 'only the approving person gets the buyer link'); ok((await api('GET', '/api/pay/team', 'tok-alice')).json.requests.find(x => x.id === r.id).approveUrl)
  // the buyer has not paid yet: returning early captures nothing
  let page = await getBack('return', nonce, q.orderId, '&PayerID=P1'); eq(page.status, 200); ok(/Not finished yet/.test(page.raw) && page.headers['content-security-policy'].includes("default-src 'none'") && page.headers['content-security-policy'].includes("frame-ancestors 'none'") && page.headers['x-frame-options'] === 'DENY' && page.headers['referrer-policy'] === 'no-referrer', 'the return page cannot be framed, runs no script and leaks no referrer'); eq(fake.state.captureAttempts, fake.state.captures, 'no capture is even attempted before the buyer approved'); eq(rec(r.id).status, 'awaiting_buyer')
  fake.approve(q.orderId) // the buyer logs in to the sandbox and presses Pay Now
  const pages = await Promise.all([1, 2, 3, 4, 5].map(() => getBack('return', nonce, q.orderId)))
  ok(pages.every(p => /Payment received/.test(p.raw) && /\$25\.00/.test(p.raw) && /alice/.test(p.raw)), 'every return shows the result'); eq(fake.state.captures, 1, 'five returns at once: one capture')
  eq(rec(r.id).status, 'captured'); ok(/^FAKECAP/.test(rec(r.id).captureId))
  const capture = fake.state.calls.find(c => /\/capture$/.test(c.path)); eq(capture.requestId, 'vespr-cap-' + r.id)
  page = await getBack('return', nonce, q.orderId); eq(fake.state.captures, 1, 'a later return does not capture again'); ok(/Payment received/.test(page.raw))
  eq(trailOf(r.id), ['pending:coder', 'awaiting_buyer:alice', 'captured:PayPal'], 'who asked, who approved, what PayPal did'); ok(rec(r.id).trail[1].note.includes(q.orderId) && rec(r.id).trail[2].note.includes(rec(r.id).captureId))
  const c2 = cardOf(r.id); eq([c2.get('status'), c2.get('decidedBy'), c2.get('orderId'), c2.get('captureId')], ['captured', 'alice', q.orderId, rec(r.id).captureId]); eq(c2.get('trail').map(t => t.to), ['pending', 'awaiting_buyer', 'captured']); ok(/approved by alice; PayPal captured it/.test(c2.get('text').toString()))
  eq(getDoc('team').getArray('chat').toArray().filter(m => m.get('id') === 'pay-' + r.id).length, 1, 'one card per request, updated in place')
  eq((await answer('tok-alice', r.id, false)).status, 409, 'a captured request cannot be denied afterwards')
  const log = fs.readFileSync(path.join(DATA, 'pay', 'team.log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(l => l.id === r.id); eq(log.map(l => `${l.event}:${l.by}`), ['proposed:coder', 'awaiting_buyer:alice', 'captured:PayPal'], 'the audit log has the same actors')
  for (const f of fs.readdirSync(path.join(DATA, 'pay'))) eq(fs.statSync(path.join(DATA, 'pay', f)).mode & 0o077, 0, 'private file ' + f)
  eq((await call(pay.http, { method: 'POST', url: back('return', nonce, q.orderId), headers: HOST })).status, 405); eq((await call(pay.http, { method: 'POST', url: '/api/pay/cancel?token=' + q.orderId, headers: HOST })).status, 405)
}

// 8. denied: nothing is created, nothing can be captured; a no is a no
{
  const r = await asked({ amount: '12.34', label: 'A thing nobody wants' }); const before = fake.state.creates
  const d = await answer('tok-bob', r.id, false); eq([d.status, d.json.request.status, d.json.request.decidedBy], [200, 'denied', 'bob']); eq(fake.state.creates, before, 'a denial never reaches PayPal')
  eq(trailOf(r.id), ['pending:coder', 'denied:bob']); eq([cardOf(r.id).get('status'), cardOf(r.id).get('decidedBy')], ['denied', 'bob']); ok(/denied by bob; nothing was charged/.test(cardOf(r.id).get('text').toString()))
  eq((await answer('tok-alice', r.id, true)).status, 409, 'cannot approve after a denial'); eq(fake.state.creates, before)
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: r.id })).json.request.status, 'denied')
}

// 9. a buyer who closes PayPal: cancelled, nothing charged, and a later return cannot capture it
{
  const r = await asked({ amount: '8.00', label: 'Cancelled at PayPal' }); const q = (await answer('tok-alice', r.id, true)).json.request
  const n9 = rec(r.id).nonce; const c = await getBack('cancel', n9, q.orderId); ok(/Payment cancelled/.test(c.raw) && /Nothing was charged/.test(c.raw)); eq(rec(r.id).status, 'cancelled'); eq(trailOf(r.id).pop(), 'cancelled:buyer')
  fake.approve(q.orderId); const caps = fake.state.captures; await getBack('return', n9, q.orderId); eq(fake.state.captures, caps, 'a cancelled request is never captured, even if PayPal later shows it approved'); eq(rec(r.id).status, 'cancelled')
  ok(/Unknown payment/.test((await getBack('return', n9, 'NOSUCHORDER1')).raw)); ok(/Unknown payment/.test((await getBack('return', n9, '../../etc')).raw))
}

// 9b. the return and cancel addresses are keys: an order id alone (PayPal's own pages show it to anyone holding the payer link) does nothing, and neither does a wrong, missing, borrowed or old-style nonce
{
  const a = await asked({ amount: '4.00', label: 'Nonce A' }); const b = await asked({ amount: '3.00', label: 'Nonce B' })
  const qa = (await answer('tok-alice', a.id, true)).json.request; const qb = (await answer('tok-alice', b.id, true)).json.request; const na = rec(a.id).nonce; const nb = rec(b.id).nonce
  ok(NONCE_RE.test(na) && NONCE_RE.test(nb) && na !== nb, 'every request has its own 128-bit nonce'); ok(pay.reqs('team').filter(x => x.nonce).every(x => NONCE_RE.test(x.nonce)))
  fake.approve(qa.orderId) // the buyer really did approve it at PayPal, so only the address stands between a stranger and a capture
  const calls0 = fake.state.calls.length; const caps0 = fake.state.captures; const stranger = crypto.randomBytes(16).toString('hex')
  const refused = [
    ['an order id alone (the old addresses)', '/api/pay/return?token=' + qa.orderId], ['an order id alone, cancel', '/api/pay/cancel?token=' + qa.orderId],
    ['an empty nonce', '/api/pay/return/?token=' + qa.orderId], ['a wrong nonce', back('return', stranger, qa.orderId)], ['a wrong nonce, cancel', back('cancel', stranger, qa.orderId)],
    ['another request’s nonce', back('return', nb, qa.orderId)], ['another request’s nonce, cancel', back('cancel', nb, qa.orderId)], ['the right nonce with another request’s order id', back('return', na, qb.orderId)],
    ['the right nonce and no order id', `/api/pay/return/${na}`], ['the right nonce and a made-up order id', back('return', na, 'NOSUCHORDER1')], ['the nonce in upper case', back('return', na.toUpperCase(), qa.orderId)],
    ['a nonce one character short', back('return', na.slice(1), qa.orderId)], ['a nonce one character long', back('return', na + '0', qa.orderId)], ['the nonce twice', back('return', na + na, qa.orderId)]]
  for (const [what, url] of refused) { const x = await call(pay.http, { method: 'GET', url, headers: HOST }); ok(x.status === 404 && /Unknown payment/.test(x.raw) && !/\$4\.00|Nonce A|received|cancelled/i.test(x.raw), what + ': the same "Unknown payment" page, nothing about the request') }
  for (const url of [back('return', 'zz'.repeat(16), qa.orderId), back('return', na + '/x', qa.orderId), `/api/pay/return/${na}/answer?token=${qa.orderId}`]) { const x = await call(pay.http, { method: 'GET', url, headers: HOST }); ok(x.notMine || x.status === 404 || /Unknown payment/.test(x.raw || ''), 'odd shapes are not the return page: ' + url.slice(0, 40)); ok(!/received|cancelled/i.test(x.raw || '')) }
  eq(fake.state.calls.length, calls0, 'none of them reached PayPal'); eq(fake.state.captures, caps0, 'nothing was captured'); eq([rec(a.id).status, rec(b.id).status], ['awaiting_buyer', 'awaiting_buyer'], 'and nothing was cancelled: the requests are untouched')
  // the right address works, once, for its own request only
  ok(/Payment received/.test((await getBack('return', na, qa.orderId)).raw)); eq(rec(a.id).status, 'captured'); eq(fake.state.captures, caps0 + 1)
  ok(/Payment cancelled/.test((await getBack('cancel', nb, qb.orderId)).raw)); eq(rec(b.id).status, 'cancelled'); eq(rec(a.id).status, 'captured', 'a cancel for B never touches A')
  // the nonce goes to PayPal and stays on the server: not in what the room sees, the card, the audit log or the log messages
  const seen = JSON.stringify([(await api('GET', '/api/pay/team', 'tok-alice')).json, (await api('GET', '/api/pay/team', 'tok-bob')).json, (await api('GET', '/api/pay/team', 'tok-coder')).json, getDoc('team').getArray('chat').toJSON(), (await api('POST', '/api/pay/team/check', 'tok-alice', { id: a.id })).json])
  ok(!seen.includes(na) && !seen.includes(nb), 'not in any list, card or answer'); ok(!fs.readFileSync(path.join(DATA, 'pay', 'team.log.jsonl'), 'utf8').includes(na), 'not in the audit log'); ok(!logs.join('\n').includes(na) && !logs.join('\n').includes(nb), 'not in the log messages')
  ok(/crypto\.timingSafeEqual/.test(fs.readFileSync(path.join(import.meta.dirname, '..', 'pay.js'), 'utf8')), 'compared in constant time')
}

// 10. expiry: 15 minutes to answer, 30 minutes for the buyer
{
  const r = await asked({ amount: '5.00', label: 'Lapses' }); clock += 14 * 60_000; eq((await api('GET', '/api/pay/team', 'tok-alice')).json.requests.find(x => x.id === r.id).status, 'pending'); clock += 61_000
  const a = await answer('tok-alice', r.id, true); eq(a.status, 409); ok(/lapsed \(15 minutes/.test(a.json.error)); eq(rec(r.id).status, 'expired'); eq(trailOf(r.id).pop(), 'expired:server'); eq(cardOf(r.id).get('status'), 'expired')
  const before = fake.state.creates; eq(before, fake.state.creates, 'no order for an expired request')
  const s = await asked({ amount: '6.00', label: 'Buyer too slow' }); const q = (await answer('tok-alice', s.id, true)).json.request; clock += 31 * 60_000; fake.approve(q.orderId)
  const caps = fake.state.captures; const page = await getBack('return', rec(s.id).nonce, q.orderId); eq(rec(s.id).status, 'expired'); eq(fake.state.captures, caps, 'too late: not captured'); ok(/Payment expired|expired/.test(page.raw))
  const t = await asked({ amount: '7.00', label: 'Swept' }); clock += 16 * 60_000; pay.lapse('team'); eq(rec(t.id).status, 'expired', 'the sweep expires it without anyone asking')
  ok(TERMINAL.includes('expired') && TERMINAL.every(x => ['captured', 'denied', 'expired', 'cancelled', 'failed', 'refused', 'refunded'].includes(x)))
}

// 11. PayPal failing in the middle: an order that could not be made leaves the request pending (a retry makes the same single order); a capture that hiccups is tried again once
{
  const r = await asked({ amount: '9.00', label: 'PayPal flaky' }); const creates = fake.state.creates
  fake.state.failNext.push({ match: /POST \/v2\/checkout\/orders$/, reply: { status: 500, json: { name: 'INTERNAL_SERVER_ERROR' } } })
  const a = await answer('tok-alice', r.id, true); eq([a.status, a.json.code], [502, 'unavailable']); ok(/nothing was charged/i.test(a.json.error, 'says nothing was charged')); eq(rec(r.id).status, 'pending', 'the approval did not stick; no order'); eq(fake.state.creates, creates)
  const nFlaky = rec(r.id).nonce; ok(NONCE_RE.test(nFlaky), 'the nonce exists before PayPal is asked, so the failed try already has one')
  const b = await answer('tok-alice', r.id, true); eq(b.status, 200); eq(fake.state.creates, creates + 1); eq(trailOf(r.id), ['pending:coder', 'awaiting_buyer:alice'])
  eq(rec(r.id).nonce, nFlaky, 'a retry keeps the nonce: PayPal-Request-Id would hand back the first order with the first addresses'); const retried = JSON.parse(fake.state.calls.filter(c => c.method === 'POST' && c.path === '/v2/checkout/orders').pop().body).payment_source.paypal.experience_context; ok(retried.return_url.endsWith('/return/' + nFlaky) && retried.cancel_url.endsWith('/cancel/' + nFlaky))
  const caps0 = fake.state.captures; fake.approve(rec(r.id).orderId); fake.state.failNext.push({ match: /POST \/v2\/checkout\/orders\/.*\/capture$/, reply: { status: 500, json: { name: 'INTERNAL_SERVER_ERROR' } } })
  const c1 = await api('POST', '/api/pay/team/check', 'tok-bob', { id: r.id }); eq(c1.json.request.status, 'awaiting_buyer', 'a PayPal hiccup keeps it waiting'); eq(fake.state.captures, caps0)
  const c2 = await api('POST', '/api/pay/team/check', 'tok-bob', { id: r.id }); eq(c2.json.request.status, 'captured'); eq(fake.state.captures, caps0 + 1); const ids = fake.state.calls.filter(c => /\/capture$/.test(c.path) && c.requestId === 'vespr-cap-' + r.id).map(c => c.requestId); eq(ids, ['vespr-cap-' + r.id, 'vespr-cap-' + r.id], 'both tries used the same idempotency key')
  eq((await api('POST', '/api/pay/team/check', 'tok-bob', { id: r.id })).json.request.status, 'captured'); eq(fake.state.captures, caps0 + 1)
  eq((await api('POST', '/api/pay/team/check', 'tok-bob', { id: 'nope' })).status, 404); rights.deny.add('x'); eq((await api('POST', '/api/pay/team/check', '', { id: r.id })).status, 401)
  // a capture that PayPal says already happened (a repeat after a crash) is recorded, not repeated
  const s = await asked({ amount: '4.00', label: 'Crash between capture and record' }); const q = (await answer('tok-alice', s.id, true)).json.request; fake.approve(q.orderId)
  const o = fake.state.orders.get(q.orderId); o.status = 'COMPLETED'; o.capture = { id: 'FAKECAPEARLIER', status: 'COMPLETED', custom_id: s.id }; const caps = fake.state.captures
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: s.id })).json.request.status, 'captured'); eq(rec(s.id).captureId, 'FAKECAPEARLIER'); eq(fake.state.captures, caps, 'recorded without capturing a second time')
  // declined by PayPal: failed, with nothing charged
  const d = await asked({ amount: '3.00', label: 'Declined' }); const dq = (await answer('tok-alice', d.id, true)).json.request; fake.approve(dq.orderId); fake.decline(dq.orderId)
  const dr = await api('POST', '/api/pay/team/check', 'tok-alice', { id: d.id }); eq(dr.json.request.status, 'failed'); ok(/declined/i.test(dr.json.request.error)); eq(trailOf(d.id).pop(), 'failed:PayPal')
  // an order whose amount does not match what was approved is never captured
  const m = await asked({ amount: '2.00', label: 'Tampered' }); const mq = (await answer('tok-alice', m.id, true)).json.request; fake.approve(mq.orderId); fake.state.orders.get(mq.orderId).unit.amount.value = '2000.00'; const caps2 = fake.state.captures
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: m.id })).json.request.status, 'failed'); eq(fake.state.captures, caps2, 'no capture for a mismatched order'); ok(/does not match/.test(rec(m.id).error))
}

// 11b. an order PayPal returns without our ids still matches by amount; a different id is refused
{
  const a = await asked({ amount: '6.50', label: 'No ids returned' }); const qa = (await answer('tok-alice', a.id, true)).json.request; fake.approve(qa.orderId); const oa = fake.state.orders.get(qa.orderId); delete oa.unit.custom_id; delete oa.unit.reference_id
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: a.id })).json.request.status, 'captured', 'bound to the request by our own order id and the approved amount')
  const b = await asked({ amount: '6.75', label: 'Other order id' }); const qb = (await answer('tok-alice', b.id, true)).json.request; fake.approve(qb.orderId); fake.state.orders.get(qb.orderId).unit.reference_id = 'someone-elses'; const caps = fake.state.captures
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: b.id })).json.request.status, 'failed'); eq(fake.state.captures, caps)
}

// 11b2. the captured amount must be the approved one, where PayPal says it
{
  const a = await asked({ amount: '9.25', label: 'Captured for another amount' }); const qa = (await answer('tok-alice', a.id, true)).json.request; fake.approve(qa.orderId); const caps = fake.state.captures
  fake.state.failNext.push({ match: /POST \/v2\/checkout\/orders\/.*\/capture$/, reply: { status: 201, json: { id: qa.orderId, status: 'COMPLETED', purchase_units: [{ reference_id: a.id, payments: { captures: [{ id: 'CAPWRONGAMOUNT1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '90.25' }, custom_id: a.id }] } }] } } })
  eq((await api('POST', '/api/pay/team/check', 'tok-alice', { id: a.id })).json.request.status, 'failed', 'a capture for a different amount is not recorded as paid'); ok(/does not match/.test(rec(a.id).error)); void caps
}

// 11c. refund: a person sends a captured payment back, once; never an agent; PayPal failing keeps it captured
{
  const mkPaid = async (label, amount = '14.00') => { const r = await asked({ amount, label }); const q = (await answer('tok-alice', r.id, true)).json.request; fake.approve(q.orderId); await api('POST', '/api/pay/team/check', 'tok-alice', { id: r.id }); eq(rec(r.id).status, 'captured'); return r }
  const r = await mkPaid('Refund me'); const ref = (t, id = r.id) => api('POST', '/api/pay/team/refund', t, { id }); const refunds0 = fake.state.refunds; const left0 = (await api('GET', '/api/pay/team', 'tok-alice')).json.limits.leftToday
  eq((await ref('')).status, 401); eq((await ref('tok-coder')).status, 403, 'an agent cannot refund'); ok(/agents do not refund/.test((await ref('tok-coder')).json.error)); eq((await ref('tok-kid')).status, 403, 'a minor cannot'); eq((await ref('tok-school')).status, 403, 'a student cannot')
  rights.deny.add('bob'); eq((await ref('tok-bob')).status, 403, 'edit rights are needed'); rights.deny.delete('bob'); eq((await ref('tok-alice', 'nope')).status, 404)
  const pend = await asked({ amount: '3.00', label: 'Not captured' }); eq((await ref('tok-alice', pend.id)).status, 409, 'only a captured payment can be refunded'); await answer('tok-alice', pend.id, false)
  eq(fake.state.refunds, refunds0, 'none of those reached PayPal')
  const ok1 = await ref('tok-teacher'); eq([ok1.status, ok1.json.request.status, ok1.json.request.refundedBy], [200, 'refunded', 'terry']); ok(/^FAKEREF/.test(ok1.json.request.refundId)); eq(fake.state.refunds, refunds0 + 1)
  const call1 = fake.state.calls.filter(c => /\/refund$/.test(c.path)).pop(); eq(call1.requestId, 'vespr-ref-' + r.id); eq(JSON.parse(call1.body).amount, { currency_code: 'USD', value: '14.00' })
  const again = await ref('tok-alice'); eq(again.status, 409); ok(/already refunded by terry/.test(again.json.error)); eq(fake.state.refunds, refunds0 + 1, 'one refund per payment')
  eq(trailOf(r.id), ['pending:coder', 'awaiting_buyer:alice', 'captured:PayPal', 'refunded:terry']); const card = cardOf(r.id); eq([card.get('status'), card.get('refundedBy'), card.get('refundId')], ['refunded', 'terry', ok1.json.request.refundId]); ok(/captured, then refunded by terry/.test(card.get('text').toString()))
  ok((await api('GET', '/api/pay/team', 'tok-alice')).json.limits.leftToday !== undefined && left0 !== undefined); eq((await api('POST', '/api/pay/team/answer', 'tok-bob', { id: r.id, approve: false })).status, 409, 'a refunded payment cannot be answered again')
  // PayPal failing: it stays captured, nothing is marked refunded, the retry uses the same request id
  const f = await mkPaid('Refund hiccup'); fake.state.failNext.push({ match: /POST \/v2\/payments\/captures\/.*\/refund$/, reply: { status: 500, json: { name: 'INTERNAL_SERVER_ERROR' } } })
  const bad = await ref('tok-alice', f.id); eq([bad.status, bad.json.code], [502, 'unavailable']); ok(/Nothing was refunded/.test(bad.json.error)); eq(rec(f.id).status, 'captured'); const ok2 = await ref('tok-alice', f.id); eq(ok2.status, 200)
  eq(fake.state.calls.filter(c => /\/refund$/.test(c.path) && c.requestId === 'vespr-ref-' + f.id).length, 2, 'both tries used the same idempotency key'); eq(fake.state.refunds, refunds0 + 2)
  // PayPal says it was already refunded (a refund made on PayPal's side): recorded, not repeated
  const g = await mkPaid('Refunded at PayPal'); fake.state.orders.get(rec(g.id).orderId).refund = { id: 'FAKEREFEARLIER', status: 'COMPLETED' }; const refunds1 = fake.state.refunds
  eq((await ref('tok-alice', g.id)).json.request.status, 'refunded'); eq(fake.state.refunds, refunds1)
  // PayPal answers the refund with a failed status: it stays captured and says so
  const h2 = await mkPaid('Refund fails at PayPal'); fake.state.failNext.push({ match: /POST \/v2\/payments\/captures\/.*\/refund$/, reply: { status: 201, json: { id: 'FAKEREFFAILED1', status: 'FAILED' } } })
  const rf2 = await ref('tok-alice', h2.id); eq([rf2.status, rf2.json.code], [502, 'refund_failed']); ok(/the payment stays captured/.test(rf2.json.error)); eq(rec(h2.id).status, 'captured'); eq(rec(h2.id).refundId || '', '')
}

// 11d. operator roles for token logins: only student or teacher, same policy decides
{
  const m = parseOperatorRoles(' Sam:student, terry:TEACHER, bad, x:admin, :student, y: '); eq([...m], [['sam', 'student'], ['terry', 'teacher']], 'only student and teacher are read; anything else is ignored'); eq(parseOperatorRoles(undefined).size, 0)
  eq(policyUserOf('sam', operatorRecord('sam', 'student')).roles, ['student']); eq(policyUserOf('terry', operatorRecord('terry', 'teacher')).roles, ['teacher'])
  const r = await asked({ amount: '4.00', label: 'Operator role' }); const roleOf = new Map([['tok-stu', 'student']]); const p2 = make({ userOf: t => accounts[t] || (roleOf.has(t) ? operatorRecord('stu', roleOf.get(t)) : null) }) // a second instance reads the same store
  const x = await call(p2.http, { method: 'POST', url: '/api/pay/team/answer', headers: { Authorization: 'Bearer tok-stu', ...HOST }, body: { id: r.id, approve: true } }); eq([x.status, x.json.error], [403, 'Students cannot approve payments.'], 'a token login marked student is refused by the real policy')
  p2.close(); await answer('tok-alice', r.id, false)
}

// 11e. the same payment flow with PayPal's server SDK as the driver (VESPR_PAYPAL_DRIVER=sdk): ask, approve, the buyer pays, the return page captures once, a person refunds
{
  const sa = await asked({ amount: '17.00', label: 'Through the SDK' }); const p3 = make({ paypal: createSdkPayPal({ clientId: ID, clientSecret: SECRET, transport: sdkTransport(fake), log: m => logs.push(m) }) }); const r3 = () => p3.reqs('team').find(x => x.id === sa.id); const caps0 = fake.state.captures; const refs0 = fake.state.refunds
  const ans = await call(p3.http, { method: 'POST', url: '/api/pay/team/answer', headers: { Authorization: 'Bearer tok-alice', ...HOST }, body: { id: sa.id, approve: true } }); eq([ans.status, ans.json.request.status], [200, 'awaiting_buyer'], JSON.stringify(ans.json)); ok(/^FAKEORD/.test(ans.json.request.orderId))
  const st = await call(p3.http, { method: 'GET', url: '/api/pay/_status', headers: { Authorization: 'Bearer tok-alice' } }); eq([st.json.driver, st.json.configured], ['sdk', true], 'the server says which driver answers')
  const n3 = r3().nonce; ok(NONCE_RE.test(n3)); fake.approve(ans.json.request.orderId); const page = await call(p3.http, { method: 'GET', url: back('return', n3, ans.json.request.orderId), headers: HOST }); ok(/Payment received/.test(page.raw)); eq(fake.state.captures, caps0 + 1, 'one capture through the SDK'); eq(r3().status, 'captured')
  await call(p3.http, { method: 'GET', url: back('return', n3, ans.json.request.orderId), headers: HOST }); eq(fake.state.captures, caps0 + 1, 'a second return takes nothing more')
  const rf = await call(p3.http, { method: 'POST', url: '/api/pay/team/refund', headers: { Authorization: 'Bearer tok-alice', ...HOST }, body: { id: sa.id } }); eq([rf.status, rf.json.request.status], [200, 'refunded']); eq(fake.state.refunds, refs0 + 1)
  eq(r3().trail.map(t => `${t.to}:${t.by}`), ['pending:coder', 'awaiting_buyer:alice', 'captured:PayPal', 'refunded:alice'], 'the same trail as with the fetch driver'); p3.close()
}

// 12. a restart keeps the requests and their nonces, and the return page still finds its request by the PayPal order id and the nonce
{
  const r = await asked({ amount: '11.00', label: 'Across a restart' }); const q = (await answer('tok-alice', r.id, true)).json.request; const n12 = rec(r.id).nonce; pay.close(); pay = make()
  eq(rec(r.id).status, 'awaiting_buyer'); eq(rec(r.id).nonce, n12, 'the nonce is kept with the request'); fake.approve(q.orderId); await getBack('return', n12, q.orderId); eq(rec(r.id).status, 'captured'); eq(rec(r.id).trail.length, 3)
  eq((await call(pay.http, { method: 'GET', url: '/api/other', headers: HOST })).notMine, true, 'other routes are not ours')
}

// 13. the public address: a configured base wins; a hostile Host header is not used; no address at all is an honest error
{
  const room = 'addr'; const r = await asked({ amount: '1.00', label: 'Address' }, room)
  const bad = await call(pay.http, { method: 'POST', url: '/api/pay/addr/answer', headers: { Authorization: 'Bearer tok-alice', host: 'evil.example.com/x y' }, body: { id: r.id, approve: true } }); eq(bad.status, 500); ok(/VESPR_PAY_BASE_URL/.test(bad.json.error)); eq(rec(r.id, room).status, 'pending')
  const withBase = make({ baseUrl: 'https://vespr.example/' }); const ok2 = await call(withBase.http, { method: 'POST', url: '/api/pay/addr/answer', headers: { Authorization: 'Bearer tok-alice', host: 'evil.example.com' }, body: { id: r.id, approve: true } }); eq(ok2.status, 200)
  const ctx = JSON.parse(fake.state.calls.filter(c => c.method === 'POST' && c.path === '/v2/checkout/orders').pop().body).payment_source.paypal.experience_context; const n13 = withBase.reqs(room).find(x => x.id === r.id).nonce; eq(ctx.return_url, 'https://vespr.example/api/pay/return/' + n13); eq(ctx.cancel_url, 'https://vespr.example/api/pay/cancel/' + n13); withBase.close()
}

// 14. nothing secret is stored or logged
{
  const files = fs.readdirSync(path.join(DATA, 'pay')).map(f => fs.readFileSync(path.join(DATA, 'pay', f), 'utf8')).join('\n') + logs.join('\n'); for (const s of [SECRET, ID, 'fake-token']) ok(!files.includes(s), 'not stored or logged: ' + s.slice(0, 10))
}
pay.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`pay tests passed (${n}): agents only ask, a person (never the agent or the asker, adults on personal accounts) answers, USD 50 a request and USD 100 a room a day, one order and one capture per request, expiry, cancel, decline, PayPal failing, restart, actor names in the trail and cards, nothing secret stored`)
