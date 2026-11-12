// Billing with Stripe: prepaid AI credit bought through Stripe Checkout.
// Card details only ever go to Stripe. The one signed webhook is the only thing that adds or removes credit.
//   POST /api/billing/checkout  { pack }   a signed-in person -> { url } of a Stripe Checkout page for that pack
//   POST /api/billing/webhook              Stripe only: signature checked (HMAC-SHA256 over "t.payload", 5 min window), each event once
//   GET  /api/billing/me                   your balance (credit bought - usage at cost x markup), your billing email and name, the packs
// Test mode is enforced: a live key (sk_live_) is refused unless VESPR_STRIPE_LIVE=1. Keys come from the environment, never logged.
// Storage: <data>/billing/credits.jsonl (append-only: top-ups and refunds), events.jsonl (processed event ids), profiles.json.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const PACKS = { 'credit-10': 1000, 'credit-20': 2000, 'credit-50': 5000 } // cents
export const NOT_SET_UP = "Payments aren't set up right now (the Stripe test key isn't valid)."

export function verifyStripeSignature (payload, header, secret, { toleranceSec = 300, now = Date.now() } = {}) {
  if (!payload || !header || !secret) return false
  let t = 0; const v1 = []
  for (const part of String(header).split(',')) { const [k, v] = part.split('='); if (k === 't') t = Number(v); else if (k === 'v1' && v) v1.push(v) }
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  return v1.some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
}

