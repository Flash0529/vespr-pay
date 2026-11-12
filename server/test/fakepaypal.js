// A stateful stand-in for the PayPal sandbox (OAuth + Orders v2 create / get / capture) for tests only. It enforces what PayPal enforces that matters here:
// Basic auth on the token call, a bearer token on the rest, PayPal-Request-Id idempotency on create and capture, ORDER_NOT_APPROVED until the "buyer" approves,
// ORDER_ALREADY_CAPTURED on a second capture with a new request id. approve(id) plays the buyer's click on PayPal's page.
// createFakePayPal() -> { fetch, state, approve, serve }   fetch is for createPayPal({ fetchImpl }); serve() starts a loopback HTTP server with the same behavior.
import http from 'node:http'

export function createFakePayPal ({ clientId, clientSecret, host = 'https://www.sandbox.paypal.com' }) {
  const basic = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const state = { orders: new Map(), tokens: new Set(), calls: [], creates: 0, captures: 0, captureAttempts: 0, refunds: 0, refundAttempts: 0, byRefundKey: new Map(), failNext: [], seq: 0, byCreateKey: new Map(), byCaptureKey: new Map(), tokenCalls: 0 }
  const err = (status, issue, name = 'UNPROCESSABLE_ENTITY') => ({ status, json: { name, message: issue, debug_id: 'dbg' + status, details: issue ? [{ issue, description: issue }] : [] } })
  // what the REAL sandbox answers to a capture (2026-11-12): the unit has only reference_id and payments, the amount and custom_id are on the capture
  const captureBody = o => ({ id: o.id, status: o.status, payment_source: { paypal: {} }, purchase_units: [{ reference_id: o.unit.reference_id, payments: { captures: [o.capture] } }], payer: {}, links: [] })
  const body = o => ({ id: o.id, status: o.status, intent: 'CAPTURE', purchase_units: [{ reference_id: o.unit.reference_id, custom_id: o.unit.custom_id, description: o.unit.description, amount: o.unit.amount, ...(o.capture ? { payments: { captures: [o.capture] } } : {}) }], links: o.links })

  function handle (method, path, headers, text) {
    const h = Object.fromEntries(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    state.calls.push({ method, path, requestId: h['paypal-request-id'] || '', body: text })
    if (path === '/v1/oauth2/token') {
      state.tokenCalls++
      if (h.authorization !== basic || text !== 'grant_type=client_credentials') return { status: 401, json: { error: 'invalid_client', error_description: 'Client Authentication failed' } }
      const t = 'fake-token-' + (++state.seq); state.tokens.add(t); return { status: 200, json: { access_token: t, token_type: 'Bearer', expires_in: 32400, app_id: 'FAKEAPP' } }
    }
    if (!state.tokens.has((h.authorization || '').replace(/^Bearer /, ''))) return { status: 401, json: { name: 'AUTHENTICATION_FAILURE' } }
    const fail = state.failNext.find(f => f.match.test(method + ' ' + path)); if (fail) { state.failNext.splice(state.failNext.indexOf(fail), 1); return fail.reply }
    if (method === 'POST' && path === '/v2/checkout/orders') {
      const key = h['paypal-request-id']; if (!key) return err(400, 'MISSING_REQUIRED_PARAMETER', 'INVALID_REQUEST')
      if (state.byCreateKey.has(key)) return { status: 200, json: body(state.orders.get(state.byCreateKey.get(key))) }
      let b; try { b = JSON.parse(text) } catch { return err(400, 'MALFORMED_REQUEST_JSON', 'INVALID_REQUEST') }
      const u = b.purchase_units && b.purchase_units[0]; const ctx = b.payment_source && b.payment_source.paypal && b.payment_source.paypal.experience_context
      if (b.intent !== 'CAPTURE' || !u || !u.amount || !/^\d+\.\d{2}$/.test(u.amount.value) || !/^[A-Z]{3}$/.test(u.amount.currency_code) || !ctx || !ctx.return_url || !ctx.cancel_url) return err(422, 'INVALID_REQUEST', 'INVALID_REQUEST')
      const id = 'FAKEORD' + String(++state.seq).padStart(6, '0') + 'XYZ'
      const o = { id, status: 'PAYER_ACTION_REQUIRED', unit: u, ctx, capture: null, links: [{ href: `${host}/checkoutnow?token=${id}`, rel: 'payer-action', method: 'GET' }] }
      state.orders.set(id, o); state.byCreateKey.set(key, id); state.creates++
      return { status: 201, json: body(o) }
    }
    const rm = /^\/v2\/payments\/captures\/([A-Za-z0-9_-]+)\/refund$/.exec(path)
    if (rm && method === 'POST') { // refund a capture in full: once, idempotent per PayPal-Request-Id
      const o = [...state.orders.values()].find(x => x.capture && x.capture.id === rm[1]); if (!o) return { status: 404, json: { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] } }
      const key = h['paypal-request-id']; state.refundAttempts++
      if (key && state.byRefundKey.has(key)) return { status: 200, json: o.refund }
      if (o.refund) return err(422, 'CAPTURE_FULLY_REFUNDED')
      let b = {}; try { b = JSON.parse(text || '{}') } catch {}
      o.refund = { id: 'FAKEREF' + String(++state.seq).padStart(6, '0'), status: 'COMPLETED', amount: b.amount || o.capture.amount }
      state.refunds++; if (key) state.byRefundKey.set(key, o.id)
      return { status: 201, json: o.refund }
    }
    const m = /^\/v2\/checkout\/orders\/([A-Za-z0-9_-]+)(\/capture)?$/.exec(path); if (!m) return { status: 404, json: { name: 'RESOURCE_NOT_FOUND' } }
    const o = state.orders.get(m[1]); if (!o) return { status: 404, json: { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] } }
    if (method === 'GET' && !m[2]) return { status: 200, json: body(o) }
    if (method === 'POST' && m[2]) {
      state.captureAttempts++
      const key = h['paypal-request-id']
      if (key && state.byCaptureKey.has(key)) return { status: 200, json: captureBody(state.orders.get(state.byCaptureKey.get(key))) }
      if (o.status === 'COMPLETED') return { status: 201, json: captureBody(o) } // the real PayPal does not refuse: it returns the capture that exists and takes nothing more
      if (o.status !== 'APPROVED') return err(422, 'ORDER_NOT_APPROVED')
      o.status = 'COMPLETED'; o.capture = { id: 'FAKECAP' + String(++state.seq).padStart(6, '0'), status: 'COMPLETED', custom_id: o.unit.custom_id, amount: o.unit.amount, final_capture: true }
      state.captures++; if (key) state.byCaptureKey.set(key, o.id)
      return { status: 201, json: captureBody(o) }
    }
    return { status: 405, json: { name: 'METHOD_NOT_ALLOWED' } }
  }

  const fetch = async (url, init = {}) => { const u = new URL(url); const r = handle(init.method || 'GET', u.pathname, init.headers, init.body); return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } }) }
  const approve = id => { const o = state.orders.get(id); if (o && o.status === 'PAYER_ACTION_REQUIRED') o.status = 'APPROVED'; return o ? o.ctx : null } // the buyer logged in and pressed Pay Now: returns where PayPal would send the browser
  const decline = id => { state.failNext.push({ match: new RegExp('POST /v2/checkout/orders/' + id + '/capture'), reply: err(422, 'INSTRUMENT_DECLINED') }) }

  // the same behavior over loopback HTTP, with a tiny "PayPal page": GET /checkoutnow?token=ID shows nothing; GET /checkoutnow?token=ID&pay=1 is the buyer paying and redirects to return_url
  function serve () {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/checkoutnow') {
        const id = u.searchParams.get('token'); const o = state.orders.get(id); if (!o) { res.writeHead(404); return res.end('no such order') }
        if (u.searchParams.get('pay') === '1') { approve(id); res.writeHead(302, { Location: `${o.ctx.return_url}?token=${id}&PayerID=FAKEPAYER` }); return res.end() }
        if (u.searchParams.get('cancel') === '1') { res.writeHead(302, { Location: `${o.ctx.cancel_url}?token=${id}` }); return res.end() }
        // a stand-in for PayPal's login and pay pages, so a browser (the film recorder's clip Y) has something to drive: email, Next, password, Log In, Pay Now
        res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<h1>Fake PayPal sandbox</h1><div id="s1"><input id="email" type="email" aria-label="Email"><button onclick="s1.hidden=true;s2.hidden=false">Next</button></div><div id="s2" hidden><input id="password" type="password" aria-label="Password"><button onclick="s2.hidden=true;s3.hidden=false">Log In</button></div><div id="s3" hidden><button onclick="location='?token=${id}&pay=1'">Pay Now</button></div>`)
      }
      let b = ''; req.on('data', c => { b += c }); req.on('end', () => { const r = handle(req.method, u.pathname, req.headers, b); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.json)) })
    })
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => { const base = `http://127.0.0.1:${srv.address().port}`; host = base; resolve({ base, close: () => new Promise(r => srv.close(r)) }) }))
  }
  return { fetch, state, approve, decline, serve }
}
