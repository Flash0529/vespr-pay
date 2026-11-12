// PayPal REST client for the sandbox: OAuth2 client credentials, Orders v2 create / get / capture. No other PayPal API is used.
// Shapes checked against PayPal's published OpenAPI spec (paypal/paypal-rest-api-specifications, checkout_orders_v2.json v2.32) and run against the
// real sandbox by scripts/paypal-smoke.mjs.
//
//   POST /v1/oauth2/token             HTTP Basic (client id : secret), grant_type=client_credentials -> { access_token, expires_in }
//   POST /v2/checkout/orders          intent CAPTURE, one purchase unit, payment_source.paypal.experience_context -> PAYER_ACTION_REQUIRED + a payer-action link
//   GET  /v2/checkout/orders/{id}     the order's status (CREATED, PAYER_ACTION_REQUIRED, APPROVED, COMPLETED, VOIDED ...)
//   POST /v2/checkout/orders/{id}/capture   takes the money once the buyer has approved the order (the buyer approves on PayPal's own page)
//
// SANDBOX ONLY, the same stance as server/billing.js: the base URL is https://api-m.sandbox.paypal.com. The live host (https://api-m.paypal.com)
// is refused unless the operator sets VESPR_PAYPAL_LIVE=1, and nothing else is accepted. (PayPal sandbox and live keys look alike, so the endpoint is
// what decides: a live key sent to the sandbox is refused by PayPal and reported as "PayPal refused the credentials".)
// Credentials come from the environment (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET) and are never logged, put in an error, or returned.
// fetch is injected, so the tests never touch the network.
export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'
export const LIVE_BASE = 'https://api-m.paypal.com'
export const NOT_SET_UP = 'PayPal sandbox is not set up on this server (no sandbox client id and secret).'

export class PayPalError extends Error {
  constructor (code, message, extra = {}) { super(message); this.name = 'PayPalError'; this.code = code; Object.assign(this, extra) }
}

// ---- amounts: integer cents everywhere, a decimal string only at the PayPal edge ----
// "25", "25.5", "25.00", 25, 25.5 -> cents. No signs, no exponents, no more than two decimals, more than zero, at most 999999.99.
export function parseAmount (input) {
  let s
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return { ok: false, reason: 'The amount must be more than zero.' }
    if (Math.abs(Math.round(input * 100) / 100 - input) > 1e-9) return { ok: false, reason: 'The amount can have at most two decimals, like 25.00.' }
    s = input.toFixed(2)
  } else if (typeof input === 'string') s = input.trim()
  else return { ok: false, reason: 'The amount must be a number like 25.00.' }
  const m = /^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return { ok: false, reason: 'The amount must look like 25 or 25.00 (digits, at most two decimals, no signs or symbols).' }
  const cents = Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'))
  if (cents <= 0) return { ok: false, reason: 'The amount must be more than zero.' }
  return { ok: true, cents, value: centsToValue(cents) }
}
export const centsToValue = cents => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
export const money = (cents, currency = 'USD') => `${currency === 'USD' ? '$' : currency + ' '}${centsToValue(cents)}`

const ID = /^[A-Za-z0-9_-]{6,64}$/ // PayPal order ids are 17 upper-case letters and digits; this only keeps a path safe
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const isLoopback = u => { try { const x = new URL(u); return x.protocol === 'http:' && (x.hostname === '127.0.0.1' || x.hostname === 'localhost' || x.hostname === '[::1]') } catch { return false } }
const absoluteUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) } catch { return false } }

// PayPal's failure answers as one vocabulary of codes the payment flow acts on; shared by the fetch client below and the SDK driver (server/paypal-sdk.js)
export function failureFor (status, issue = '', debugId = '') {
  const x = { status, issue, debugId }
  if (status === 401) return new PayPalError('bad_credentials', 'PayPal refused the sandbox client id and secret.', { status })
  if (status === 404) return new PayPalError('not_found', 'PayPal does not know that order.', x)
  if (status >= 500) return new PayPalError('unavailable', 'PayPal had a problem on its side; nothing was charged.', x)
  if (issue === 'ORDER_NOT_APPROVED') return new PayPalError('order_not_approved', 'The buyer has not approved this payment on PayPal yet.', x)
  if (issue === 'ORDER_ALREADY_CAPTURED') return new PayPalError('already_captured', 'This payment was already captured.', x)
  if (issue === 'CAPTURE_FULLY_REFUNDED') return new PayPalError('already_refunded', 'This payment was already refunded.', x)
  if (issue === 'INSTRUMENT_DECLINED' || issue === 'PAYER_ACCOUNT_RESTRICTED' || issue === 'TRANSACTION_REFUSED') return new PayPalError('declined', 'PayPal declined this payment; nothing was charged.', x)
  return new PayPalError('rejected', `PayPal rejected the request${issue ? ' (' + issue + ')' : ''}.`, x)
}