const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k
  return v && typeof v === 'object' ? form(v, key) : [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`]
}).join('&')

export function createBilling ({ DATA, identify, isAgent = () => false, spentMicros = () => 0, payersFor = person => [person], secretKey = process.env.STRIPE_SECRET_KEY, webhookSecret = process.env.STRIPE_WEBHOOK_SECRET,
  baseUrl = process.env.VESPR_AUTH_BASE_URL, apiBase = 'https://api.stripe.com', fetchImpl = globalThis.fetch, allowLive = process.env.VESPR_STRIPE_LIVE === '1', now = () => Date.now(), log = m => console.error(m) }) {
  if (!secretKey || !webhookSecret || !baseUrl) throw new Error('billing needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and VESPR_AUTH_BASE_URL')
  if (!/^sk_test_/.test(secretKey) && !(allowLive && /^sk_live_/.test(secretKey))) throw new Error('billing runs in Stripe test mode only (a sk_test_ key) unless VESPR_STRIPE_LIVE=1')
  const dir = path.join(DATA, 'billing'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = n => path.join(dir, n)
  const credits = []; const events = new Set()
  for (const l of (fs.existsSync(file('credits.jsonl')) ? fs.readFileSync(file('credits.jsonl'), 'utf8') : '').split('\n')) { if (l) try { credits.push(JSON.parse(l)) } catch {} }
  for (const l of (fs.existsSync(file('events.jsonl')) ? fs.readFileSync(file('events.jsonl'), 'utf8') : '').split('\n')) { if (l) try { events.add(JSON.parse(l).id) } catch {} }
  let profiles = {}; try { profiles = JSON.parse(fs.readFileSync(file('profiles.json'), 'utf8')) } catch {}
  const append = (n, o) => fs.appendFileSync(file(n), JSON.stringify(o) + '\n', { mode: 0o600 })
  const saveProfiles = () => { const tmp = file('profiles.json.tmp'); fs.writeFileSync(tmp, JSON.stringify(profiles, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file('profiles.json')) }
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const readBody = (req, max) => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; if (s.length > max) req.destroy() }); req.on('end', () => resolve(s)); req.on('error', () => resolve('')) })

  const isCreditLive = c => !(c.kind === 'trial' && c.expiresAt && c.expiresAt <= now())
  const creditMicros = person => credits.filter(c => c.person === person && isCreditLive(c)).reduce((a, c) => a + c.micros, 0)
  const balance = person => ({ credit_usd: creditMicros(person) / 1e6, spent_usd: spentMicros(person) / 1e6, balance_usd: (creditMicros(person) - spentMicros(person)) / 1e6 })

  // 7-day free trial, no card (Ask #54): one-time $5.00 AI trial credit valid for 7 days
  function activateTrial (person) {
    if (!person || typeof person !== 'string') return { code: 400, body: { error: 'needs person' } }
    if (credits.some(c => c.person === person && c.kind === 'trial')) {
      return { code: 409, body: { error: '7-day trial already used for this account', used: true } }
    }
    const c = { kind: 'trial', ts: now(), person, micros: 5_000_000, days: 7, expiresAt: now() + 7 * 86_400_000 }
    append('credits.jsonl', c); credits.push(c)
    return { code: 200, body: { ok: true, trial: true, credit_usd: 5.0, days: 7, ...balance(person) } }
  }

  async function checkout (person, pack) {
    const cents = PACKS[pack]; if (!cents) return { code: 400, body: { error: `unknown pack; one of ${Object.keys(PACKS).join(', ')}` } }
    const params = {
      mode: 'payment', client_reference_id: person, 'customer_creation': 'always', billing_address_collection: 'required',
      success_url: `${baseUrl.replace(/\/$/, '')}/account.html?billing=done&session={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl.replace(/\/$/, '')}/account.html?billing=cancelled`,
      metadata: { person, pack }, payment_intent_data: { metadata: { person, pack } },
      line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name: `VESPR AI credit, $${cents / 100}` } } } }
    }
    const r = await fetchImpl(`${apiBase}/v1/checkout/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `checkout-${person}-${pack}-${Math.floor(now() / 60000)}` }, body: form(params) }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }))
    const j = await r.json().catch(() => ({}))
    if (r.status === 401) { log('stripe checkout failed (HTTP 401): the key was refused'); return { code: 503, body: { error: NOT_SET_UP } } }
    if (!r.ok || !j.url) { log(`stripe checkout failed (HTTP ${r.status}): ${(j.error && j.error.type) || 'no url'}`); return { code: 502, body: { error: 'the payment page could not be opened; nothing was charged' } } }
    return { code: 200, body: { url: j.url, id: j.id } }
  }

  // credit a paid Checkout once per session, whichever arrives first: the signed webhook or the person coming back (confirm)
  function creditSession (o, eventId) {
    const person = o.metadata && o.metadata.person
    if (!person || o.payment_status !== 'paid' || !Number.isInteger(o.amount_total) || credits.some(c => c.session === o.id)) return false
    const c = { kind: 'topup', ts: now(), person, micros: o.amount_total * 10000, session: o.id, payment_intent: o.payment_intent || '', event: eventId, pack: (o.metadata && o.metadata.pack) || '' }
    append('credits.jsonl', c); credits.push(c)
    const d = o.customer_details || {}; const was = profiles[person] || {}
    profiles[person] = { ...was, customer: o.customer || was.customer || '', email: d.email || was.email || '', name: d.name || was.name || '', updated: now() }
    saveProfiles(); return true
  }

  // Silent Consensus's pattern: when Stripe sends the person back, ask Stripe itself whether that Checkout was paid. Works before a
  // webhook is set up. Refused: a live-mode session in test mode, anything unpaid, or a session that is not the caller's own.
  async function confirm (person, sessionId) {
    if (!/^cs_[\w]{3,200}$/.test(String(sessionId || ''))) return { code: 400, body: { error: 'needs the Checkout session id' } }
    const r = await fetchImpl(`${apiBase}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${secretKey}` } }).catch(() => ({ ok: false, status: 0, json: async () => ({}) }))
    if (r.status === 401) return { code: 503, body: { error: NOT_SET_UP } }
    const s = await r.json().catch(() => ({}))
    if (!r.ok) return { code: 502, body: { error: 'could not check the payment with Stripe; nothing changed' } }
    if ((s.livemode && !allowLive) || s.payment_status !== 'paid' || s.mode !== 'payment') return { code: 409, body: { error: 'that payment is not finished' } }
    if (!s.metadata || s.metadata.person !== person || s.client_reference_id !== person) return { code: 403, body: { error: 'that payment belongs to someone else' } }
    const credited = creditSession(s, 'confirm:' + s.id)
    return { code: 200, body: { ok: true, credited, ...balance(person) } }
  }

  function handleEvent (ev) {
    if (!ev || !ev.id || events.has(ev.id)) return { duplicate: true }
    const o = (ev.data && ev.data.object) || {}
    let did = 'ignored'
    if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && o.mode === 'payment') {
      if (creditSession(o, ev.id)) did = 'credited'
    } else if (ev.type === 'charge.refunded') {
      const topup = credits.find(c => c.kind === 'topup' && c.payment_intent && c.payment_intent === o.payment_intent)
      const already = credits.filter(c => c.kind === 'refund' && c.payment_intent === o.payment_intent).reduce((a, c) => a - c.micros, 0)
      const refunded = Number.isInteger(o.amount_refunded) ? o.amount_refunded * 10000 : 0
      if (topup && refunded > already) { const c = { kind: 'refund', ts: now(), person: topup.person, micros: -(refunded - already), payment_intent: o.payment_intent, event: ev.id }; append('credits.jsonl', c); credits.push(c); did = 'refunded' }
    }
    append('events.jsonl', { id: ev.id, type: ev.type, ts: now(), did }); events.add(ev.id)
    return { did }
  }

  return {
    balance, handleEvent, confirm, activateTrial, profileOf: person => profiles[person] || null,
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/api/billing/webhook' && req.method === 'POST') {
        readBody(req, 256 * 1024).then(raw => {
          if (!verifyStripeSignature(raw, req.headers['stripe-signature'], webhookSecret, { now: now() })) return json(res, 400, { error: 'bad signature' })
          let ev = null; try { ev = JSON.parse(raw) } catch {}
          if (!ev) return json(res, 400, { error: 'bad body' })
          json(res, 200, { received: true, ...handleEvent(ev) })
        })
        return true
      }
      if (u.pathname === '/api/billing/checkout' && req.method === 'POST') {
        const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
        readBody(req, 2048).then(async raw => { let b = {}; try { b = JSON.parse(raw || '{}') } catch {} const r = await checkout(who, b.pack); json(res, r.code, r.body) })
        return true
      }
      if (u.pathname === '/api/billing/confirm' && req.method === 'POST') {
        const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
        readBody(req, 1024).then(async raw => { let b = {}; try { b = JSON.parse(raw || '{}') } catch {} const r = await confirm(who, b.session); json(res, r.code, r.body) })
        return true
      }
      if (u.pathname === '/api/billing/trial' && req.method === 'POST') {
        const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
        const r = activateTrial(who); json(res, r.code, r.body)
        return true
      }
      // agents ask before spending on someone's behalf (the paywall): only a static agent token, the same writers as the ledger
      if (u.pathname === '/api/billing/allowance' && req.method === 'GET') {
        const token = bearer(req); if (!identify(token)) { json(res, 401, { error: 'sign in' }); return true }
        if (!isAgent(token)) { json(res, 403, { error: 'agents only' }); return true }
        const person = String(u.searchParams.get('person') || '').slice(0, 60); if (!person) { json(res, 400, { error: 'needs person' }); return true }
        // in a shared chat the people paying may be others (cost-sharing.js): every one of them needs credit
        const room = String(u.searchParams.get('room') || '').slice(0, 40)
        const payers = payersFor(person, room); const short = payers.filter(p => balance(p).balance_usd <= 0)
        const b = balance(person); json(res, 200, { person, ok: short.length === 0, payers, short, ...b }); return true
      }
      if (u.pathname === '/api/billing/me' && req.method === 'GET') {
        const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
        const p = profiles[who] || {}
        const trialCredit = credits.find(c => c.person === who && c.kind === 'trial')
        const trial = trialCredit ? { used: true, daysLeft: Math.max(0, Math.ceil(((trialCredit.expiresAt || 0) - now()) / 86_400_000)) } : { used: false, available: true }
        json(res, 200, { person: who, mode: /^sk_test_/.test(secretKey) ? 'test' : 'live', ...balance(who), trial, billing: { email: p.email || '', name: p.name || '' }, packs: Object.entries(PACKS).map(([id, cents]) => ({ id, usd: cents / 100 })) })
        return true
      }
      return false
    }
  }
}
