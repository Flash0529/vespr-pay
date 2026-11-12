// Agents ask before they spend (PayPal sandbox). An agent can only REQUEST a payment; a person approves or denies it; only then does the server create
// a PayPal order, and the order is captured only after the buyer approves it on PayPal's own sandbox page. Nothing here moves real money: the PayPal client
// (server/paypal.js) talks to the sandbox only.
//
// The pattern is access.js's: the agent calls the server (like request_access), the SERVER posts the card into the room chat (role "payment"; connections cannot
// post or edit one, see access.js), and a person answers over HTTP, where the server checks who they are. The money gate lives in the server's own record
// (<data>/pay/<room>.json), not in a flag of the shared document, because anything in that document can be edited by whoever may write to the room.
//
//   GET  /api/pay/_status                         { configured, mode, notSetUp } for anyone signed in
//   GET  /api/pay/<room>                          members: the limits, what is used today, the last 50 requests (the approve link only for someone who may answer)
//   POST /api/pay/<room>/request { amount, currency, label, reason }   AGENTS only (reason: why, in the agent's words; shown on the card with the server's own facts): asks for a payment; the card appears in the chat
//   POST /api/pay/<room>/answer  { id, approve }  a person (never an agent, never the one who asked): approve creates the PayPal order and returns its sandbox link
//   POST /api/pay/<room>/refund  { id }           a person (never an agent): refunds a captured payment in full, once
//   POST /api/pay/<room>/check   { id }           members: ask PayPal where the order stands; captures it if the buyer approved (the same step as the return page)
//   GET  /api/pay/return/<nonce>?token=<order id>  PayPal sends the buyer back here (no sign-in possible): the server asks PayPal itself and captures once
//   GET  /api/pay/cancel/<nonce>?token=<order id>  the buyer closed PayPal without paying: nothing was charged
//   The <nonce> is 128 random bits made for each request when it is approved and given only to PayPal inside these two addresses. An order id alone does nothing: PayPal's
//   own pages show it to anyone with the payer link, so it cannot be the key. A wrong, missing or old-style address gets the same "Unknown payment" page and changes nothing.
//
// States: pending (waits for a person, 15 minutes) -> awaiting_buyer (approved, PayPal order made, waits for the buyer, 30 minutes) -> captured.
// Also denied, expired, cancelled, failed, refused (over a limit: the server said no before anyone was asked). Every change is appended to the request's trail,
// the room card (which History reads) and <data>/pay/<room>.log.jsonl, with who did it.
// Limits, enforced here: USD only, at most USD 50.00 a request, at most USD 100.00 a room in 24 hours (counting what is waiting, approved or captured), amounts are
// decimal strings checked to the cent, one PayPal order per request and one capture per order (an in-flight lock plus PayPal-Request-Id on both calls).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { can } from './policy.js'
import { openStore, readJson, sendJson, bearer } from './jsonstore.js'
import { parseAmount, money, NOT_SET_UP, PayPalError } from './paypal.js'

export const DEFAULT_LIMITS = Object.freeze({ perRequestCents: 5000, perRoomDayCents: 10000, currencies: ['USD'], proposalTtlMs: 15 * 60_000, buyerTtlMs: 30 * 60_000, dayMs: 24 * 3600_000 })
export const TERMINAL = ['captured', 'denied', 'expired', 'cancelled', 'failed', 'refused', 'refunded'] // 'captured' is the end of the buying; a person can still refund it
export const BADGE = 'PayPal sandbox, no real money'
const norm = s => String(s ?? '').trim().toLowerCase()
const same = (a, b) => norm(a) !== '' && norm(a) === norm(b)
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, n)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const ORDER_ID = /^[A-Za-z0-9_-]{6,64}$/

