// Desktop sign-in return: the app opens the browser, the person signs in on the website, the browser goes back to the app with a one-use code, and the
// app trades that code (plus its PKCE verifier) for a device session. No session token ever travels in a URL.
// Design: loopback first, scheme fallback,
// PKCE, persisted transactions, a 60 s single-use code, replay revokes. Pure logic: the store, clock, randomness and the session functions are injected.
//
//   create({provider, challenge, state, redirect:'loopback'|'scheme', port?, deviceLabel?, clientVersion?, ip})  -> 201 { txId, expiresAt }
//   preview(txId)                       -> 200 { status, provider, deviceLabel, createdAt, expiresAt }   for the website's "Sign in to VESPR on <device>?" page
//   complete(user, txId)                -> 200 { redirect }  only when admission lets the person in; the browser then navigates to it
//   exchange({txId, code, verifier, installId}) -> 200 { token, admission }
//   cancel({txId, verifier?})           -> 200 { ok: true }
//
// Only hashes are stored (the transaction id, the code); the verifier and the token are never stored. Every status code below is covered by a test.
import crypto from 'node:crypto'

export const TX_TTL_MS = 10 * 60 * 1000
export const CODE_TTL_MS = 60 * 1000
const MAX_MINTS = 3 // codes one transaction may hand out (a person may press "try again" if the app was not running)
const MAX_FAILURES = 5 // wrong code or wrong verifier attempts before the transaction is cancelled
const START_WINDOW_MS = 10 * 60 * 1000
const START_MAX = 20 // transactions one address may start per window
const KEEP_AFTER_EXPIRY_MS = 60 * 60 * 1000

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const b64u = b => Buffer.from(b).toString('base64url')
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const clean = (v, n) => String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n)

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/ // base64url of a SHA-256 digest
const STATE = /^[A-Za-z0-9_-]{16,64}$/
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/ // RFC 7636
const CODE = /^[A-Za-z0-9_-]{43}$/
const INSTALL = /^[A-Za-z0-9._-]{16,64}$/

const fail = (status, error, extra = {}) => ({ status, body: { error, ...extra } })

