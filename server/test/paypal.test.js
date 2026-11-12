// PayPal client (server/paypal.js) against a faked fetch: sandbox only, OAuth token cached and refreshed, the exact Orders v2 requests, error mapping,
// amounts checked to the cent, and the credentials never in a log, an error or a result. No network.
import assert from 'node:assert'
import { createPayPal, parseAmount, centsToValue, money, SANDBOX_BASE, LIVE_BASE, NOT_SET_UP, PayPalError } from '../paypal.js'

const ID = 'test-client-id-' + 'a'.repeat(20); const SECRET = 'test-secret-' + 'b'.repeat(20) // throwaway values, not real credentials
const BASIC = Buffer.from(`${ID}:${SECRET}`).toString('base64')
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const rej = async (p, code, m) => { try { await p } catch (e) { eq(e instanceof PayPalError ? e.code : e.message, code, m); return e } assert.fail('should have failed: ' + m) }

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
let clock = 1_800_000_000_000; const logs = []; let calls = []; let tokenN = 0
let script = [] // queued replies for API calls: functions (url, init) -> Response, or a Response
const fakeFetch = async (url, init = {}) => {
  const rec = { url, method: init.method || 'GET', headers: Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: init.body }
  calls.push(rec)
  if (url.endsWith('/v1/oauth2/token')) { tokenN++; if (rec.headers.authorization !== 'Basic ' + BASIC) return reply(401, { error: 'invalid_client' }); return reply(200, { access_token: 'tok-' + tokenN, token_type: 'Bearer', expires_in: 32400, app_id: 'APP' }) }
  const next = script.shift(); assert.ok(next, 'unexpected call ' + rec.method + ' ' + url)
  return typeof next === 'function' ? next(rec) : next
}
const mk = (o = {}) => createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: fakeFetch, now: () => clock, log: m => logs.push(m), ...o })
const reset = () => { calls = []; script = []; tokenN = 0; logs.length = 0 }
const apiCalls = () => calls.filter(c => !c.url.endsWith('/v1/oauth2/token'))
const CREATED = { id: 'ORDER1234567890AB', status: 'PAYER_ACTION_REQUIRED', links: [{ href: SANDBOX_BASE + '/v2/checkout/orders/ORDER1234567890AB', rel: 'self', method: 'GET' }, { href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1234567890AB', rel: 'payer-action', method: 'GET' }] }
const ORDER = { cents: 2500, currency: 'USD', description: 'Logo design invoice', requestId: 'vespr-pay-0123456789abcdef', returnUrl: 'https://vespr.example/api/pay/return', cancelUrl: 'https://vespr.example/api/pay/cancel' }

// 1. amounts: integer cents, a decimal string only at the edge
for (const [i, c] of [['25', 2500], ['25.00', 2500], ['25.5', 2550], ['0.01', 1], [' 7.05 ', 705], [25, 2500], [25.5, 2550], [0.1, 10], ['999999.99', 99999999]]) { const a = parseAmount(i); ok(a.ok && a.cents === c, `parse ${i}`); eq(a.value, centsToValue(c)) }
eq(parseAmount(19.99).value, '19.99'); eq(parseAmount(1.005).ok, false, 'a float with a third decimal is refused, not rounded')
for (const bad of ['', '0', '0.00', '-5', '+5', '5.', '.5', '1e3', '25.001', '25,00', '$25', '25 USD', '1000000', NaN, Infinity, -1, 0, null, undefined, {}, [], '007', '٢٥', '25\n26']) ok(!parseAmount(bad).ok, 'refused: ' + String(bad))
eq(money(2500), '$25.00'); eq(money(5, 'EUR'), 'EUR 0.05')

// 2. sandbox only
eq(createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: fakeFetch }).mode, 'sandbox'); eq(createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: fakeFetch }).baseUrl, SANDBOX_BASE)
assert.throws(() => createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: LIVE_BASE, fetchImpl: fakeFetch }), /sandbox only/); n++
assert.throws(() => createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'https://evil.example.com', fetchImpl: fakeFetch }), /sandbox only/); n++
assert.throws(() => createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'https://evil.example.com', allowLive: true, fetchImpl: fakeFetch }), /sandbox only/); n++ // the live flag allows the live host only
assert.throws(() => createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'http://127.0.0.1:9', fetchImpl: fakeFetch }), /sandbox only/); n++ // loopback needs its own flag
eq(createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: LIVE_BASE, allowLive: true, fetchImpl: fakeFetch }).mode, 'live')
eq(createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'http://127.0.0.1:9', allowLoopback: true, fetchImpl: fakeFetch }).mode, 'test')
assert.throws(() => createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'http://example.com:9', allowLoopback: true, fetchImpl: fakeFetch }), /sandbox only/); n++