// The person behind a signed-in name, in the shape server/policy.js wants, so the SAME rule as the existing approval cards decides who may answer (approval.decide):
//   a name from the operator's tokens file (no account record) is an adult member; a personal account is a member of the age on record (none on record: no);
//   a school account is a teacher when the school says it is staff, otherwise a student (policy.js: students never decide approvals, so a student can never approve a payment); a company login is a member of that company.
// A person who may decide must also be an adult (checked in mayDecide).
const BANDS = ['under13', '13-17', 'adult']
export function policyUserOf (who, rec) {
  const id = String((rec && rec.id) || who)
  if (!rec) return { id, orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }
  const claims = (rec.age && Array.isArray(rec.age.claims)) ? rec.age.claims.filter(c => c && c.band) : []
  const band = claims.length ? claims[claims.length - 1].band : null
  if (rec.school) {
    const orgId = 'school:' + String((rec.school && rec.school.via) || 'school').toLowerCase().replace(/[^a-z0-9:_.-]/g, '').slice(0, 80)
    return rec.school.staff ? { id, orgId, roles: ['teacher'], ageBand: 'adult', classIds: [] } : { id, orgId, roles: ['student'], ageBand: BANDS.includes(band) ? band : 'under13', classIds: [] }
  }
  const work = Object.keys(rec.providers || {}).find(k => k.startsWith('work:')) || (rec.work ? 'work:' + String((rec.work && rec.work.company) || 'company').toLowerCase().replace(/[^a-z0-9:_.-]/g, '').slice(0, 80) : null)
  if (work) return { id, orgId: work.slice(0, 90), roles: ['member'], ageBand: BANDS.includes(band) ? band : 'adult', classIds: [] }
  if (!BANDS.includes(band)) return null
  return { id, orgId: null, roles: ['member'], ageBand: band, classIds: [] }
}

// Roles for names in the operator's tokens file, for a server without school sign-in (a classroom demo, a club): VESPR_PAY_ROLES="sam:student,terry:teacher".
// Real school sign-ins get their role from the school automatically (server/auth.js); this only gives a token login the same account shape, so the SAME policy
// decides. Anything but student or teacher is ignored, so it can only make a name more restricted or leave it an ordinary adult member.
export function parseOperatorRoles (text) {
  const m = new Map()
  for (const part of String(text || '').split(',')) { const [name, role] = part.split(':').map(x => (x ?? '').trim()); if (name && ['student', 'teacher'].includes(String(role).toLowerCase())) m.set(name.toLowerCase(), role.toLowerCase()) }
  return m
}
export const operatorRecord = (name, role) => ({ id: String(name), school: { via: 'operator', staff: role === 'teacher' } })