export function createDesktopAuth ({ store, gate = () => null, now = Date.now, random = n => crypto.randomBytes(n), getUser, providers = () => ({}), admissionFor, issueSession, revokeSessionKey, sessionKeyOf = sha }) {
  const starts = new Map() // address -> start times (a limiter only; losing it on restart is harmless)

  function load () {
    const db = store.load() || {}; const txs = db.txs || {}
    const t = now(); let changed = false
    for (const [k, v] of Object.entries(txs)) if (t > v.expiresAt + KEEP_AFTER_EXPIRY_MS) { delete txs[k]; changed = true }
    if (changed) store.save({ txs })
    return { txs }
  }
  function find (txId) {
    if (typeof txId !== 'string' || !txId || txId.length > 200) return null
    const db = load(); const key = sha(txId); const tx = db.txs[key]
    return tx ? { db, key, tx } : null
  }
  const live = f => f && now() <= f.tx.expiresAt ? f : null
  const redirectFor = (tx, code) => {
    const q = `code=${encodeURIComponent(code)}&state=${encodeURIComponent(tx.state)}`
    return tx.redirect === 'loopback' ? `http://127.0.0.1:${tx.port}/vespr-cb?${q}` : `vespr://auth/done?${q}`
  }
  const verifierOk = (tx, verifier) => typeof verifier === 'string' && VERIFIER.test(verifier) && sameHex(b64u(crypto.createHash('sha256').update(verifier).digest()), tx.challenge)
  const admissionBlock = a => ({ error: 'not_admitted', state: a.state, next: a.next || null })
  const admitted = a => a && (a.state === 'active' || a.state === 'active_restricted')

  function create (i = {}) {
    const known = { password: true, ...providers() }
    if (typeof i.provider !== 'string' || !known[i.provider]) return fail(400, 'unknown_provider')
    if (typeof i.challenge !== 'string' || !CHALLENGE.test(i.challenge)) return fail(400, 'bad_challenge')
    if (typeof i.state !== 'string' || !STATE.test(i.state)) return fail(400, 'bad_state')
    if (i.redirect === 'loopback') {
      if (typeof i.port !== 'number' || !Number.isInteger(i.port) || i.port < 1024 || i.port > 65535) return fail(400, 'bad_port')
    } else if (i.redirect === 'scheme') {
      if (i.port !== undefined && i.port !== null) return fail(400, 'bad_port')
    } else return fail(400, 'bad_redirect')
    if (i.deviceLabel !== undefined && typeof i.deviceLabel !== 'string') return fail(400, 'bad_label')
    if (i.clientVersion !== undefined && typeof i.clientVersion !== 'string') return fail(400, 'bad_version')

    const ip = String(i.ip || 'unknown'); const t = now()
    const recent = (starts.get(ip) || []).filter(x => t - x < START_WINDOW_MS)
    if (recent.length >= START_MAX) { starts.set(ip, recent); return fail(429, 'too_many_requests') }
    recent.push(t); starts.set(ip, recent)

    const txId = b64u(random(24)); const db = load()
    db.txs[sha(txId)] = {
      challenge: i.challenge, state: i.state, redirect: i.redirect, port: i.redirect === 'loopback' ? i.port : null, provider: i.provider,
      label: clean(i.deviceLabel || 'desktop', 60) || 'desktop', clientVersion: clean(i.clientVersion || '', 40),
      createdAt: t, expiresAt: t + TX_TTL_MS, status: 'pending', userId: null, mints: 0, failures: 0, codeHash: null, codeExpiresAt: 0, sessionKey: null
    }
    store.save(db)
    return { status: 201, body: { txId, expiresAt: t + TX_TTL_MS } }
  }

  function preview (txId) {
    const f = live(find(txId)); if (!f) return fail(404, 'unknown_or_expired')
    const { status, provider, label, createdAt, expiresAt } = f.tx
    return { status: 200, body: { status, provider, deviceLabel: label, createdAt, expiresAt } }
  }

  function complete (user, txId) {
    const f = live(find(txId)); if (!f) return fail(404, 'unknown_or_expired')
    const { db, key, tx } = f
    if (tx.status === 'cancelled' || tx.status === 'consumed') return fail(409, 'transaction_closed')
    if (tx.userId && tx.userId !== user.id) return fail(409, 'transaction_belongs_to_someone_else')
    if (tx.mints >= MAX_MINTS) return fail(429, 'too_many_codes')
    const a = admissionFor(user)
    if (!admitted(a)) return { status: 403, body: admissionBlock(a) } // no code is minted; the same transaction resumes once the account is complete
    const code = b64u(random(32))
    tx.status = 'ready'; tx.userId = user.id; tx.mints++; tx.codeHash = sha(code); tx.codeExpiresAt = now() + CODE_TTL_MS
    db.txs[key] = tx; store.save(db)
    return { status: 200, body: { redirect: redirectFor(tx, code) } }
  }

  function exchange (i = {}) {
    if (typeof i.code !== 'string' || !CODE.test(i.code) || typeof i.installId !== 'string' || !INSTALL.test(i.installId) || typeof i.verifier !== 'string' || !VERIFIER.test(i.verifier)) return fail(400, 'bad_request')
    const f = live(find(i.txId)); if (!f) return fail(400, 'unknown_or_expired')
    const { db, key, tx } = f
    if (tx.status === 'consumed') { // a second use of a code: refuse, and close the session the first use created
      if (tx.sessionKey) { try { revokeSessionKey(tx.sessionKey) } catch {} tx.sessionKey = null; db.txs[key] = tx; store.save(db) }
      return fail(400, 'code_used')
    }
    if (tx.status !== 'ready' || !tx.codeHash) return fail(400, 'transaction_not_ready')
    if (now() > tx.codeExpiresAt) return fail(400, 'code_expired')
    const good = verifierOk(tx, i.verifier) & sameHex(sha(i.code), tx.codeHash) // both are always evaluated: the answer does not say which one was wrong
    if (!good) {
      tx.failures++; if (tx.failures >= MAX_FAILURES) { tx.status = 'cancelled'; tx.codeHash = null }
      db.txs[key] = tx; store.save(db)
      return fail(400, 'invalid_grant')
    }
    const user = getUser(tx.userId); if (!user) return fail(400, 'invalid_grant')
    const a = admissionFor(user) // the account may have changed since the browser step (suspended, guardian revoked)
    if (!admitted(a)) return { status: 403, body: admissionBlock(a) }
    const g = gate(user, i); if (g) return { status: g.status, body: { error: g.error, code: 'device_bound' } } // one computer, one person (auth.js deviceGate)
    tx.status = 'consumed'; tx.codeHash = null; db.txs[key] = tx; store.save(db) // marked used BEFORE anything is issued
    const token = issueSession(user, { label: tx.label, installId: i.installId, kind: 'device' })
    tx.sessionKey = sessionKeyOf(token); db.txs[key] = tx; store.save(db)
    return { status: 200, body: { token, admission: { state: a.state, restrictions: a.restrictions || {} } } }
  }

  function cancel (i = {}) {
    const f = live(find(i.txId)); if (!f) return fail(404, 'unknown_or_expired')
    const { db, key, tx } = f
    if (tx.status === 'consumed') return fail(409, 'transaction_used')
    if (i.verifier !== undefined && !verifierOk(tx, i.verifier)) return fail(403, 'bad_verifier')
    tx.status = 'cancelled'; tx.codeHash = null; db.txs[key] = tx; store.save(db)
    return { status: 200, body: { ok: true } }
  }

  return { create, preview, complete, exchange, cancel }
}