// the checks before any order request leaves this server (both drivers)
export function checkOrderInput ({ requestId, cents, currency, returnUrl, cancelUrl } = {}) {
  const bad = m => { throw new PayPalError('bad_request', m) }
  if (!ID.test(String(requestId || ''))) bad('A request id is required.')
  if (!Number.isInteger(cents) || cents <= 0) bad('The amount must be a positive number of cents.')
  if (!/^[A-Z]{3}$/.test(String(currency))) bad('The currency must be a three-letter code.')
  if (!absoluteUrl(returnUrl) || !absoluteUrl(cancelUrl)) bad('The return and cancel addresses must be full URLs.')
}
export const checkId = (id, what = 'order') => { if (!ID.test(String(id || ''))) throw new PayPalError('bad_request', `That is not a PayPal ${what} id.`) }
export const cleanText = clean
export const payerLinkOf = links => { const l = (links || []).find(x => x && (x.rel === 'payer-action' || x.rel === 'approve') && typeof x.href === 'string'); return l ? l.href : '' }
export const isPayPalHost = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)paypal\.com$/.test(x.hostname) } catch { return false } }

export function createPayPal ({
  clientId = process.env.PAYPAL_CLIENT_ID, clientSecret = process.env.PAYPAL_CLIENT_SECRET,
  baseUrl = process.env.PAYPAL_API_BASE || SANDBOX_BASE,
  allowLive = process.env.VESPR_PAYPAL_LIVE === '1', allowLoopback = false, // loopback is for the tests' fake PayPal only
  fetchImpl = globalThis.fetch, now = () => Date.now(), log = m => console.error(m), timeoutMs = 20000
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '')
  const sandbox = base === SANDBOX_BASE
  const loopback = allowLoopback && isLoopback(base)
  if (!sandbox && !loopback && !(allowLive && base === LIVE_BASE)) throw new Error(`PayPal runs in the sandbox only (${SANDBOX_BASE}); a different endpoint is refused unless VESPR_PAYPAL_LIVE=1 is set for the live one`)
  const configured = Boolean(clientId && clientSecret)
  const basic = configured ? 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64') : ''
  let token = null; let tokenFlight = null // { value, expiresAt }

  const fail = (code, message, extra) => { throw new PayPalError(code, message, extra) }
  const guard = () => { if (!configured) fail('not_set_up', NOT_SET_UP) }

  async function send (url, init) {
    try { return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }) } catch (e) { return fail('network', 'Could not reach PayPal.') }
  }

  async function accessToken (force = false) {
    guard()
    if (!force && token && now() < token.expiresAt - 60_000) return token.value // reuse until a minute before it expires
    if (tokenFlight) return tokenFlight
    tokenFlight = (async () => {
      const r = await send(base + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: 'grant_type=client_credentials' })
      const j = await r.json().catch(() => ({}))
      if (r.status === 401 || r.status === 400) { log(`paypal: the credentials were refused (HTTP ${r.status})`); return fail('bad_credentials', 'PayPal refused the sandbox client id and secret.') }
      if (!r.ok || typeof j.access_token !== 'string' || !j.access_token) { log(`paypal: token request failed (HTTP ${r.status})`); return fail('unavailable', 'PayPal could not give a sign-in token right now.') }
      token = { value: j.access_token, expiresAt: now() + (Number(j.expires_in) > 0 ? Number(j.expires_in) : 300) * 1000 }
      return token.value
    })().finally(() => { tokenFlight = null })
    return tokenFlight
  }

  // one API call; a 401 refreshes the token once and retries (the token may have been revoked or expired early)
  async function call (method, path, { body, requestId } = {}) {
    for (let attempt = 0; ; attempt++) {
      const bearer = await accessToken(attempt > 0)
      const headers = { Authorization: 'Bearer ' + bearer, Accept: 'application/json' }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (requestId) headers['PayPal-Request-Id'] = requestId
      const r = await send(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 401 && attempt === 0) { token = null; continue }
      if (r.ok) return { status: r.status, json: j }
      const issue = clean(j && j.details && j.details[0] && j.details[0].issue || j.name || '', 60)
      const debugId = clean(j && j.debug_id, 40)
      log(`paypal: ${method} ${path.replace(/\/[A-Za-z0-9_-]{6,64}(?=\/|$)/g, '/{id}')} failed (HTTP ${r.status}${issue ? ', ' + issue : ''}${debugId ? ', debug_id ' + debugId : ''})`)
      throw failureFor(r.status, issue, debugId)
    }
  }

  const summarize = o => {
    const pu = (o.purchase_units && o.purchase_units[0]) || {}
    const cap = pu.payments && pu.payments.captures && pu.payments.captures[0]
    // the REAL capture answer (seen on the sandbox 2026-11-12) carries no amount on the unit, only reference_id and payments: so the amount and custom_id fall back to the capture's own
    return { id: o.id, status: o.status, value: (pu.amount || (cap && cap.amount) || {}).value, currency: (pu.amount || (cap && cap.amount) || {}).currency_code, customId: pu.custom_id || (cap && cap.custom_id) || '', referenceId: pu.reference_id || '', captureId: cap ? cap.id : '', captureStatus: cap ? cap.status : '' }
  }
  const payerLink = o => { const l = (o.links || []).find(x => x && (x.rel === 'payer-action' || x.rel === 'approve') && typeof x.href === 'string'); return l ? l.href : '' }
  const paypalHost = u => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)paypal\.com$/.test(x.hostname) } catch { return false } }

  return {
    configured, mode: sandbox ? 'sandbox' : loopback ? 'test' : 'live', baseUrl: base, driver: 'fetch',

    // Creates the order. Idempotent for six hours per requestId (PayPal-Request-Id): asking again with the same id returns the same order.
    // Returns { id, status, approveUrl }: the page the buyer opens to log in to PayPal and approve. Nothing is charged yet.
    async createOrder ({ requestId, cents, currency = 'USD', description = '', referenceId, customId, returnUrl, cancelUrl, brandName = 'VESPR' } = {}) {
      guard()
      checkOrderInput({ requestId, cents, currency, returnUrl, cancelUrl })
      const body = {
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: clean(referenceId || requestId, 256), custom_id: clean(customId || requestId, 255), description: clean(description, 127), amount: { currency_code: currency, value: centsToValue(cents) } }],
        payment_source: { paypal: { experience_context: { brand_name: clean(brandName, 127), shipping_preference: 'NO_SHIPPING', landing_page: 'LOGIN', user_action: 'PAY_NOW', payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED', return_url: returnUrl, cancel_url: cancelUrl } } }
      }
      const { json } = await call('POST', '/v2/checkout/orders', { body, requestId })
      const approveUrl = payerLink(json)
      if (!ID.test(String(json.id || '')) || !approveUrl) { log('paypal: the order answer had no id or payer link'); return fail('bad_response', 'PayPal answered in a way this server does not understand; nothing was charged.') }
      if (!loopback && !paypalHost(approveUrl)) { log('paypal: the payer link was not on paypal.com; refused'); return fail('bad_response', 'PayPal gave an unexpected link; it was not used.') }
      return { id: json.id, status: json.status, approveUrl }
    },

    async getOrder (id) {
      guard()
      if (!ID.test(String(id || ''))) fail('bad_request', 'That is not a PayPal order id.')
      const { json } = await call('GET', `/v2/checkout/orders/${id}`)
      return summarize(json)
    },

    // Returns a captured payment in full (a person pressed Refund): POST /v2/payments/captures/{id}/refund. Idempotent per requestId.
    // -> { id, status } with status COMPLETED, PENDING, FAILED or CANCELLED (PayPal's refund_status).
    async refundCapture (captureId, { requestId, cents, currency = 'USD', note = '' } = {}) {
      guard()
      if (!ID.test(String(captureId || ''))) fail('bad_request', 'That is not a PayPal capture id.')
      if (!Number.isInteger(cents) || cents <= 0) fail('bad_request', 'The refund amount must be a positive number of cents.')
      if (!/^[A-Z]{3}$/.test(String(currency))) fail('bad_request', 'The currency must be a three-letter code.')
      const body = { amount: { currency_code: currency, value: centsToValue(cents) }, ...(clean(note, 255) ? { note_to_payer: clean(note, 255) } : {}) }
      const { json } = await call('POST', `/v2/payments/captures/${captureId}/refund`, { body, requestId: requestId && ID.test(requestId) ? requestId : undefined })
      if (!ID.test(String(json.id || '')) || !['COMPLETED', 'PENDING', 'FAILED', 'CANCELLED'].includes(json.status)) return fail('bad_response', 'PayPal answered the refund in a way this server does not understand.')
      return { id: json.id, status: json.status }
    },

    // Takes the money. PayPal refuses it (ORDER_NOT_APPROVED) unless the buyer approved the order. Idempotent per requestId.
    async captureOrder (id, { requestId } = {}) {
      guard()
      if (!ID.test(String(id || ''))) fail('bad_request', 'That is not a PayPal order id.')
      const { json } = await call('POST', `/v2/checkout/orders/${id}/capture`, { body: {}, requestId: requestId && ID.test(requestId) ? requestId : undefined })
      return summarize(json)
    }
  }
}