// 3. not set up: every call says so and nothing goes out
{
  reset(); const p = createPayPal({ clientId: '', clientSecret: '', fetchImpl: fakeFetch, log: m => logs.push(m) }); eq(p.configured, false)
  const e = await rej(p.createOrder(ORDER), 'not_set_up'); eq(e.message, NOT_SET_UP); await rej(p.getOrder('ORDER1234567890AB'), 'not_set_up'); await rej(p.captureOrder('ORDER1234567890AB'), 'not_set_up'); eq(calls.length, 0, 'no request without credentials')
  eq(createPayPal({ clientId: ID, clientSecret: '', fetchImpl: fakeFetch }).configured, false, 'half a pair is not set up')
}

// 4. OAuth: Basic auth, form body, cached, refreshed a minute before it expires, one flight at a time, a 401 retries once
{
  reset(); const p = mk()
  script.push(reply(201, CREATED), reply(200, { id: 'ORDER1234567890AB', status: 'APPROVED', purchase_units: [] }))
  await p.createOrder(ORDER); await p.getOrder('ORDER1234567890AB')
  const t = calls.filter(c => c.url.endsWith('/v1/oauth2/token')); eq(t.length, 1, 'the token is reused')
  eq([t[0].method, t[0].headers['content-type'], t[0].body, t[0].headers.authorization], ['POST', 'application/x-www-form-urlencoded', 'grant_type=client_credentials', 'Basic ' + BASIC])
  eq(apiCalls().map(c => c.headers.authorization), ['Bearer tok-1', 'Bearer tok-1'])
  clock += 32400 * 1000 - 30_000; script.push(reply(200, { id: 'ORDER1234567890AB', status: 'CREATED', purchase_units: [] })); await p.getOrder('ORDER1234567890AB')
  eq(tokenN, 2, 'a token with less than a minute left is replaced'); eq(apiCalls().pop().headers.authorization, 'Bearer tok-2')
  reset(); const q = mk(); script.push(reply(200, { id: 'ORDER1234567890AB', status: 'CREATED', purchase_units: [] }), reply(200, { id: 'ORDER1234567890AB', status: 'CREATED', purchase_units: [] }), reply(200, { id: 'ORDER1234567890AB', status: 'CREATED', purchase_units: [] }))
  await Promise.all([q.getOrder('ORDER1234567890AB'), q.getOrder('ORDER1234567890AB'), q.getOrder('ORDER1234567890AB')]); eq(tokenN, 1, 'three calls at once ask for one token')
  reset(); const r = mk(); script.push(reply(401, { name: 'AUTHENTICATION_FAILURE' }), reply(200, { id: 'ORDER1234567890AB', status: 'CREATED', purchase_units: [] }))
  eq((await r.getOrder('ORDER1234567890AB')).status, 'CREATED'); eq(tokenN, 2, 'a 401 refreshes the token once and retries'); eq(apiCalls().length, 2)
  reset(); const s = mk(); script.push(reply(401, { name: 'AUTHENTICATION_FAILURE' }), reply(401, { name: 'AUTHENTICATION_FAILURE' }))
  await rej(s.getOrder('ORDER1234567890AB'), 'bad_credentials', 'a second 401 is a refusal, not a loop'); eq(apiCalls().length, 2)
  reset(); const w = createPayPal({ clientId: ID, clientSecret: 'wrong', fetchImpl: fakeFetch, log: m => logs.push(m) })
  const e = await rej(w.createOrder(ORDER), 'bad_credentials'); eq(e.message, 'PayPal refused the sandbox client id and secret.'); eq(apiCalls().length, 0)
}