export function createPay ({
  DATA, identify, isAgent = () => false, roomOk = () => true, getDoc = null, Y = null, paypal,
  may = () => true, // may(who, room, right) -> boolean: the workspace's access list (access.js allows); true when there is none
  userOf = () => null, // userOf(token) -> the account record behind a signed-in token, or null (a tokens-file name)
  baseUrl = process.env.VESPR_PAY_BASE_URL || process.env.VESPR_AUTH_BASE_URL || '', trustProxy = false,
  limits = {}, now = () => Date.now(), log = m => console.error(m), sweepMs = 30_000
}) {
  const L = { ...DEFAULT_LIMITS, ...limits }
  const dir = path.join(DATA, 'pay'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stores = new Map() // room -> openStore
  const byOrder = new Map() // PayPal order id -> { room, id }
  const busy = new Set() // request ids being approved (the PayPal order is being made): a second answer is refused
  const flights = new Map() // request id -> the one finish (look at the order, capture) in progress: concurrent callers share it, so there is never a second capture
  const storeOf = room => {
    let s = stores.get(room)
    if (!s) { s = openStore(path.join(dir, room + '.json'), () => ({ requests: [] })); if (!Array.isArray(s.data.requests)) s.data.requests = []; stores.set(room, s); for (const r of s.data.requests) if (r.orderId) byOrder.set(r.orderId, { room, id: r.id }) }
    return s
  }
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) { const m = /^([a-z0-9][a-z0-9-]{0,39})\.json$/.exec(f); if (m) storeOf(m[1]) }
  const reqs = room => storeOf(room).data.requests
  const save = room => { const rs = reqs(room); if (rs.length > 500) rs.splice(0, rs.length - 500); storeOf(room).save() }
  const audit = (room, e) => { try { fs.appendFileSync(path.join(dir, room + '.log.jsonl'), JSON.stringify({ ts: now(), ...e }) + '\n', { mode: 0o600 }) } catch {} }

  const summaryLine = r => `${r.requester} ${r.status === 'pending' ? 'asks to pay' : 'asked to pay'} ${money(r.cents, r.currency)} for ${r.label}${({
    pending: ' (waiting for a person to approve)', awaiting_buyer: ` (approved by ${r.decidedBy}; waiting for the buyer on PayPal)`, captured: ` (approved by ${r.decidedBy}; PayPal captured it)`,
    denied: ` (denied by ${r.decidedBy}; nothing was charged)`, refunded: ` (approved by ${r.decidedBy}; captured, then refunded by ${r.refundedBy})`, expired: ' (nobody answered in time; nothing was charged)', cancelled: ' (cancelled on PayPal; nothing was charged)',
    failed: ' (PayPal did not complete it; nothing was charged)', refused: ' (refused by the server: ' + (r.error || 'over a limit') + ')' })[r.status] || ''}. ${BADGE}.`

  // the request as a card in the room chat; only the server writes these. History reads the trail.
  function card (room, r) {
    if (!getDoc || !Y) return
    try {
      const doc = getDoc(room); const chat = doc.getArray('chat'); const id = 'pay-' + r.id
      const m = chat.toArray().find(x => x instanceof Y.Map && x.get('id') === id)
      const fields = n => {
        n.set('status', r.status); n.set('decidedBy', r.decidedBy || ''); n.set('error', r.error || ''); n.set('orderId', r.orderId || ''); n.set('captureId', r.captureId || '')
        n.set('trail', r.trail.map(t => ({ ...t }))); n.set('buyerDeadline', r.buyerDeadline || 0); n.set('refundId', r.refundId || ''); n.set('refundedBy', r.refundedBy || '')
      }
      doc.transact(() => {
        if (!m) {
          const n = new Y.Map(); const tx = new Y.Text()
          n.set('id', id); n.set('ts', r.ts); n.set('author', r.requester); n.set('isAgent', true); n.set('role', 'payment')
          n.set('request', { id: r.id, who: r.requester, value: r.value, currency: r.currency, label: r.label, description: r.description, expiresAt: r.expiresAt, badge: BADGE, facts: factsOf(r) })
          fields(n); n.set('text', tx); chat.push([n]); tx.insert(0, summaryLine(r))
        } else { fields(m); const tx = m.get('text'); if (tx) { tx.delete(0, tx.length); tx.insert(0, summaryLine(r)) } }
      }, 'pay-server')
    } catch (e) { log('pay: could not post the payment card: ' + (e && e.message)) }
  }
  // deterministic facts the server adds next to the agent's own reason (nothing invented, no scores): what the room had used in 24 hours when this was asked, what approving leaves, the per-request limit
  const factsOf = r => r.facts ? { spent: money(r.facts.spentCents, r.currency), cap: money(r.facts.capCents, r.currency), left: money(Math.max(0, r.facts.capCents - r.facts.spentCents - r.cents), r.currency), perRequest: money(r.facts.perRequestCents, r.currency) } : null
  const step = (room, r, to, by, note, extra = {}) => { // one state change: trail, record, card and audit together
    r.status = to; r.trail.push({ ts: now(), to, by, note }); save(room); audit(room, { id: r.id, event: to, by, note, ...extra }); card(room, r)
  }

  const used = (room, exceptId) => reqs(room).filter(r => r.id !== exceptId && now() - r.ts < L.dayMs && ['pending', 'awaiting_buyer', 'captured'].includes(r.status)).reduce((a, r) => a + r.cents, 0)
  function lapse (room) {
    let changed = false
    for (const r of reqs(room)) {
      if (r.status === 'pending' && now() >= r.expiresAt) { step(room, r, 'expired', 'server', 'nobody answered within 15 minutes'); changed = true }
      else if (r.status === 'awaiting_buyer' && now() >= r.buyerDeadline && !flights.has(r.id)) { step(room, r, 'expired', 'server', 'the buyer did not finish on PayPal in time; nothing was captured'); changed = true }
    }
    return changed
  }

  // what a signed-in person may see of a request (the approve link only for someone who may answer it)
  const view = (r, caller) => {
    const o = { id: r.id, requester: r.requester, value: r.value, currency: r.currency, label: r.label, description: r.description, status: r.status, facts: factsOf(r), decidedBy: r.decidedBy || '', orderId: r.orderId || '', captureId: r.captureId || '', refundId: r.refundId || '', refundedBy: r.refundedBy || '', error: r.error || '', ts: r.ts, expiresAt: r.expiresAt, buyerDeadline: r.buyerDeadline || 0, trail: r.trail, badge: BADGE }
    if (caller && r.status === 'awaiting_buyer' && r.approveUrl && same(r.decidedBy, caller.who)) o.approveUrl = r.approveUrl // only the person who approved it opens the buyer step
    return o
  }
  const mayDecide = (who, token) => { // the existing approval rule (policy.js approval.decide) plus: adults only, never an agent, never someone locked out of the room
    if (isAgent(who)) return { allow: false, reason: 'agents do not answer payment requests; a person does' }
    const u = policyUserOf(who, userOf(token))
    if (!u) return { allow: false, reason: 'this account has no age on record, so it cannot approve payments' }
    const v = can(u, 'approval.decide', u.orgId ? { org: { id: u.orgId, policy: {} } } : {}) // students never decide; teachers, members, owners and admins may
    if (!v.allow) return { allow: false, reason: v.code === 'student_approval' ? 'Students cannot approve payments.' : v.reason } // the policy's words are about every approval; this claim is about payments only
    return u.ageBand === 'adult' ? { allow: true } : { allow: false, reason: 'only adults approve payments' }
  }
  // can this person answer here, and if not, why in plain words (the card says it instead of offering buttons that would be refused)
  const answerability = (who, room, token) => { const rule = mayDecide(who, token); if (!rule.allow) return { canAnswer: false, whyNot: rule.reason }; return may(who, room, 'edit') ? { canAnswer: true, whyNot: '' } : { canAnswer: false, whyNot: 'you need edit rights in this workspace to answer a payment request' } }
  const publicBase = req => {
    if (baseUrl) return String(baseUrl).replace(/\/+$/, '')
    const host = String((trustProxy && req.headers['x-forwarded-host']) || req.headers.host || '')
    if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return ''
    const https = (trustProxy && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') || (req.socket && req.socket.encrypted)
    return `${https ? 'https' : 'http'}://${host}`
  }
  const fail = (res, code, error, extra) => { sendJson(res, code, { error, ...extra }); return true }
  const unavailable = e => e instanceof PayPalError && (e.code === 'not_set_up' || e.code === 'bad_credentials') ? { code: 503, error: e.message } : e instanceof PayPalError && ['network', 'unavailable'].includes(e.code) ? { code: 502, error: e.message + ' Nothing was charged.' } : { code: 502, error: (e && e.message) || 'PayPal failed.' }

  // ---- propose (agents) ----
  function propose (room, who, b, res) {
    if (!isAgent(who)) return fail(res, 403, 'only an agent asks for a payment here; a person approves or denies it')
    if (!may(who, room, 'view')) return fail(res, 403, 'not a member of this workspace')
    if (!paypal || !paypal.configured) return fail(res, 503, NOT_SET_UP, { code: 'not_set_up' })
    lapse(room)
    const amount = parseAmount(b.amount); if (!amount.ok) return fail(res, 400, amount.reason, { code: 'bad_amount' })
    const currency = String(b.currency ?? 'USD').trim().toUpperCase()
    if (!L.currencies.includes(currency)) return fail(res, 400, `Only ${L.currencies.join(', ')} is allowed here, not ${clean(currency, 8) || 'an empty currency'}.`, { code: 'bad_currency' })
    const label = clean(b.label, 80); if (!label) return fail(res, 400, 'Say what is being bought (label), so the person approving knows.', { code: 'needs_label' })
    const description = clean(b.description ?? b.reason, 300)
    const open = reqs(room).filter(r => r.status === 'pending')
    if (open.filter(r => same(r.requester, who)).length >= 3 || open.length >= 6) return fail(res, 429, 'Too many payment requests are waiting for an answer; wait for a person to answer first.', { code: 'too_many' })
    const t = now()
    const r = { id: crypto.randomBytes(8).toString('hex'), room, ts: t, expiresAt: t + L.proposalTtlMs, requester: String(who).slice(0, 60), cents: amount.cents, value: amount.value, currency, label, description, facts: { spentCents: used(room), capCents: L.perRoomDayCents, perRequestCents: L.perRequestCents }, status: 'pending', decidedBy: '', orderId: '', captureId: '', error: '', trail: [] }
    const over = amount.cents > L.perRequestCents ? { code: 'over_request_limit', error: `${money(amount.cents, currency)} is over the limit of ${money(L.perRequestCents, currency)} for one request.` }
      : used(room) + amount.cents > L.perRoomDayCents ? { code: 'over_room_limit', error: `This would take the room past ${money(L.perRoomDayCents, currency)} in 24 hours (${money(Math.max(0, L.perRoomDayCents - used(room)), currency)} left).` } : null
    reqs(room).push(r)
    if (over) { // refused before anyone is asked; it still shows in the room so people see what the agent tried
      if (reqs(room).filter(x => x.status === 'refused' && t - x.ts < 600_000).length > 5) { reqs(room).pop(); return fail(res, 429, 'Too many refused requests; wait a few minutes.', { code: 'too_many' }) }
      r.error = over.error; r.trail.push({ ts: t, to: 'proposed', by: r.requester, note: `asked to pay ${money(r.cents, currency)} for ${label}` })
      step(room, r, 'refused', 'server', over.error); return fail(res, 403, over.error, { code: over.code, request: view(r) })
    }
    r.trail.push({ ts: t, to: 'pending', by: r.requester, note: `asked to pay ${money(r.cents, currency)} for ${label}` }); save(room); audit(room, { id: r.id, event: 'proposed', by: r.requester, cents: r.cents, currency, label }); card(room, r)
    sendJson(res, 201, { request: view(r) }); return true
  }

  // ---- answer (people) ----
  async function answer (room, who, token, b, req, res) {
    lapse(room)
    const r = reqs(room).find(x => x.id === String(b.id ?? ''))
    if (!r) return fail(res, 404, 'no such payment request')
    if (r.status !== 'pending') return fail(res, 409, r.status === 'expired' ? 'this request lapsed (15 minutes without an answer)' : r.decidedBy ? `already answered by ${r.decidedBy}` : `this request is already ${r.status}`, { request: view(r, { who }) })
    if (isAgent(who)) return fail(res, 403, 'agents do not answer payment requests; a person does')
    if (same(r.requester, who)) return fail(res, 403, 'you cannot answer your own request')
    if (!may(who, room, 'edit')) return fail(res, 403, 'you need edit rights in this workspace to answer a payment request')
    const rule = mayDecide(who, token); if (!rule.allow) return fail(res, 403, rule.reason)
    if (busy.has(r.id)) return fail(res, 409, 'someone else is answering this right now')
    if (b.approve !== true) { r.decidedBy = String(who).slice(0, 60); step(room, r, 'denied', r.decidedBy, 'denied; nothing was charged'); return sendJson(res, 200, { request: view(r, { who }) }), true }
    if (!paypal || !paypal.configured) return fail(res, 503, NOT_SET_UP, { code: 'not_set_up' })
    if (used(room, r.id) + r.cents > L.perRoomDayCents) { r.error = 'the room has reached its 24-hour limit since this was asked'; step(room, r, 'refused', 'server', r.error); return fail(res, 409, r.error, { code: 'over_room_limit', request: view(r, { who }) }) }
    const base = publicBase(req); if (!base) return fail(res, 500, 'the server cannot work out its own address for PayPal to send the buyer back to (set VESPR_PAY_BASE_URL)')
    if (!r.nonce) { r.nonce = crypto.randomBytes(16).toString('hex'); save(room) }
    busy.add(r.id)
    try {
      let order
      try { order = await paypal.createOrder({ requestId: 'vespr-pay-' + r.id, cents: r.cents, currency: r.currency, description: r.label, referenceId: r.id, customId: r.id, returnUrl: base + '/api/pay/return/' + r.nonce, cancelUrl: base + '/api/pay/cancel/' + r.nonce }) } catch (e) { const u = unavailable(e); log('pay: ' + r.id + ' order not created: ' + (e && e.code)); return fail(res, u.code, u.error, { code: (e && e.code) || 'paypal' }) }
      if (r.status !== 'pending') return fail(res, 409, 'this request changed while PayPal was answering', { request: view(r, { who }) }) // e.g. it lapsed meanwhile
      r.orderId = order.id; r.approveUrl = order.approveUrl; r.decidedBy = String(who).slice(0, 60); r.buyerDeadline = now() + L.buyerTtlMs; byOrder.set(order.id, { room, id: r.id })
      step(room, r, 'awaiting_buyer', r.decidedBy, `approved; PayPal order ${order.id} created, waiting for the buyer`, { orderId: order.id })
    } finally { busy.delete(r.id) }
    return sendJson(res, 200, { request: view(r, { who }) }), true
  }

  // ---- finish: ask PayPal itself, capture once. Used by the return page and by "check". Trusts nothing in the query string except the order id. ----
  // ---- refund (people): a captured payment goes back to the buyer. Never an agent. One refund per payment (PayPal-Request-Id + the in-flight lock). ----
  async function refund (room, who, token, b, res) {
    const r = reqs(room).find(x => x.id === String(b.id ?? ''))
    if (!r) return fail(res, 404, 'no such payment request')
    if (isAgent(who)) return fail(res, 403, 'agents do not refund payments; a person does')
    if (!may(who, room, 'edit')) return fail(res, 403, 'you need edit rights in this workspace to refund a payment')
    const rule = mayDecide(who, token); if (!rule.allow) return fail(res, 403, rule.reason)
    if (r.status === 'refunded') return fail(res, 409, `already refunded by ${r.refundedBy}`, { request: view(r, { who }) })
    if (r.status !== 'captured' || !r.captureId) return fail(res, 409, 'only a captured payment can be refunded', { request: view(r, { who }) })
    if (!paypal || !paypal.configured) return fail(res, 503, NOT_SET_UP, { code: 'not_set_up' })
    if (busy.has(r.id) || flights.has(r.id)) return fail(res, 409, 'this payment is being worked on right now')
    busy.add(r.id)
    try {
      let f
      try { f = await paypal.refundCapture(r.captureId, { requestId: 'vespr-ref-' + r.id, cents: r.cents, currency: r.currency, note: 'VESPR sandbox refund' }) } catch (e) {
        if (e instanceof PayPalError && e.code === 'already_refunded') f = { id: '', status: 'COMPLETED' }
        else { const u = unavailable(e); log('pay: ' + r.id + ' refund did not go through: ' + (e && e.code)); return fail(res, u.code, u.error.replace(' Nothing was charged.', ' Nothing was refunded.'), { code: (e && e.code) || 'paypal' }) }
      }
      if (f.status === 'FAILED' || f.status === 'CANCELLED') return fail(res, 502, `PayPal says the refund ${f.status.toLowerCase()}; the payment stays captured.`, { code: 'refund_failed' })
      r.refundId = f.id; r.refundedBy = String(who).slice(0, 60); r.refundedAt = now()
      step(room, r, 'refunded', r.refundedBy, `refunded ${money(r.cents, r.currency)}; PayPal refund ${f.id || '(it was already refunded)'}${f.status === 'PENDING' ? ' (PayPal reports it as pending)' : ''}`, { refundId: f.id })
    } finally { busy.delete(r.id) }
    return sendJson(res, 200, { request: view(r, { who }) }), true
  }

  function finalize (r) {
    if (r.status !== 'awaiting_buyer') return Promise.resolve(r)
    if (flights.has(r.id)) return flights.get(r.id)
    const p = finish(r).finally(() => flights.delete(r.id)); flights.set(r.id, p); return p
  }
  async function finish (r) {
    const room = r.room
    if (now() >= r.buyerDeadline) { lapse(room); return r }
    let o
    try { o = await paypal.getOrder(r.orderId) } catch (e) { log('pay: ' + r.id + ' could not read the order: ' + (e && e.code)); return r }
    // the order's own ids, where PayPal returns them, and the amount must be the ones we approved; where it returns none, our own order id binds it
    if ([o.customId, o.referenceId].some(x => x && x !== r.id) || o.value !== r.value || o.currency !== r.currency) { r.error = 'the PayPal order does not match this request'; step(room, r, 'failed', 'server', r.error); return r }
    if (o.status === 'VOIDED') { r.error = 'PayPal voided the order'; step(room, r, 'failed', 'PayPal', r.error); return r }
    let done = o.status === 'COMPLETED' && o.captureStatus === 'COMPLETED' ? o : null // captured earlier (a repeat of this step): record it, do not capture again
    if (!done && o.status === 'APPROVED') {
      try { done = await paypal.captureOrder(r.orderId, { requestId: 'vespr-cap-' + r.id }) } catch (e) {
        if (e instanceof PayPalError && e.code === 'already_captured') { try { done = await paypal.getOrder(r.orderId) } catch { return r } }
        else if (e instanceof PayPalError && e.code === 'declined') { r.error = e.message; step(room, r, 'failed', 'PayPal', e.message); return r }
        else if (e instanceof PayPalError && e.code === 'order_not_approved') return r
        else { log('pay: ' + r.id + ' capture did not finish: ' + (e && e.code)); return r } // transient: stays awaiting_buyer, the next check tries again (the same request id, so never twice)
      }
    }
    if (!done) return r // CREATED or PAYER_ACTION_REQUIRED: the buyer has not approved yet
    if (done.status !== 'COMPLETED' || done.captureStatus !== 'COMPLETED') { r.error = `PayPal reports the capture as ${done.captureStatus || done.status}; check the sandbox account`; step(room, r, 'failed', 'PayPal', r.error); return r }
    if ((done.customId && done.customId !== r.id) || (done.value && done.value !== r.value) || (done.currency && done.currency !== r.currency)) { r.error = 'the captured order does not match this request'; step(room, r, 'failed', 'server', r.error); return r }
    r.captureId = done.captureId; r.capturedAt = now()
    step(room, r, 'captured', 'PayPal', `captured ${money(r.cents, r.currency)}; capture ${done.captureId}`, { orderId: r.orderId, captureId: done.captureId })
    return r
  }

  const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#e8eaed;font:16px/1.5 system-ui,sans-serif}main{max-width:30rem;padding:2rem}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;color:#b6bcc6}b{color:#fff}.tag{display:inline-block;margin-top:1rem;padding:.15rem .6rem;border:1px solid #3a3f4a;border-radius:99px;font-size:.8rem;color:#b6bcc6}</style></head><body><main><h1>${esc(title)}</h1>${body}<span class="tag">${esc(BADGE)}</span></main></body></html>`
  const html = (res, code, title, body) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' }); res.end(page(title, body)) }
  const NONCE = /^[0-9a-f]{32}$/
  const sameNonce = (a, b) => { const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || '')); return x.length === y.length && x.length === 32 && crypto.timingSafeEqual(x, y) }
  const lookup = orderId => { if (!ORDER_ID.test(String(orderId || ''))) return null; const k = byOrder.get(orderId); return k ? reqs(k.room).find(x => x.id === k.id) || null : null }
  const outcomePage = (res, r) => {
    const what = r ? `<p><b>${esc(money(r.cents, r.currency))}</b> for ${esc(r.label)}</p>` : ''
    if (!r) return html(res, 404, 'Unknown payment', '<p>This server does not know that PayPal order.</p>')
    if (r.status === 'captured') return html(res, 200, 'Payment received', `${what}<p>Approved by ${esc(r.decidedBy)} and paid in the PayPal sandbox. You can close this window; the room already shows it.</p>`)
    if (r.status === 'awaiting_buyer') return html(res, 200, 'Not finished yet', `${what}<p>PayPal has not confirmed the payment yet. Finish approving it on PayPal, then use Check in the room.</p>`)
    if (r.status === 'cancelled') return html(res, 200, 'Payment cancelled', `${what}<p>You closed PayPal without paying. Nothing was charged.</p>`)
    return html(res, 200, 'Payment ' + r.status, `${what}<p>${esc(r.error || 'Nothing was charged.')}</p>`)
  }

  const sweep = setInterval(() => { for (const room of stores.keys()) { try { lapse(room) } catch (e) { log('pay: sweep failed: ' + (e && e.message)) } } }, sweepMs); if (sweep.unref) sweep.unref()

  function http (req, res) {
    const u = new URL(req.url, 'http://x')
    const back = /^\/api\/pay\/(return|cancel)(?:\/([0-9a-fA-F]*))?$/.exec(u.pathname)
    if (back) { // the buyer's browser, back from PayPal: no sign-in is possible, so the address itself is the key: the request's own nonce, plus the order id PayPal adds as a pointer; PayPal is then asked
      if (req.method !== 'GET') { sendJson(res, 405, { error: 'GET' }); return true }
      const found = lookup(u.searchParams.get('token')); const r = found && NONCE.test(back[2] || '') && sameNonce(found.nonce, back[2]) ? found : null
      if (back[1] === 'cancel') { if (r && r.status === 'awaiting_buyer' && !flights.has(r.id)) step(r.room, r, 'cancelled', 'buyer', 'the buyer closed PayPal without paying'); outcomePage(res, r); return true }
      if (!r) { outcomePage(res, null); return true }
      finalize(r).then(x => outcomePage(res, x), () => outcomePage(res, r))
      return true
    }
    const m = /^\/api\/pay\/([^/]+)(?:\/(request|answer|check|refund))?$/.exec(u.pathname)
    if (!m) return false
    const token = bearer(req); const who = identify(token); if (!who) return fail(res, 401, 'sign in')
    if (m[1] === '_status' && !m[2]) { sendJson(res, 200, { configured: !!(paypal && paypal.configured), mode: paypal ? paypal.mode : 'sandbox', driver: paypal ? paypal.driver || 'fetch' : '', notSetUp: paypal && paypal.configured ? '' : NOT_SET_UP, badge: BADGE }); return true }
    const room = m[1]; if (!roomOk(room)) return fail(res, 400, 'bad workspace name')
    if (!m[2]) {
      if (req.method !== 'GET') return fail(res, 405, 'GET')
      if (!may(who, room, 'view')) return fail(res, 403, 'not a member of this workspace')
      lapse(room)
      sendJson(res, 200, { room, configured: !!(paypal && paypal.configured), mode: paypal ? paypal.mode : 'sandbox', badge: BADGE, notSetUp: paypal && paypal.configured ? '' : NOT_SET_UP, ...answerability(who, room, token),
        limits: { perRequest: money(L.perRequestCents), perRoomDay: money(L.perRoomDayCents), currencies: L.currencies, proposalMinutes: L.proposalTtlMs / 60_000, usedToday: money(used(room)), leftToday: money(Math.max(0, L.perRoomDayCents - used(room))) },
        requests: reqs(room).slice(-50).map(r => view(r, { who })) }); return true
    }
    if (req.method !== 'POST') return fail(res, 405, 'POST')
    readJson(req).then(async b => {
      if (m[2] === 'request') return propose(room, who, b, res)
      if (m[2] === 'answer') return answer(room, who, token, b, req, res)
      if (m[2] === 'refund') return refund(room, who, token, b, res)
      // check: a member asks PayPal where the order stands
      if (!may(who, room, 'view')) return fail(res, 403, 'not a member of this workspace')
      lapse(room); const r = reqs(room).find(x => x.id === String(b.id ?? '')); if (!r) return fail(res, 404, 'no such payment request')
      const x = await finalize(r); sendJson(res, 200, { request: view(x, { who }) }); return true
    }).catch(e => { if (!res.headersSent) fail(res, e === 'too_large' || e === 'bad_json' ? 400 : 500, e === 'too_large' ? 'too large' : e === 'bad_json' ? 'bad JSON' : 'the payment service failed') })
    return true
  }

  return { http, limits: L, lapse, finalize, view, used, reqs, close: () => clearInterval(sweep) }
}
