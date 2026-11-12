// Billing: test mode only; Checkout pages carry who is paying from the server, not the browser; only a correctly signed, fresh
// Stripe event adds credit, once; refunds take it back; the billing email and name are kept for their owner; the key never leaks.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import crypto from 'node:crypto'
import { createBilling, verifyStripeSignature, PACKS } from '../billing.js'

const SK = 'sk_test_' + 'x'.repeat(24); const WH = 'whsec_' + 'y'.repeat(24) // throwaway test values, not real keys
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-'))
const tokens = new Map([['tok-a', 'alice'], ['tok-b', 'bob'], ['tok-agent', 'coder'], ['tok-c', 'charlie']])
let clock = 1_800_000_000_000; const logs = []; let spent = { alice: 0, bob: 0 }
const stripeCalls = []; let stripeFails = false; let keyRefused = false; const sessions = {}
const fakeStripe = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => {
  stripeCalls.push({ path: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], body: new URLSearchParams(b) })
  res.setHeader('Content-Type', 'application/json')
  if (keyRefused) { res.statusCode = 401; return res.end(JSON.stringify({ error: { type: 'invalid_request_error' } })) }
  if (req.method === 'GET' && req.url.startsWith('/v1/checkout/sessions/')) { const s = sessions[decodeURIComponent(req.url.split('/').pop())]; res.statusCode = s ? 200 : 404; return res.end(JSON.stringify(s || { error: { type: 'invalid_request_error' } })) }
  if (stripeFails) { res.statusCode = 402; return res.end(JSON.stringify({ error: { type: 'card_error', message: 'secret details ' + SK } })) }
  res.end(JSON.stringify({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' }))
}) })
await new Promise(r => fakeStripe.listen(0, '127.0.0.1', r))
const make = () => createBilling({ DATA, identify: t => tokens.get(t), isAgent: t => t === 'tok-agent', payersFor: (p, r) => r === 'shared' ? [p, 'cara'] : [p], spentMicros: p => spent[p] || 0, secretKey: SK, webhookSecret: WH, baseUrl: 'https://vespr.example', apiBase: `http://127.0.0.1:${fakeStripe.address().port}`, now: () => clock, log: m => logs.push(m) })
let billing = make()
const app = http.createServer((req, res) => { if (!billing.http(req, res)) { res.writeHead(404); res.end() } })
await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`
const call = async (method, p, { token, body, headers = {} } = {}) => { const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body }); return { status: r.status, j: await r.json().catch(() => ({})) } }
const sign = (payload, t = Math.floor(clock / 1000), secret = WH) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`
const webhook = (ev, sig) => { const payload = JSON.stringify(ev); return call('POST', '/api/billing/webhook', { body: payload, headers: { 'Stripe-Signature': sig || sign(payload), 'Content-Type': 'application/json' } }) }
const paid = (id, person, cents, extra = {}) => ({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_' + id, mode: 'payment', payment_status: 'paid', amount_total: cents, payment_intent: 'pi_' + id, customer: 'cus_alice', metadata: { person, pack: 'credit-20' }, customer_details: { email: 'maya@example.test', name: 'Maya Example' }, ...extra } } })

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

await t('test mode only, and all settings required', () => {
  assert.throws(() => createBilling({ DATA, identify: () => null, secretKey: 'sk_live_abc', webhookSecret: WH, baseUrl: 'https://x' }), /test mode only/)
  assert.throws(() => createBilling({ DATA, identify: () => null, secretKey: SK, webhookSecret: '', baseUrl: 'https://x' }), /needs STRIPE_SECRET_KEY/)
  assert.doesNotThrow(() => createBilling({ DATA, identify: () => null, secretKey: 'sk_live_abc', webhookSecret: WH, baseUrl: 'https://x', allowLive: true }))
})

await t('the signature check follows Stripe: right secret, fresh, any of several v1 values', () => {
  const p = '{"id":"evt_1"}'
  assert.strictEqual(verifyStripeSignature(p, sign(p), WH, { now: clock }), true)
  assert.strictEqual(verifyStripeSignature(p, sign(p, undefined, 'whsec_other'), WH, { now: clock }), false)
  assert.strictEqual(verifyStripeSignature(p, sign(p, Math.floor(clock / 1000) - 301), WH, { now: clock }), false, 'older than 5 minutes')
  assert.strictEqual(verifyStripeSignature(p + ' ', sign(p), WH, { now: clock }), false, 'a changed body fails')
  assert.strictEqual(verifyStripeSignature(p, `t=${Math.floor(clock / 1000)},v1=deadbeef,${sign(p).split(',')[1]}`, WH, { now: clock }), true, 'a rolled secret sends two v1 values')
})

await t('checkout: signed-in only, known packs only, and who pays comes from the server', async () => {
  assert.strictEqual((await call('POST', '/api/billing/checkout', { body: '{"pack":"credit-20"}' })).status, 401)
  assert.strictEqual((await call('POST', '/api/billing/checkout', { token: 'tok-a', body: '{"pack":"credit-7"}' })).status, 400)
  const r = await call('POST', '/api/billing/checkout', { token: 'tok-a', body: JSON.stringify({ pack: 'credit-20', person: 'bob' }) })
  assert.deepStrictEqual(r, { status: 200, j: { url: 'https://checkout.stripe.com/c/pay/cs_test_123', id: 'cs_test_123' } })
  const c = stripeCalls.at(-1)
  assert.strictEqual(c.path, '/v1/checkout/sessions'); assert.strictEqual(c.auth, 'Bearer ' + SK); assert.ok(c.idem.startsWith('checkout-alice-credit-20-'))
  assert.strictEqual(c.body.get('client_reference_id'), 'alice', 'a person named in the request body is ignored')
  assert.strictEqual(c.body.get('metadata[person]'), 'alice'); assert.strictEqual(c.body.get('line_items[0][price_data][unit_amount]'), String(PACKS['credit-20']))
  assert.strictEqual(c.body.get('billing_address_collection'), 'required', 'so Stripe returns the billing name')
  assert.match(c.body.get('success_url'), /^https:\/\/vespr\.example\/account\.html\?billing=done/, 'return links come from the configured base URL, not the Host header')
})

await t('a Stripe error is a plain message; the key never reaches the browser or the logs', async () => {
  stripeFails = true; const r = await call('POST', '/api/billing/checkout', { token: 'tok-a', body: '{"pack":"credit-10"}' }); stripeFails = false
  assert.strictEqual(r.status, 502); assert.match(r.j.error, /nothing was charged/)
  assert.ok(!JSON.stringify(r.j).includes(SK) && !logs.join(' ').includes(SK), 'no key in the reply or the logs'); assert.match(logs.at(-1), /HTTP 402.*card_error/)
})

await t('only a signed, fresh event adds credit, and only once', async () => {
  assert.strictEqual((await webhook(paid('e1', 'alice', 2000), 't=1,v1=00')).status, 400)
  assert.strictEqual((await webhook(paid('e1', 'alice', 2000), sign(JSON.stringify(paid('e1', 'alice', 2000)), undefined, 'whsec_guess'))).status, 400)
  assert.strictEqual(billing.balance('alice').credit_usd, 0)
  assert.strictEqual((await webhook(paid('e1', 'alice', 2000))).j.did, 'credited')
  assert.strictEqual((await webhook(paid('e1', 'alice', 2000))).j.duplicate, true, 'the same event again')
  assert.strictEqual((await webhook({ ...paid('e1', 'alice', 2000), id: 'e1-resent' })).j.did, 'ignored', 'a new event for the same checkout')
  assert.strictEqual((await webhook(paid('e2', 'alice', 1000, { payment_status: 'unpaid' }))).j.did, 'ignored', 'not paid yet')
  assert.strictEqual(billing.balance('alice').credit_usd, 20)
})

await t('your billing page: balance after usage, your billing email and name, nobody else\'s', async () => {
  spent.alice = 2_691 // micro-dollars: the real-model check's usage at 1.30x
  const me = await call('GET', '/api/billing/me', { token: 'tok-a' })
  assert.deepStrictEqual([me.j.mode, me.j.credit_usd, me.j.spent_usd, me.j.balance_usd], ['test', 20, 0.002691, 19.997309])
  assert.deepStrictEqual(me.j.billing, { email: 'maya@example.test', name: 'Maya Example' })
  const bob = await call('GET', '/api/billing/me', { token: 'tok-b' })
  assert.deepStrictEqual([bob.j.credit_usd, bob.j.billing], [0, { email: '', name: '' }])
  assert.strictEqual((await call('GET', '/api/billing/me')).status, 401)
})

await t('a refund takes the credit back (partial, then the rest), once', async () => {
  const refund = (id, cents) => ({ id, type: 'charge.refunded', data: { object: { payment_intent: 'pi_e1', amount_refunded: cents } } })
  assert.strictEqual((await webhook(refund('r1', 500))).j.did, 'refunded'); assert.strictEqual(billing.balance('alice').credit_usd, 15)
  assert.strictEqual((await webhook(refund('r1', 500))).j.duplicate, true)
  assert.strictEqual((await webhook(refund('r2', 2000))).j.did, 'refunded'); assert.strictEqual(billing.balance('alice').credit_usd, 0, 'cumulative amount_refunded, not added twice')
})

await t("Silent Consensus's confirm-on-return: Stripe is asked; only the caller's own paid test-mode session credits, once", async () => {
  const sess = (id, over = {}) => ({ id, mode: 'payment', livemode: false, payment_status: 'paid', amount_total: 1000, payment_intent: 'pi_' + id, client_reference_id: 'bob', metadata: { person: 'bob', pack: 'credit-10' }, customer_details: { email: 'bob@example.test', name: 'Bob Example' }, ...over })
  sessions.cs_bob1 = sess('cs_bob1'); sessions.cs_unpaid = sess('cs_unpaid', { payment_status: 'unpaid' }); sessions.cs_live = sess('cs_live', { livemode: true })
  const confirm = (token, session) => call('POST', '/api/billing/confirm', { token, body: JSON.stringify({ session }) })
  assert.strictEqual((await confirm(null, 'cs_bob1')).status, 401)
  assert.strictEqual((await confirm('tok-a', 'cs_bob1')).status, 403, "alice cannot claim bob's payment")
  assert.strictEqual((await confirm('tok-b', 'cs_unpaid')).status, 409)
  assert.strictEqual((await confirm('tok-b', 'cs_live')).status, 409, 'a live-mode session never credits in test mode')
  assert.strictEqual((await confirm('tok-b', 'not-a-session')).status, 400)
  const ok = await confirm('tok-b', 'cs_bob1'); assert.deepStrictEqual([ok.status, ok.j.credited, ok.j.credit_usd], [200, true, 10])
  assert.strictEqual((await confirm('tok-b', 'cs_bob1')).j.credited, false, 'coming back twice credits once')
  const ev = { id: 'e-bob', type: 'checkout.session.completed', data: { object: sessions.cs_bob1 } }
  assert.strictEqual((await webhook(ev)).j.did, 'ignored', 'and the webhook for the same checkout adds nothing more')
  assert.strictEqual(billing.balance('bob').credit_usd, 10); assert.strictEqual(billing.profileOf('bob').name, 'Bob Example')
})

await t("a refused key gets Silent Consensus's plain message, never the raw error", async () => {
  keyRefused = true
  const c = await call('POST', '/api/billing/checkout', { token: 'tok-a', body: '{"pack":"credit-10"}' })
  const f = await call('POST', '/api/billing/confirm', { token: 'tok-b', body: '{"session":"cs_bob1"}' })
  keyRefused = false
  for (const r of [c, f]) { assert.strictEqual(r.status, 503); assert.strictEqual(r.j.error, "Payments aren't set up right now (the Stripe test key isn't valid).") }
})

await t('the paywall check is for agents only, and says whether a person can still spend', async () => {
  assert.strictEqual((await call('GET', '/api/billing/allowance?person=bob', { token: 'tok-a' })).status, 403, 'a person cannot look up others')
  const bob = await call('GET', '/api/billing/allowance?person=bob', { token: 'tok-agent' })
  assert.deepStrictEqual([bob.status, bob.j.ok, bob.j.balance_usd], [200, true, 10])
  spent.bob = 10_000_000
  assert.strictEqual((await call('GET', '/api/billing/allowance?person=bob', { token: 'tok-agent' })).j.ok, false, 'used up')
  assert.strictEqual((await call('GET', '/api/billing/allowance?person=nobody', { token: 'tok-agent' })).j.ok, false, 'no credit at all')
  spent.bob = 0 // in a shared chat everyone who pays needs credit (cost-sharing.js decides who)
  const shared = (await call('GET', '/api/billing/allowance?person=bob&room=shared', { token: 'tok-agent' })).j
  assert.deepStrictEqual([shared.ok, shared.payers, shared.short], [false, ['bob', 'cara'], ['cara']])
  assert.strictEqual((await call('GET', '/api/billing/allowance?person=bob&room=solo', { token: 'tok-agent' })).j.ok, true)
})

await t('a 7-day free trial activates once per account and expires after 7 days', async () => {
  // unauthenticated fails
  assert.strictEqual((await call('POST', '/api/billing/trial')).status, 401)
  
  // charlie activates trial
  const res = await call('POST', '/api/billing/trial', { token: 'tok-c' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.j.trial, true)
  assert.strictEqual(res.j.credit_usd, 5.0)
  assert.strictEqual(billing.balance('charlie').credit_usd, 5.0)

  // activating twice is refused
  const dup = await call('POST', '/api/billing/trial', { token: 'tok-c' })
  assert.strictEqual(dup.status, 409)
  assert.strictEqual(dup.j.used, true)

  // billing/me shows trial active
  const me = await call('GET', '/api/billing/me', { token: 'tok-c' })
  assert.strictEqual(me.status, 200)
  assert.strictEqual(me.j.trial.used, true)
  assert.strictEqual(me.j.trial.daysLeft, 7)

  // advance clock beyond 7 days (8 days)
  clock += 8 * 86_400_000
  assert.strictEqual(billing.balance('charlie').credit_usd, 0, 'expired trial credit no longer counts')
  clock -= 8 * 86_400_000 // restore clock
})

await t('everything survives a restart, and the files are private', async () => {
  billing = make()
  assert.strictEqual(billing.balance('alice').credit_usd, 0); assert.strictEqual(billing.profileOf('alice').name, 'Maya Example')
  assert.strictEqual((await webhook(paid('e1', 'alice', 2000))).j.duplicate, true, 'a replayed event after restart still counts once')
  for (const f of fs.readdirSync(path.join(DATA, 'billing'))) assert.strictEqual(fs.statSync(path.join(DATA, 'billing', f)).mode & 0o077, 0, f)
})

app.close(); fakeStripe.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`billing tests passed (${n}): test mode only, Stripe signature rules, checkout from the server, no key leaks, signed events credit once, own billing page, refunds, confirm on return, plain key message, paywall check, restart`)