// 5. createOrder: the exact request, the payer link, refusals before anything is sent
{
  reset(); const p = mk(); script.push(rec => { eq(rec.method, 'POST'); eq(rec.url, SANDBOX_BASE + '/v2/checkout/orders'); return reply(201, CREATED) })
  const o = await p.createOrder({ ...ORDER, description: 'Logo\u0000 design\ninvoice ' + 'x'.repeat(200), referenceId: 'ref-1', customId: 'cust-1' })
  eq(o, { id: 'ORDER1234567890AB', status: 'PAYER_ACTION_REQUIRED', approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1234567890AB' })
  const c = apiCalls()[0]; eq(c.headers['paypal-request-id'], ORDER.requestId, 'idempotency key'); eq(c.headers['content-type'], 'application/json'); eq(c.headers.authorization, 'Bearer tok-1')
  const body = JSON.parse(c.body); const pu = body.purchase_units[0]
  eq(body.intent, 'CAPTURE'); eq(body.purchase_units.length, 1); eq(pu.amount, { currency_code: 'USD', value: '25.00' }, 'the amount is a decimal string'); eq([pu.reference_id, pu.custom_id], ['ref-1', 'cust-1'])
  ok(pu.description.length === 127 && !/[\u0000\n]/.test(pu.description) && pu.description.startsWith('Logo design invoice x'), 'description cleaned and cut to 127')
  eq(body.payment_source.paypal.experience_context, { brand_name: 'VESPR', shipping_preference: 'NO_SHIPPING', landing_page: 'LOGIN', user_action: 'PAY_NOW', payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED', return_url: ORDER.returnUrl, cancel_url: ORDER.cancelUrl })
  reset(); const q = mk(); script.push(reply(200, { ...CREATED, links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1234567890AB', rel: 'approve' }] }))
  eq((await q.createOrder(ORDER)).approveUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER1234567890AB', 'the older "approve" link works too, and a replay (200) is fine')
  for (const [bad, why] of [[{ cents: 0 }, 'zero'], [{ cents: 12.5 }, 'fraction'], [{ cents: '2500' }, 'string cents'], [{ currency: 'usd' }, 'lower-case currency'], [{ currency: 'US' }, 'short currency'], [{ requestId: '' }, 'no request id'], [{ requestId: 'a b' }, 'bad request id'], [{ returnUrl: 'javascript:alert(1)' }, 'js url'], [{ cancelUrl: 'not a url' }, 'bad cancel']]) { reset(); await rej(mk().createOrder({ ...ORDER, ...bad }), 'bad_request', why); eq(calls.length, 0, 'nothing sent for ' + why) }
  reset(); const r = mk(); script.push(reply(201, { ...CREATED, links: [{ href: 'https://evil.example.com/pay?token=ORDER1234567890AB', rel: 'payer-action' }] }))
  const e = await rej(r.createOrder(ORDER), 'bad_response', 'a payer link that is not on paypal.com is never handed on'); ok(!/evil/.test(e.message))
  reset(); const t = mk(); script.push(reply(201, { id: 'ORDER1234567890AB', status: 'CREATED', links: [] })); await rej(t.createOrder(ORDER), 'bad_response', 'no payer link')
  reset(); const u = createPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: 'http://127.0.0.1:9', allowLoopback: true, fetchImpl: fakeFetch, log: m => logs.push(m) }); script.push(reply(201, { ...CREATED, links: [{ href: 'http://127.0.0.1:9/checkout?token=ORDER1234567890AB', rel: 'payer-action' }] }))
  eq((await u.createOrder(ORDER)).approveUrl, 'http://127.0.0.1:9/checkout?token=ORDER1234567890AB', 'the test fake may use a loopback link')
}

// 6. getOrder and captureOrder
{
  reset(); const p = mk()
  script.push(reply(200, { id: 'ORDER1234567890AB', status: 'APPROVED', purchase_units: [{ reference_id: 'r1', custom_id: 'c1', amount: { currency_code: 'USD', value: '25.00' } }] }))
  eq(await p.getOrder('ORDER1234567890AB'), { id: 'ORDER1234567890AB', status: 'APPROVED', value: '25.00', currency: 'USD', customId: 'c1', referenceId: 'r1', captureId: '', captureStatus: '' })
  eq([apiCalls()[0].method, apiCalls()[0].url, apiCalls()[0].body], ['GET', SANDBOX_BASE + '/v2/checkout/orders/ORDER1234567890AB', undefined])
  for (const bad of ['', 'a/b', '../x', 'ORDER 1', 'short', 'x'.repeat(70), null, undefined]) { await rej(p.getOrder(bad), 'bad_request', 'order id ' + bad); await rej(p.captureOrder(bad), 'bad_request') }
  reset(); const q = mk()
  script.push(reply(201, { id: 'ORDER1234567890AB', status: 'COMPLETED', payer: { email_address: 'buyer@example.com' }, purchase_units: [{ custom_id: 'c1', amount: { currency_code: 'USD', value: '25.00' }, payments: { captures: [{ id: 'CAPTURE123', status: 'COMPLETED', custom_id: 'c1', final_capture: true }] } }] }))
  const cap = await q.captureOrder('ORDER1234567890AB', { requestId: 'vespr-cap-0123456789abcdef' })
  eq(cap, { id: 'ORDER1234567890AB', status: 'COMPLETED', value: '25.00', currency: 'USD', customId: 'c1', referenceId: '', captureId: 'CAPTURE123', captureStatus: 'COMPLETED' }); ok(!JSON.stringify(cap).includes('buyer@example.com'), 'the payer email is not passed on')
  const c = apiCalls()[0]; eq([c.method, c.url, c.body, c.headers['paypal-request-id'], c.headers['content-type']], ['POST', SANDBOX_BASE + '/v2/checkout/orders/ORDER1234567890AB/capture', '{}', 'vespr-cap-0123456789abcdef', 'application/json'])
  // PayPal's error answers map to codes the payment flow can act on
  for (const [status, body, code] of [[422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }], debug_id: 'dbg1' }, 'order_not_approved'], [422, { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] }, 'already_captured'], [422, { details: [{ issue: 'INSTRUMENT_DECLINED' }] }, 'declined'], [422, { details: [{ issue: 'SOMETHING_NEW' }] }, 'rejected'], [400, { name: 'INVALID_REQUEST' }, 'rejected'], [404, { name: 'RESOURCE_NOT_FOUND' }, 'not_found'], [500, { name: 'INTERNAL_SERVER_ERROR' }, 'unavailable'], [503, {}, 'unavailable']]) { reset(); const r = mk(); script.push(reply(status, body)); await rej(r.captureOrder('ORDER1234567890AB'), code, `${status} -> ${code}`) }
  reset(); const r = createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: async (u, i) => { if (u.endsWith('/token')) return reply(200, { access_token: 't', expires_in: 100 }); throw new Error('socket hang up ' + SECRET) }, log: m => logs.push(m) })
  const e = await rej(r.getOrder('ORDER1234567890AB'), 'network'); eq(e.message, 'Could not reach PayPal.', 'a network error says so without the transport message')
}

// 6a. the REAL capture answer (read from the sandbox 2026-11-12): the unit has only reference_id and payments, the amount and custom_id are on the capture
{
  reset(); const p = mk(); script.push(reply(201, { id: 'ORDER1234567890AB', status: 'COMPLETED', payment_source: { paypal: {} }, purchase_units: [{ reference_id: 'r1', payments: { captures: [{ id: 'CAP359969585D', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' }, custom_id: 'c1', final_capture: true }] } }], payer: {}, links: [] }))
  eq(await p.captureOrder('ORDER1234567890AB'), { id: 'ORDER1234567890AB', status: 'COMPLETED', value: '1.00', currency: 'USD', customId: 'c1', referenceId: 'r1', captureId: 'CAP359969585D', captureStatus: 'COMPLETED' }, 'amount, currency and custom_id come from the capture when the unit has none')
}

// 6b. refund: the exact request, one status vocabulary, error mapping
{
  reset(); const p = mk(); script.push(rec => { eq([rec.method, rec.url], ['POST', SANDBOX_BASE + '/v2/payments/captures/CAPTURE123/refund']); return reply(201, { id: 'REFUND123456', status: 'COMPLETED', amount: { currency_code: 'USD', value: '25.00' } }) })
  eq(await p.refundCapture('CAPTURE123', { requestId: 'vespr-ref-0123456789abcdef', cents: 2500, currency: 'USD', note: 'VESPR sandbox\nrefund' }), { id: 'REFUND123456', status: 'COMPLETED' })
  const c = apiCalls()[0]; eq([c.headers['paypal-request-id'], c.headers['content-type']], ['vespr-ref-0123456789abcdef', 'application/json']); eq(JSON.parse(c.body), { amount: { currency_code: 'USD', value: '25.00' }, note_to_payer: 'VESPR sandbox refund' })
  for (const [status, body, code] of [[422, { details: [{ issue: 'CAPTURE_FULLY_REFUNDED' }] }, 'already_refunded'], [422, { details: [{ issue: 'REFUND_FAILED_INSUFFICIENT_FUNDS' }] }, 'rejected'], [404, { name: 'RESOURCE_NOT_FOUND' }, 'not_found'], [500, {}, 'unavailable']]) { reset(); const r = mk(); script.push(reply(status, body)); await rej(r.refundCapture('CAPTURE123', { cents: 100 }), code, `refund ${status} -> ${code}`) }
  for (const bad of [{ cents: 0 }, { cents: 1.5 }, { currency: 'usd' }]) { reset(); await rej(mk().refundCapture('CAPTURE123', { cents: 100, ...bad }), 'bad_request'); eq(calls.length, 0) }
  reset(); await rej(mk().refundCapture('a/b', { cents: 100 }), 'bad_request'); reset(); const q = mk(); script.push(reply(201, { id: 'REFUND123456', status: 'WEIRD' })); await rej(q.refundCapture('CAPTURE123', { cents: 100 }), 'bad_response')
}

// 7. the credentials, the token and the Basic header never appear in a log, an error or a result
{
  reset(); const p = mk(); const outputs = []
  script.push(reply(201, CREATED), reply(422, { details: [{ issue: 'ORDER_NOT_APPROVED', description: 'echo ' + SECRET }], debug_id: 'dbgX' }), reply(500, { name: 'X', message: SECRET }))
  outputs.push(JSON.stringify(await p.createOrder(ORDER))); for (const f of [() => p.captureOrder('ORDER1234567890AB'), () => p.getOrder('ORDER1234567890AB')]) { try { await f() } catch (e) { outputs.push(e.message, JSON.stringify(e), e.stack || '') } }
  const w = createPayPal({ clientId: ID, clientSecret: 'wrong-' + SECRET, fetchImpl: fakeFetch, log: m => logs.push(m) }); try { await w.getOrder('ORDER1234567890AB') } catch (e) { outputs.push(e.message, JSON.stringify(e)) }
  const all = [...logs, ...outputs].join('\n'); ok(logs.length >= 3, 'failures are logged briefly')
  for (const secret of [SECRET, ID, BASIC, 'tok-1', 'wrong-']) ok(!all.includes(secret), 'not in any log or error: ' + secret.slice(0, 10))
  ok(logs.every(l => /^paypal: /.test(l) && l.length < 200), 'short, prefixed log lines'); ok(logs.some(l => /debug_id dbgX/.test(l)), 'PayPal debug id is logged: it is how PayPal support finds the call')
  ok(logs.some(l => /ORDER_NOT_APPROVED/.test(l)) && !logs.some(l => /ORDER1234567890AB/.test(l)), 'order ids are masked in logged paths')
}
console.log(`paypal client tests passed (${n}): sandbox only, token cached and refreshed, exact Orders v2 requests, amounts to the cent, error mapping, no credentials in logs or errors`)
