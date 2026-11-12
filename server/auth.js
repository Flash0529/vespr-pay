// VESPR authentication module: accounts and five sign-in methods.
// Methods: (1) email + password with 2FA (TOTP or Twilio SMS), (2) Google, (3) Microsoft, (4) GitHub, (5) Clever.
// Zero third-party runtime dependencies: built purely on Node.js standard library (crypto, http, https, fs, path).
// Storage: atomic writes to ${DATA}/auth/users.json and ${DATA}/auth/sessions.json (mode 0600).
// Session tokens: 32 random bytes, only SHA-256 stored. 30-day expiry.
import { createOrgPolicy, accountKindOf } from './orgpolicy.js'
import { createHandles } from './handles.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import https from 'node:https'
import http from 'node:http'
import { admit } from './admission.js'
import { createDesktopAuth } from './desktop-auth.js'
import { createConnectors } from './connectors.js'
import { createLti } from './lti.js'
import { createSponsor } from './sponsor.js'
import { createDiscover } from './discover.js'
import { createWork } from './work.js'
import { createVault } from './vault.js'
import { createLifecycle } from './lifecycle.js'

// School sign-in (Clever, ClassLink, and Canvas / D2L through LTI): the school vouches for the student, who may have no email (kids often
// do not; COPPA says ask for as little as possible). These accounts are found by the school's id for the person only; an email the school
// sends is never used to sign into an existing VESPR account (a district or LMS admin can type any email), so a school account is its own.
export const SCHOOL_PROVIDERS = new Set(['clever', 'classlink'])
// Microsoft: anyone can create their own Microsoft organization and put any address on an account there, so the email in a work or school
// token proves nothing unless Microsoft says the organization owns the domain (optional claim xms_edov, switched on in the app registration).
// Personal Microsoft accounts (the consumer tenant) have verified addresses.
export const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad'
export const microsoftEmailVerified = c => Boolean(c) && (c.tid === MSA_TENANT || c.xms_edov === true || c.xms_edov === 1 || c.xms_edov === '1' || c.xms_edov === 'true')

const RATE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const RATE_MAX_FAILURES = 5
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days in a browser, renewed while used
const APP_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000 // the desktop app stays signed in (renewed while used) until a security change (server/lifecycle.js)
const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

// Helper: base64url encoding / decoding
export const base64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
export const base64urlDecode = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

// Base32 helper for RFC 6238 TOTP
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function base32Encode (buf) {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode (str) {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/[\s-]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i])
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// RFC 6238 TOTP code generator & verifier
export function generateTOTP (secretBase32, timeSec = Math.floor(Date.now() / 1000), stepSec = 30, digits = 6) {
  const key = base32Decode(secretBase32)
  const counter = Math.floor(timeSec / stepSec)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % (10 ** digits)
  return String(code).padStart(digits, '0')
}

export function verifyTOTP (token, secretBase32, timeSec = Math.floor(Date.now() / 1000), stepSec = 30, window = 1) {
  if (!/^\d{6}$/.test(String(token || ''))) return false
  const currentCounter = Math.floor(timeSec / stepSec)
  for (let error = -window; error <= window; error++) {
    const stepTime = (currentCounter + error) * stepSec
    const expected = generateTOTP(secretBase32, stepTime, stepSec)
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return currentCounter + error
    }
  }
  return false
}

// scrypt password hashing
export function hashPassword (password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return { hash, salt }
}

export function verifyPassword (password, hash, salt) {
  const computed = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

// Helper: HTTP request using standard library (handles http and https)
function httpRequest (urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr)
    const client = u.protocol === 'https:' ? https : http
    const req = client.request(u, options, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body
        })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    if (data) {
      req.write(data)
    }
    req.end()
  })
}

export function createAuth ({
  DATA,
  identifyToken = () => null,
  reservedNames = () => [], // names nobody may sign up with: the agents and the service tokens (access control goes by name)
  config = process.env,
  now = () => Date.now(),
  fetcher = null,
  mailer = null, // { send({ to, subject, text }) -> Promise }: see server/mail.js; absent = verification links go to the dev log file
  smsTransport = null, // { send(phone) -> Promise, check(phone, code) -> Promise<boolean> }: absent = Twilio Verify from config
  admissionFor = null, // user -> admission result (see server/admission.js); absent = built from the user record and config (Terms hash, guardian methods)
  workRequest = null, // tests: replaces the HTTP calls to company logins and GitHub (server/work.js)
  discoverDeps = null, // tests: { dns, realm } in place of the real DNS and Microsoft lookups (server/discover.js)
  ltiRequest = null, // tests: replaces fetching a school LMS's published keys (server/lti.js)
  connectorRequest = null, // tests: replaces the HTTP calls connectors make to providers (server/connectors.js defaultRequest)
  oauthProviders = {} // { google|microsoft|github: { authorizeUrl({ state, nonce, codeChallenge, redirectUri }), exchange({ code, codeVerifier, nonce, redirectUri }) -> profile } }: injected providers replace the real HTTP calls
}) {
  const authDir = path.join(DATA, 'auth')
  const usersFile = path.join(authDir, 'users.json')
  const sessionsFile = path.join(authDir, 'sessions.json')
  const emailLogFile = path.join(authDir, 'email-dev.log')

  // In-memory rate-limiter: key -> { count, firstFailedAt }
  const failAttempts = new Map()

  // Transient OAuth state store: stateKey -> { provider, next, codeVerifier, nonce, expiresAt }
  const oauthStates = new Map()

  // Transient verification token store: token -> { userId, email, expiresAt }
  const emailVerificationTokens = new Map()

  // Cached JWKS: url -> { keys, fetchedAt }
  const jwksCache = new Map()

  // Ensure auth directory exists
  try { fs.mkdirSync(authDir, { recursive: true }) } catch {}

  // Atomic file storage
  function readJson (filePath, fallback = {}) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
      return fallback
    }
  }

  // Users and sessions live in memory (0-5,000 users: re-reading and parsing users.json and sessions.json on every request cost 3-20 ms
  // each and capped the server near 50-100 signed-in requests a second; a teammate's SCALE-REVIEW-5000.md). Each is parsed once and read
  // again only when the file changed on disk (a restore, another process); every save updates the copy in memory. Callers get the
  // shared object, so a change must be followed by a save (the flows that change accounts decide first, then change, then save).
  const stores = new Map() // file -> { data, mtimeMs, size, version }
  let storeVersion = 0
  function cachedJson (file, fallback) {
    let st = null; try { st = fs.statSync(file) } catch {}
    const c = stores.get(file)
    if (c && (st ? c.mtimeMs === st.mtimeMs && c.size === st.size : c.missing)) return c.data
    const data = st ? readJson(file, fallback()) : fallback()
    stores.set(file, { data, mtimeMs: st ? st.mtimeMs : 0, size: st ? st.size : 0, missing: !st, version: ++storeVersion })
    return data
  }

  function writeJsonAtomic (filePath, data) {
    const big = filePath === usersFile || filePath === sessionsFile
    const tmp = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`
    fs.writeFileSync(tmp, big ? JSON.stringify(data) : JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
    if (big) { const st = fs.statSync(filePath); stores.set(filePath, { data, mtimeMs: st.mtimeMs, size: st.size, missing: false, version: ++storeVersion }) }
  }

  function getUsers () {
    return cachedJson(usersFile, () => ({}))
  }

  // Names are who you are in a workspace (chat, access lists, ownership), so each belongs to one account. Case and spaces ignored.
  const nameKey = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  let nameIndex = { version: -1, keys: new Set() }
  function namesOf (users) {
    const c = stores.get(usersFile)
    if (!c || c.data !== users) return null // a list that is not the stored one (tests, a copy): scan it
    if (nameIndex.version !== c.version) nameIndex = { version: c.version, keys: new Set(Object.values(users).map(u => nameKey(u.name))) }
    return nameIndex.keys
  }
  function nameTaken (users, name) {
    const k = nameKey(name)
    if (!k || k === '*' || k === 'everyone') return true
    if ((reservedNames() || []).some(r => nameKey(r) === k)) return true
    const idx = namesOf(users)
    // the index covers what was saved; an account added to the list but not saved yet is found by the scan
    return (idx ? idx.has(k) : false) || Object.values(users).some(u => nameKey(u.name) === k && (!idx || !idx.has(k)))
  }
  function freeName (users, base) {
    const b = String(base ?? '').trim().replace(/\s+/g, ' ').slice(0, 56) || 'member'
    if (!nameTaken(users, b)) return b
    for (let i = 2; i < 1000; i++) if (!nameTaken(users, `${b} ${i}`)) return `${b} ${i}`
    return `${b} ${crypto.randomBytes(3).toString('hex')}`
  }

  function saveUsers (users) {
    writeJsonAtomic(usersFile, users)
  }

  function updateUser (userId, updateFn) {
    const users = getUsers()
    const user = users[userId]
    if (!user) return null
    updateFn(user)
    saveUsers(users)
    return user
  }

  let lastSweep = 0
  function getSessions () {
    const sessions = cachedJson(sessionsFile, () => ({}))
    const currentTime = now()
    if (currentTime - lastSweep >= 10 * 60 * 1000) { // expired sessions leave the file every 10 minutes, not inside every read
      lastSweep = currentTime
      let changed = false
      for (const [hash, sess] of Object.entries(sessions)) if (sess.expiresAt < currentTime) { delete sessions[hash]; changed = true }
      if (changed) writeJsonAtomic(sessionsFile, sessions)
    }
    return sessions
  }

  function saveSessions (sessions) {
    writeJsonAtomic(sessionsFile, sessions)
  }

  // Rate-limiting check
  function isRateLimited (key) {
    const record = failAttempts.get(key)
    if (!record) return false
    if (now() - record.firstFailedAt > RATE_WINDOW_MS) {
      failAttempts.delete(key)
      return false
    }
    return record.count >= RATE_MAX_FAILURES
  }

  // Seconds until a locked key may try again (for Retry-After and the sign-in form's locked state)
  function lockSeconds (...keys) {
    let ms = 0
    for (const k of keys) {
      const r = failAttempts.get(k)
      if (r && r.count >= RATE_MAX_FAILURES) ms = Math.max(ms, r.firstFailedAt + RATE_WINDOW_MS - now())
    }
    return Math.max(1, Math.ceil(ms / 1000))
  }

  function lockedResponse (res, error, ...keys) {
    const retryAfter = lockSeconds(...keys)
    return jsonResponse(res, 429, { error, locked: true, retryAfterSec: retryAfter }, { 'Retry-After': String(retryAfter) })
  }

  function recordFailure (key) {
    const record = failAttempts.get(key)
    if (!record || now() - record.firstFailedAt > RATE_WINDOW_MS) {
      failAttempts.set(key, { count: 1, firstFailedAt: now() })
    } else {
      record.count += 1
    }
  }

  function clearFailure (key) {
    failAttempts.delete(key)
  }

  // Allowed redirect URLs for OAuth 'next' parameter
  function isAllowedNext (targetUrl) {
    if (!targetUrl) return false
    // Same-site absolute paths only: '//host', '/\host', schemes and control characters would send the session token to another site
    if (!targetUrl.startsWith('/') || targetUrl.startsWith('//') || /[\\\u0000-\u001f]/.test(targetUrl)) return false
    // the pages that start a sign-in: the website (account.html), the desktop app's browser step (desktop-signin.html), the app itself
    const allowed = (config.VESPR_AUTH_ALLOWED_NEXT || '/prototype.html,/,/account.html,/desktop-signin.html,/app/').split(',').map(s => s.trim())
    try {
      const u = new URL(targetUrl, 'http://localhost')
      if (u.origin !== 'http://localhost') return false
      return allowed.some(a => a === u.pathname)
    } catch {
      return false
    }
  }

  // Token hash
  const sha256Hex = str => crypto.createHash('sha256').update(str).digest('hex')

  // Identify token from either static tokens file or active session store
  function identify (rawToken) {
    if (!rawToken) return null
    // 1. Check static tokens
    const staticUser = identifyToken(rawToken)
    if (staticUser) return staticUser

    // 2. Check session store
    const hash = sha256Hex(rawToken)
    const sessions = getSessions()
    const sess = sessions[hash]
    if (sess && sess.expiresAt > now()) {
      return sess.name || sess.email
    }
    return null
  }

  function getSessionUser (rawToken) {
    if (!rawToken) return null
    const hash = sha256Hex(rawToken)
    const sessions = getSessions()
    const sess = sessions[hash]
    if (!sess || sess.expiresAt <= now()) return null
    const users = getUsers()
    const user = users[sess.userId] || null
    if (!user || ['suspended', 'deletion_requested'].includes(user.activation)) return null
    const ttl = sess.kind === 'device' ? APP_SESSION_TTL_MS : SESSION_TTL_MS // renew at most once a day while the session is used
    if (sess.expiresAt - now() < ttl - 24 * 60 * 60 * 1000) { sess.expiresAt = now() + ttl; saveSessions(sessions) }
    return user
  }

  // Hook for the GitHub workspace integration to look up the user's linked GitHub account
  function getLinkedIdentity (userId, provider = 'github') {
    const users = getUsers()
    const user = users[userId]
    if (!user || !user.providers || !user.providers[provider]) return null
    return {
      provider,
      id: user.providers[provider].id,
      email: user.providers[provider].email,
      username: user.providers[provider].username || null
    }
  }

  // Who may CREATE an account, for every sign-up path (password and single sign-on). Outside tests, registration stays closed until the operator sets
  // VESPR_AUTH_ALLOWED_DOMAINS, so a fresh deployment never opens sign-ups by accident; test suites default to open unless configured.
  // Returns null when allowed, otherwise { status, error }. Signing in to an account that already exists is never checked here.
  function registrationRefusal (email) {
    if (config.VESPR_AUTH_ALLOWED_DOMAINS === undefined && config.NODE_ENV !== 'test') {
      return { status: 403, error: 'Registrations are closed on this server (the operator has not set VESPR_AUTH_ALLOWED_DOMAINS)' }
    }
    const rawDomains = config.VESPR_AUTH_ALLOWED_DOMAINS !== undefined ? config.VESPR_AUTH_ALLOWED_DOMAINS : ''
    const allowedDomains = rawDomains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
    if (allowedDomains.length > 0 && !allowedDomains.includes('*')) {
      const domain = String(email || '').split('@')[1]?.trim().toLowerCase() // a provider may report "Kid@School.org"; the list is lower case
      if (!allowedDomains.includes(domain)) return { status: 403, error: `Registrations are restricted to: ${allowedDomains.join(', ')}` }
    }
    return null
  }

  // Status of configured providers
  function getProviders () {
    return {
      password: true,
      google: Boolean(oauthProviders.google || (config.VESPR_AUTH_GOOGLE_ID && config.VESPR_AUTH_GOOGLE_SECRET)),
      microsoft: Boolean(oauthProviders.microsoft || (config.VESPR_AUTH_MICROSOFT_ID && config.VESPR_AUTH_MICROSOFT_SECRET)),
      github: Boolean(oauthProviders.github || (config.VESPR_AUTH_GITHUB_ID && config.VESPR_AUTH_GITHUB_SECRET)),
      clever: Boolean(oauthProviders.clever || (config.VESPR_AUTH_CLEVER_ID && config.VESPR_AUTH_CLEVER_SECRET)),
      classlink: Boolean(oauthProviders.classlink || (config.VESPR_AUTH_CLASSLINK_ID && config.VESPR_AUTH_CLASSLINK_SECRET)),
      work: work.companies().some(c => work.ready(c)), // at least one company login set up (server/work.js)
      totp: true,
      sms: Boolean(smsTransport || config.VESPR_AUTH_TWILIO_SID && config.VESPR_AUTH_TWILIO_TOKEN && config.VESPR_AUTH_TWILIO_VERIFY_SID)
    }
  }

  // ── Cookies, CSRF and origin checks ────────────────────────────────────────
  const COOKIE_NAME = 'vespr_session'
  // Behind a reverse proxy every socket address is the proxy's: with VESPR_AUTH_TRUST_PROXY=1 the last X-Forwarded-For entry (the one the proxy appended) is the client,
  // and X-Forwarded-Proto says whether it was https. Off by default, so a client cannot choose its own address or scheme.
  const trustProxy = config.VESPR_AUTH_TRUST_PROXY === '1'
  const clientIpOf = req => {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean)
    return (trustProxy && fwd.length ? fwd[fwd.length - 1] : req.socket.remoteAddress) || '127.0.0.1'
  }
  const secureRequest = req => Boolean(req.socket.encrypted) || (trustProxy && req.headers['x-forwarded-proto'] === 'https') || String(config.VESPR_AUTH_BASE_URL || '').startsWith('https://')
  const baseUrlFor = req => String(config.VESPR_AUTH_BASE_URL || ((secureRequest(req) ? 'https' : 'http') + '://' + (req.headers.host || '127.0.0.1:8241'))).replace(/\/+$/, '')

  function parseCookies (req) {
    const out = {}
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=')
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
    }
    return out
  }

  function sessionCookie (req, rawToken, clear = false) {
    const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/', clear ? 'Max-Age=0' : `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`]
    if (secureRequest(req)) attrs.push('Secure')
    return `${COOKIE_NAME}=${clear ? '' : rawToken}; ${attrs.join('; ')}`
  }

  const safeEqual = (a, b) => {
    const x = Buffer.from(String(a)); const y = Buffer.from(String(b))
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }

  // Per-session CSRF token, derived from the session token so nothing extra is stored; /auth/me hands it to the page
  const csrfFor = rawToken => crypto.createHmac('sha256', 'vespr-csrf-v1').update(rawToken).digest('hex')

  // Bearer header first (not ambient, so exempt from CSRF), then the HttpOnly session cookie
  function sessionFromReq (req) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (bearer) return { token: bearer, viaCookie: false }
    const cookieToken = parseCookies(req)[COOKIE_NAME] || ''
    return { token: cookieToken, viaCookie: Boolean(cookieToken) }
  }

  // A cross-site page can make a browser POST here with the cookie attached; refuse any Origin that is not this site
  function originAllowed (req) {
    const origin = req.headers.origin
    if (!origin) return true
    let host
    try { host = new URL(origin).host } catch { return false }
    const extra = String(config.VESPR_AUTH_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
    return host === req.headers.host || extra.includes(origin)
  }

  // Signed-in user for a request, or null after answering 401/403. State-changing calls made with the cookie need the CSRF header.
  function requireUser (req, res, { write = false } = {}) {
    const { token, viaCookie } = sessionFromReq(req)
    const user = getSessionUser(token)
    if (!user) { jsonResponse(res, 401, { error: 'Unauthorized' }); return null }
    if (write && viaCookie && !safeEqual(req.headers['x-csrf-token'] || '', csrfFor(token))) {
      jsonResponse(res, 403, { error: 'Missing or invalid CSRF token' }); return null
    }
    return user
  }

  // Issue a 32-byte session token; only its SHA-256 is stored. Each session is one "device": it gets a random deviceId and a short label,
  // stored beside the hash (never the token), so a person can list their devices and sign one out.
  // One computer, one person (the team, 2026-11-05). The desktop app sends x-vespr-device: SHA-256 of a VESPR salt and the computer's
  // hardware ID (Windows MachineGuid, Mac IOPlatformUUID, Linux machine-id); the raw ID never leaves the computer. A computer takes at
  // most one personal and one business account, so signing out and in only switches between those two. Browsers send no key and
  // are not covered (they cannot be fingerprinted reliably, and trying would be invasive). Business = the account says so
  // (accountKind) or its email is not on a consumer mail domain.
  const bindingsFile = path.join(authDir, 'device-bindings.json')
  const CONSUMER = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'ymail.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'zoho.com', 'mail.com', 'yandex.com', 'fastmail.com', 'hey.com'])
  const accountKind = user => user.accountKind === 'business' || user.accountKind === 'personal' ? user.accountKind : (CONSUMER.has(String(user.email || '').split('@')[1] || '') ? 'personal' : 'business')
  function deviceGate (user, deviceKey) {
    const k = String(deviceKey || '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(k)) return null // no key: a browser or an older app
    const all = readJson(bindingsFile, {}); const b = all[k] || {}; const kind = accountKind(user)
    if (b[kind] && b[kind] !== user.id) {
      const other = getUsers()[b[kind]]
      return { status: 403, error: `This computer is already used by ${other ? other.name : 'another account'} for ${kind} work. One person per computer: signing out and in switches only between your personal and business accounts. The account it belongs to can release it in its settings.` }
    }
    if (!b[kind]) { all[k] = { ...b, [kind]: user.id, since: b.since || now() }; writeJsonAtomic(bindingsFile, all) }
    return null
  }
  // this computer's slot for the signed-in account is released (the account moves to another computer, or the computer changes hands)
  function releaseDevice (user, deviceKey) {
    const k = String(deviceKey || '').toLowerCase(); if (!/^[a-f0-9]{64}$/.test(k)) return false
    const all = readJson(bindingsFile, {}); const b = all[k]; if (!b) return false
    let changed = false; for (const kind of ['personal', 'business']) if (b[kind] === user.id) { delete b[kind]; changed = true }
    if (!changed) return false
    if (!b.personal && !b.business) delete all[k]; else all[k] = b
    writeJsonAtomic(bindingsFile, all); return true
  }

  function releaseAllDevices (userId) {
    const all = readJson(bindingsFile, {}); let changed = false
    for (const [k, b] of Object.entries(all)) { for (const kind of ['personal', 'business']) if (b[kind] === userId) { delete b[kind]; changed = true } if (!b.personal && !b.business) delete all[k] }
    if (changed) writeJsonAtomic(bindingsFile, all)
  }

  function issueSession (user, { label, installId, kind } = {}) {
    const rawSessionToken = crypto.randomBytes(32).toString('hex')
    const sessions = getSessions()
    sessions[sha256Hex(rawSessionToken)] = {
      userId: user.id, email: user.email, name: user.name, createdAt: now(), expiresAt: now() + (kind === 'device' ? APP_SESSION_TTL_MS : SESSION_TTL_MS),
      deviceId: crypto.randomBytes(8).toString('hex'), label: String(label || 'browser').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || 'browser',
      kind: kind === 'device' ? 'device' : 'browser', installId: typeof installId === 'string' ? installId.slice(0, 64) : null
    }
    saveSessions(sessions)
    return rawSessionToken
  }

  // ---- sign-out reaches what the session already opened ----
  // A session made before device ids existed gets a stable derived id (not the hash itself).
  const deviceIdOf = (sess, hash) => sess.deviceId || 'f' + sha256Hex('device:' + hash).slice(0, 15)
  const revokeListeners = new Set()
  function onRevoke (fn) { revokeListeners.add(fn); return () => revokeListeners.delete(fn) }
  function announceRevoked (userId, keys) {
    for (const fn of revokeListeners) { try { fn({ userId, keys }) } catch (e) { console.error('revoke listener failed:', e.message) } }
  }
  // The key websockets are grouped by: the stored session hash, only while the session is live. Null for static tokens and anything else.
  function sessionKey (rawToken) {
    if (!rawToken) return null
    const hash = sha256Hex(rawToken)
    const sess = getSessions()[hash]
    return sess && sess.expiresAt > now() ? hash : null
  }
  function sessionLive (hash) {
    const sess = getSessions()[hash]
    return Boolean(sess && sess.expiresAt > now())
  }
  function listDevices (userId, currentRawToken) {
    const mine = currentRawToken ? sha256Hex(currentRawToken) : null
    return Object.entries(getSessions())
      .filter(([, s]) => s.userId === userId && s.expiresAt > now())
      .map(([hash, s]) => ({ deviceId: deviceIdOf(s, hash), label: s.label || 'browser', kind: s.kind || 'browser', createdAt: s.createdAt, expiresAt: s.expiresAt, current: hash === mine }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  // Deleting the stored session is what makes a copied token useless: identify() finds nothing for it.
  function revokeDevice (userId, deviceId) {
    const sessions = getSessions()
    const keys = Object.entries(sessions).filter(([hash, s]) => s.userId === userId && deviceIdOf(s, hash) === deviceId).map(([hash]) => hash)
    if (!keys.length) return 0
    for (const k of keys) delete sessions[k]
    saveSessions(sessions)
    announceRevoked(userId, keys)
    return keys.length
  }
  // Revoke by the stored session key (what the desktop transaction remembers; it never keeps a token).
  function revokeSessionKey (hash) {
    const sessions = getSessions(); const sess = sessions[hash]
    if (!sess) return false
    delete sessions[hash]; saveSessions(sessions); announceRevoked(sess.userId, [hash])
    return true
  }
  function revokeToken (rawToken) {
    const hash = sha256Hex(rawToken || '')
    const sessions = getSessions()
    const sess = sessions[hash]
    if (!sess) return false
    delete sessions[hash]
    saveSessions(sessions)
    announceRevoked(sess.userId, [hash])
    return true
  }

  // Generic JSON response
  function jsonResponse (res, status, data, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      ...headers
    })
    res.end(JSON.stringify(data))
  }

  // Body parser helper (bounded 64KB)
  function parseBody (req) {
    return new Promise((resolve, reject) => {
      if (Number(req.headers['content-length'] || 0) > 0 && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
        return reject(new Error('JSON required')) // a plain HTML form cannot send application/json, so cross-site form posts fail here
      }
      let body = ''
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > 65536) {
          req.destroy()
          reject(new Error('Payload too large'))
        } else {
          body += chunk
        }
      })
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {})
        } catch {
          reject(new Error('Invalid JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  // Send the verification link through the injected mailer, or append it to a dev log file when there is none.
  // Returns what really happened: 'sent' (the transport accepted it), 'failed', or 'dev-log' (nothing was mailed).
  async function sendVerificationEmail (user, baseUrl) {
    const verifyToken = crypto.randomBytes(32).toString('hex')
    emailVerificationTokens.set(sha256Hex(verifyToken), {
      userId: user.id,
      email: user.email,
      expiresAt: now() + 24 * 60 * 60 * 1000
    })

    const verifyUrl = `${baseUrl}/verify-email.html?token=${verifyToken}`
    if (mailer) {
      try {
        await mailer.send({
          to: user.email,
          subject: 'Verify your VESPR account',
          text: `Welcome to VESPR! Please verify your email by clicking the link:\n\n${verifyUrl}\n\nThis link will expire in 24 hours.`
        })
        return { delivery: 'sent', verifyToken }
      } catch (err) {
        console.error('Failed to send verification email:', err.message)
        return { delivery: 'failed', verifyToken }
      }
    }
    // Append to dev log file outside public tree
    try {
      fs.appendFileSync(emailLogFile, `[${new Date(now()).toISOString()}] Verify ${user.email}: ${verifyUrl}\n`, { mode: 0o600 })
    } catch {}
    return { delivery: 'dev-log', verifyToken }
  }

  // Verify OIDC JWT ID token against JWKS
  async function verifyIdToken (idToken, jwksUri, expectedIss, expectedAud, expectedNonce) {
    const parts = idToken.split('.')
    if (parts.length !== 3) throw new Error('Malformed JWT')
    const [headerB64, payloadB64, sigB64] = parts

    const header = JSON.parse(base64urlDecode(headerB64).toString('utf8'))
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'))

    if (header.alg !== 'RS256') throw new Error(`Unsupported JWT algorithm: ${header.alg}`)

    // Fetch JWKS if not cached or expired (1 hour TTL)
    let jwks = jwksCache.get(jwksUri)
    if (!jwks || now() - jwks.fetchedAt > 60 * 60 * 1000) {
      let fetched = null
      if (fetcher) {
        try { fetched = await fetcher({ kind: 'jwks', url: jwksUri }) } catch {}
      }
      if (!fetched) {
        const resp = await httpRequest(jwksUri, { timeout: 10000 })
        if (resp.statusCode !== 200) throw new Error(`Failed to fetch JWKS: ${resp.statusCode}`)
        fetched = JSON.parse(resp.body)
      }
      jwks = fetched
      jwksCache.set(jwksUri, { keys: jwks.keys || (Array.isArray(jwks) ? jwks : [jwks]), fetchedAt: now() })
    }

    const keyList = jwks.keys || jwks
    const keyJwk = keyList.find(k => k.kid === header.kid)
    if (!keyJwk) throw new Error(`Signing key not found in JWKS for kid: ${header.kid}`)

    // Node built-in RSA verify
    const publicKey = crypto.createPublicKey({ key: keyJwk, format: 'jwk' })
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8')
    const signature = base64urlDecode(sigB64)

    const isValid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature)
    if (!isValid) throw new Error('Invalid JWT signature')

    // Validate claims
    const nowSec = Math.floor(now() / 1000)
    if (payload.exp && payload.exp < nowSec) throw new Error('JWT has expired')
    if (payload.nbf && payload.nbf > nowSec + 60) throw new Error('JWT not yet valid')

    if (expectedAud && payload.aud !== expectedAud) {
      throw new Error(`Audience mismatch: expected ${expectedAud}, got ${payload.aud}`)
    }

    if (expectedIss) {
      const issMatches = Array.isArray(expectedIss)
        ? expectedIss.some(iss => payload.iss === iss || payload.iss?.startsWith(iss))
        : (payload.iss === expectedIss || payload.iss?.startsWith(expectedIss))
      if (!issMatches) {
        throw new Error(`Issuer mismatch: expected ${expectedIss}, got ${payload.iss}`)
      }
    }

    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw new Error(`Nonce mismatch: expected ${expectedNonce}, got ${payload.nonce}`)
    }

    return payload
  }

  // Twilio SMS Verify API calls
  const twilioConfigured = () => Boolean(config.VESPR_AUTH_TWILIO_SID && config.VESPR_AUTH_TWILIO_TOKEN && config.VESPR_AUTH_TWILIO_VERIFY_SID)
  async function sendSms (toPhone) {
    if (smsTransport) return smsTransport.send(toPhone)
    if (!twilioConfigured()) throw new Error('SMS is not configured') // never reach for the network without credentials
    return twilioSendSms(toPhone)
  }
  async function checkSms (toPhone, code) {
    if (smsTransport) return Boolean(await smsTransport.check(toPhone, code))
    if (!twilioConfigured()) throw new Error('SMS is not configured')
    return twilioCheckSms(toPhone, code)
  }

  async function twilioSendSms (toPhone) {
    const sid = config.VESPR_AUTH_TWILIO_SID
    const token = config.VESPR_AUTH_TWILIO_TOKEN
    const verifySid = config.VESPR_AUTH_TWILIO_VERIFY_SID

    const postData = new URLSearchParams({ To: toPhone, Channel: 'sms' }).toString()
    const url = `https://verify.twilio.com/v2/Services/${verifySid}/Verifications`
    const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`

    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    }, postData)

    if (res.statusCode !== 200 && res.statusCode !== 201) {
      throw new Error(`Twilio send failed with status ${res.statusCode}`)
    }
    return JSON.parse(res.body)
  }

  async function twilioCheckSms (toPhone, code) {
    const sid = config.VESPR_AUTH_TWILIO_SID
    const token = config.VESPR_AUTH_TWILIO_TOKEN
    const verifySid = config.VESPR_AUTH_TWILIO_VERIFY_SID

    const postData = new URLSearchParams({ To: toPhone, Code: code }).toString()
    const url = `https://verify.twilio.com/v2/Services/${verifySid}/VerificationCheck`
    const authHeader = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`

    const res = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': authHeader,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    }, postData)

    if (res.statusCode !== 200) return false
    const json = JSON.parse(res.body)
    return json.status === 'approved' && json.valid === true
  }

  // ---- desktop sign-in return (server/desktop-auth.js) ----
  // Until the account-completion pages exist, no account has Terms, age or guardian facts, so the default admission is "blocked": the desktop return refuses
  // everyone with a clear reason instead of letting an incomplete account through. Tests and a later account-completion module inject admissionFor.
  const defaultAdmission = user => admit({
    identity: { authenticated: true, emailVerified: Boolean(user.emailVerified || user.school || user.work) }, // a school or a company login vouches for who its people are
    activation: user.activation || 'active',
    age: user.age || { claims: [] },
    terms: user.terms || { acceptedSha256: null },
    guardian: user.guardian || { state: 'not_required' },
    sponsor: user.sponsor || { required: false },
    org: { loginRequired: Boolean(lifecycle.lockState(user)) }
  }, {
    terms: { sha256: config.VESPR_TERMS_SHA256 || '', status: config.VESPR_TERMS_STATUS === 'published' ? 'published' : 'draft' },
    production: config.NODE_ENV === 'production',
    guardianMethods: String(config.VESPR_GUARDIAN_METHODS || '').split(',').map(x => x.trim()).filter(Boolean)
  })
  // Work sign-in (server/work.js): a company's own login. The account is found by the company's id for the person; else by the work email
  // when the company proved it owns that domain (unlike schools, whose emails are typed by admins); else a new work account.
  const work = createWork({ DATA, config, now, ...(workRequest ? { request: workRequest } : {}) })
  function workAccount ({ company, id, email, emailOwned, name, role, groups }) {
    if (!id || typeof id !== 'string' || id.length > 300) return { status: 401, error: 'The company login did not say who this is' }
    const key = 'work:' + company.id; const users = getUsers()
    const lk = lifecycle.lockFor(email); if (email && !lifecycle.lockAllows(lk, key)) return { status: 403, error: lifecycle.lockRefusal(lk) }
    let created = false
    let user = Object.values(users).find(u => u.providers?.[key]?.id === id)
    if (!user && email && emailOwned) {
      user = Object.values(users).find(u => String(u.email || '').toLowerCase() === email) || null
      if (user && ['suspended', 'deletion_requested'].includes(user.activation)) return { status: 403, error: 'This VESPR account is closed.' }
      if (user) { user.providers = user.providers || {}; user.providers[key] = { id, email } }
    }
    if (!user) {
      if (config.VESPR_AUTH_ALLOWED_DOMAINS === undefined && config.NODE_ENV !== 'test') return { status: 403, error: 'Sign-ups are closed on this server' }
      const taken = email && Object.values(users).some(u => String(u.email || '').toLowerCase() === email)
      const userId = crypto.randomBytes(16).toString('hex')
      user = {
        id: userId, email: email && !taken ? email : null, name: freeName(users, name || (email ? email.split('@')[0] : 'Member ' + userId.slice(0, 4))),
        passwordHash: null, salt: null, emailVerified: Boolean(email && emailOwned && !taken), accountKind: 'business', createdAt: now(), updatedAt: now(), roles: ['member'],
        providers: { [key]: { id, email } }, totp: { enabled: false }, sms: { enabled: false }, recoveryCodes: []
      }
      users[userId] = user; created = true
    }
    if (['suspended', 'deletion_requested'].includes(user.activation)) return { status: 403, error: 'This VESPR account is closed.' }
    lifecycle.applyWork(user, company, { groups: groups || [], role }, { only: created }) // role, groups, the company's rules -> rights
    user.updatedAt = now(); saveUsers(users)
    return { user }
  }

  const desktopFile = path.join(authDir, 'desktop-tx.json')
  const desktop = createDesktopAuth({
    store: { load: () => readJson(desktopFile, { txs: {} }), save: v => writeJsonAtomic(desktopFile, v) },
    now, getUser: id => getUsers()[id] || null, providers: getProviders,
    admissionFor: admissionFor || defaultAdmission,
    issueSession, revokeSessionKey, sessionKeyOf: raw => sha256Hex(raw), gate: (user, i) => deviceGate(user, i && i.deviceKey)
  })

  // A school sign-in (key: 'clever', 'classlink' or 'lti:<platform>'): find the account by the school's id for the person; else make a
  // school account. The school's email is kept only if no VESPR account has it already (then the account has none: never a way into
  // someone else's account). No email needed (kids). Sign-ups must be open on this server at all (VESPR_AUTH_ALLOWED_DOMAINS set).
  // staff: the school says this person is a teacher or other staff: an adult on the school's word (school_roster), no approval needed.
  // Everyone else from a school waits for a teacher or parent (admission "awaiting_adult", server/sponsor.js).
  function schoolAccount ({ key, id, email, name, via, staff = false, extra = {} }) {
    if (!id || typeof id !== 'string' || id.length > 300) return { status: 401, error: 'The school did not say who this is' }
    const users = getUsers()
    const lk = lifecycle.lockFor(email); if (email && !lifecycle.lockAllows(lk, key)) return { status: 403, error: lifecycle.lockRefusal(lk) }
    let user = Object.values(users).find(u => u.providers?.[key]?.id === id)
    if (user) return ['suspended', 'deletion_requested'].includes(user.activation) ? { status: 403, error: 'This VESPR account is closed.' } : { user }
    if (config.VESPR_AUTH_ALLOWED_DOMAINS === undefined && config.NODE_ENV !== 'test') return { status: 403, error: 'Sign-ups are closed on this server' }
    const mail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? String(email).toLowerCase() : null
    const taken = mail && Object.values(users).some(u => String(u.email || '').toLowerCase() === mail)
    const userId = crypto.randomBytes(16).toString('hex')
    user = {
      id: userId, email: taken ? null : mail, name: freeName(users, name || (mail && !taken ? mail.split('@')[0] : 'Student ' + userId.slice(0, 4))),
      passwordHash: null, salt: null, emailVerified: false, school: { via, staff: Boolean(staff), ...extra }, createdAt: now(), updatedAt: now(), roles: ['member'],
      sponsor: { required: !staff, state: staff ? 'not_needed' : 'pending' }, ...(staff ? { age: { claims: [{ band: 'adult', source: 'school_roster', at: now() }] } } : {}),
      providers: { [key]: { id, email: mail } }, totp: { enabled: false }, sms: { enabled: false }, recoveryCodes: []
    }
    users[userId] = user; saveUsers(users)
    return { user, created: true }
  }

  // Auto sign-in: which sign-in a school email or school name uses (server/discover.js)
  const discover = createDiscover({ DATA, config, now, providers: getProviders, companies: () => work.companies(), ready: c => work.ready(c), ...(discoverDeps || {}) })

  // An account's life after sign-in (server/lifecycle.js): security changes, the daily check of company logins, termination, deletion,
  // domain lock. Started by index.js (lifecycle.start()); the daily check runs hourly over whoever is due.
  const vault = createVault({ DATA, config })
  const handles = createHandles({ getUsers, saveUsers }) // the public name friends and direct messages use (server/handles.js)
  const orgPolicy = createOrgPolicy({ DATA, getUser: token => getSessionUser(token) }) // account kind and the organization's file/folder rules (server/orgpolicy.js)
  const lifecycle = createLifecycle({ DATA, now, vault, getUsers, saveUsers, getSessions, saveSessions, announceRevoked, work, schools: () => discover.schools(), releaseDevices: releaseAllDevices, forgetConnectors: userId => connectors.forgetAll(userId) })

  // A grown-up approves a kid's account (server/sponsor.js)
  const sponsor = createSponsor({ now, getUsers, saveUsers, admissionFor: user => (admissionFor || defaultAdmission)(user) })

  // LTI 1.3 (server/lti.js): Canvas and D2L courses open VESPR with the student already signed in
  const lti = createLti({
    DATA, config, now, ...(ltiRequest ? { request: ltiRequest } : {}),
    signIn: async ({ platform, sub, email, name, roles }) => {
      const staff = roles.some(r => ['Instructor', 'Administrator', 'TeachingAssistant', 'ContentDeveloper'].includes(r))
      const r = schoolAccount({ key: 'lti:' + platform.id, id: sub, email, name, via: platform.name, staff, extra: { roles } })
      return r.user ? { token: issueSession(r.user, { label: platform.name }) } : { error: r.error }
    }
  })

  // Connectors (server/connectors.js): Google Drive, Gmail, GitHub, Slack, ... linked to the account; only for admitted accounts, mail for adults only
  const latestBand = user => { const c = ((user && user.age && user.age.claims) || []).filter(x => x && x.band); return c.length ? c[c.length - 1].band : null }
  const connectors = createConnectors({
    DATA, config, now, getUser: id => getUsers()[id] || null, ...(connectorRequest ? { request: connectorRequest } : {}),
    isMinor: user => ['under13', '13-17'].includes(latestBand(user)),
    mayConnect: user => ((admissionFor || defaultAdmission)(user).state === 'active' ? null : 'Finish setting up your account first (your age and the Terms).')
  })

  return {
    identify,
    orgPolicy,
    handles,
    desktop,
    connectors,
    lti,
    lifecycle,
    sessionKey,
    sessionLive,
    onRevoke,
    listDevices,
    revokeDevice,
    revokeToken,
    getSessionUser,
    getLinkedIdentity,
    getProviders,
    getUsers,
    getSessions,
    verifyIdToken,

    async http (req, res) {
      const u = new URL(req.url, 'http://localhost')
      if (!u.pathname.startsWith('/auth/')) return false

      const clientIp = clientIpOf(req)

      if (u.pathname === '/auth/discover') {
        if (await discover.http(req, res, u, { jsonResponse, clientIp })) return true
      }

      if (u.pathname.startsWith('/auth/lti/')) {
        if (await lti.http(req, res, u, { baseUrl: baseUrlFor(req), jsonResponse })) return true
      }

      // Every state-changing call: refuse a cross-site Origin before anything else
      if (req.method === 'POST' && !originAllowed(req)) {
        return jsonResponse(res, 403, { error: 'Cross-site request refused' }), true
      }

      // POST /auth/account/delete { confirm: 'delete' }: the person deletes their account; access ends everywhere at once
      if (req.method === 'POST' && u.pathname === '/auth/account/delete') {
        const user = requireUser(req, res, { write: true }); if (!user) return true
        let body = {}; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        if (String(body.confirm || '').toLowerCase() !== 'delete') return jsonResponse(res, 400, { error: 'Send confirm: "delete" to delete this account' }), true
        await lifecycle.deleteAccount(user.id)
        return jsonResponse(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', true) }), true
      }

      if (u.pathname.startsWith('/auth/sponsor/')) {
        if (await sponsor.http(req, res, u, { requireUser, parseBody, jsonResponse })) return true
      }

      if (u.pathname === '/auth/connectors' || u.pathname.startsWith('/auth/connectors/')) {
        if (await connectors.http(req, res, u, { requireUser, parseBody, jsonResponse, baseUrl: baseUrlFor(req), cookieUser: r => getSessionUser(parseCookies(r)[COOKIE_NAME] || ''), cookies: parseCookies(req), secure: secureRequest(req) })) return true
      }

      // GET /auth/providers
      if (req.method === 'GET' && u.pathname === '/auth/providers') {
        jsonResponse(res, 200, getProviders())
        return true
      }

      // POST /auth/register
      if (req.method === 'POST' && u.pathname === '/auth/register') {
        const regKey = `reg:ip:${clientIp}`
        if (isRateLimited(regKey)) return lockedResponse(res, 'Too many sign-up attempts from this address. Please wait.', regKey), true
        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }

        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        const name = (String(body.name || '').trim() || email.split('@')[0]).replace(/\s+/g, ' ').slice(0, 60)

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return jsonResponse(res, 400, { error: 'Invalid email address' }), true
        }

        if (password.length < 10) {
          return jsonResponse(res, 400, { error: 'Password must be at least 10 characters long' }), true
        }

        // Domain restriction (e.g. example.com, or * for anyone); the same gate guards single sign-on sign-ups below
        const refusal = registrationRefusal(email)
        if (refusal) return jsonResponse(res, refusal.status, { error: refusal.error }), true
        { const lk = lifecycle.lockFor(email); if (lk) return jsonResponse(res, 403, { error: lifecycle.lockRefusal(lk) }), true }

        const users = getUsers()
        const existing = Object.values(users).find(u => u.email === email)
        if (existing) {
          return jsonResponse(res, 409, { error: 'An account with this email already exists' }), true
        }
        if (nameTaken(users, name)) {
          return jsonResponse(res, 409, { error: 'That name is taken. Pick another one: it is how people and agents see you in a workspace.', field: 'name' }), true
        }

        const { hash, salt } = hashPassword(password)
        const userId = crypto.randomBytes(16).toString('hex')
        const autoVerify = Boolean(config.VESPR_AUTH_SKIP_VERIFY === '1')

        const newUser = {
          id: userId,
          email,
          name,
          passwordHash: hash,
          salt,
          emailVerified: autoVerify,
          createdAt: now(),
          updatedAt: now(),
          roles: ['member'],
          providers: {},
          totp: { enabled: false, secret: null, lastStep: 0 },
          sms: { enabled: false, phone: null },
          recoveryCodes: []
        }

        users[userId] = newUser
        saveUsers(users)
        recordFailure(regKey) // counts sign-ups per address: 5 per 15 minutes

        let mailDelivery = 'not-needed'
        if (!autoVerify) {
          mailDelivery = (await sendVerificationEmail(newUser, baseUrlFor(req))).delivery
        }

        return jsonResponse(res, 201, {
          ok: true,
          userId,
          email,
          emailVerified: newUser.emailVerified,
          mailDelivery
        }), true
      }

      // GET /auth/verify-email?token=...
      if (req.method === 'GET' && u.pathname === '/auth/verify-email') {
        const token = sha256Hex(u.searchParams.get('token') || '')
        const record = emailVerificationTokens.get(token)
        if (!record || record.expiresAt < now()) {
          return jsonResponse(res, 400, { error: 'Verification link is invalid or has expired' }), true
        }
        emailVerificationTokens.delete(token)

        const users = getUsers()
        const user = users[record.userId]
        if (user) {
          user.emailVerified = true
          user.updatedAt = now()
          saveUsers(users)
        }

        return jsonResponse(res, 200, { ok: true, emailVerified: true, message: 'Email successfully verified' }), true
      }

      // POST /auth/resend-verification: same answer whether or not the account exists (no enumeration)
      if (req.method === 'POST' && u.pathname === '/auth/resend-verification') {
        const resendKey = `resend:ip:${clientIp}`
        if (isRateLimited(resendKey)) return lockedResponse(res, 'Too many requests. Please wait.', resendKey), true
        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const email = String(body.email || '').trim().toLowerCase()
        recordFailure(resendKey)
        const target = Object.values(getUsers()).find(x => x.email === email)
        let mailDelivery = 'none'
        if (target && !target.emailVerified) mailDelivery = (await sendVerificationEmail(target, baseUrlFor(req))).delivery
        return jsonResponse(res, 200, { ok: true, mailDelivery: target ? mailDelivery : 'none' }), true
      }

      // POST /auth/login
      if (req.method === 'POST' && u.pathname === '/auth/login') {
        const ipKey = `ip:${clientIp}`
        if (isRateLimited(ipKey)) {
          return lockedResponse(res, 'Too many failed login attempts. Please wait 15 minutes.', ipKey), true
        }

        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }

        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        const code = String(body.code || '').trim()
        const recoveryCode = String(body.recoveryCode || '').trim()

        const userKey = `user:${email}`
        if (isRateLimited(userKey)) {
          return lockedResponse(res, 'Too many failed login attempts. Please wait 15 minutes.', userKey), true
        }

        const users = getUsers()
        const user = Object.values(users).find(u => u.email === email)

        // Prevent timing attacks & user enumeration: verify dummy password if user not found
        const dummySalt = '00000000000000000000000000000000'
        const dummyHash = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
        const passwordMatches = user && user.passwordHash
          ? verifyPassword(password, user.passwordHash, user.salt)
          : (verifyPassword(password, dummyHash, dummySalt), false)

        if (!user || !passwordMatches) {
          recordFailure(ipKey)
          recordFailure(userKey)
          return jsonResponse(res, 401, { error: 'Invalid email or password' }), true
        }
        if (['suspended', 'deletion_requested'].includes(user.activation)) return jsonResponse(res, 403, { error: 'This VESPR account is closed.' }), true
        { const lk = lifecycle.lockFor(user.email); if (lk) return jsonResponse(res, 403, { error: lifecycle.lockRefusal(lk) }), true }

        // Require email verification unless skip is configured
        if (!user.emailVerified && config.VESPR_AUTH_SKIP_VERIFY !== '1') {
          return jsonResponse(res, 403, { error: 'Please verify your email address before signing in.' }), true
        }

        // 2FA Verification if enabled
        const hasTotp = Boolean(user.totp && user.totp.enabled)
        const hasSms = Boolean(user.sms && user.sms.enabled)
        const useSms = hasSms && (!hasTotp || body.method === 'sms')

        if (hasTotp || hasSms) {
          if (recoveryCode) {
            // Verify single-use recovery code
            const hashedRecovery = sha256Hex(recoveryCode.replace(/[\s-]/g, '').toUpperCase())
            const matchIndex = user.recoveryCodes.reduce((found, h, i) => (safeEqual(h, hashedRecovery) && found === -1 ? i : found), -1)
            if (matchIndex === -1) {
              recordFailure(ipKey)
              recordFailure(userKey)
              return jsonResponse(res, 401, { error: 'Invalid recovery code' }), true
            }
            // Burn the single-use recovery code
            user.recoveryCodes.splice(matchIndex, 1)
            saveUsers(users)
          } else if (!code) {
            // Prompt for 2FA code; for SMS the code is sent now, and only the response says so if the transport accepted it
            let smsSent
            if (useSms) {
              const numKey = `sms:num:${user.sms.phone}`
              const smsIpKey = `sms:ip:${clientIp}`
              if (isRateLimited(numKey) || isRateLimited(smsIpKey)) {
                return lockedResponse(res, 'Too many SMS requests. Please wait a few minutes.', numKey, smsIpKey), true
              }
              try {
                await sendSms(user.sms.phone)
                recordFailure(numKey)
                recordFailure(smsIpKey)
                smsSent = true
              } catch {
                return jsonResponse(res, 502, { error: 'Could not send the SMS code. Try again later or use a recovery code.' }), true
              }
            }
            return jsonResponse(res, 200, {
              require2fa: true,
              method: useSms ? 'sms' : 'totp',
              alsoSms: hasTotp && hasSms ? true : undefined,
              smsSent,
              phoneHint: useSms ? `***-***-${user.sms.phone?.slice(-4) || '****'}` : undefined
            }), true
          } else {
            let valid = false
            if (!useSms) {
              const verifiedStep = hasTotp ? verifyTOTP(code, user.totp.secret, Math.floor(now() / 1000)) : false
              // Replay guard: must be strictly greater than last used step
              if (verifiedStep !== false && verifiedStep > (user.totp.lastStep || 0)) {
                valid = true
                user.totp.lastStep = verifiedStep
                saveUsers(users)
              }
            } else {
              try {
                valid = await checkSms(user.sms.phone, code)
              } catch {
                valid = false
              }
            }

            if (!valid) {
              recordFailure(ipKey)
              recordFailure(userKey)
              return jsonResponse(res, 401, { error: 'Invalid 2FA verification code' }), true
            }
          }
        }

        // Successful authentication
        clearFailure(ipKey)
        clearFailure(userKey)

        const dg = deviceGate(user, req.headers['x-vespr-device'])
        if (dg) return jsonResponse(res, dg.status, { error: dg.error, code: 'device_bound' }), true
        const rawSessionToken = issueSession(user, { label: body.deviceLabel })

        return jsonResponse(res, 200, {
          ok: true,
          token: rawSessionToken,
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        }, { 'Set-Cookie': sessionCookie(req, rawSessionToken) }), true
      }

      // GET /auth/me
      if (req.method === 'GET' && u.pathname === '/auth/me') {
        const { token } = sessionFromReq(req)
        const user = requireUser(req, res)
        if (!user) return true

        return jsonResponse(res, 200, {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            emailVerified: user.emailVerified,
            has2fa: Boolean((user.totp && user.totp.enabled) || (user.sms && user.sms.enabled)),
            totpEnabled: Boolean(user.totp && user.totp.enabled),
            smsEnabled: Boolean(user.sms && user.sms.enabled),
            providers: Object.keys(user.providers || {}),
            handle: handles.ensure(user),
            accountKind: accountKindOf(user), // 'personal' | 'company' | 'school'
            ...(accountKindOf(user) === 'personal' ? {} : { orgPolicy: orgPolicy.policyFor(user) }) // fail closed: false until an admin of the organization turns it on
          },
          csrfToken: csrfFor(token)
        }), true
      }

      // POST /auth/logout
      if (req.method === 'POST' && u.pathname === '/auth/logout') {
        const { token, viaCookie } = sessionFromReq(req)
        if (viaCookie && !safeEqual(req.headers['x-csrf-token'] || '', csrfFor(token))) {
          return jsonResponse(res, 403, { error: 'Missing or invalid CSRF token' }), true
        }
        if (token) revokeToken(token) // also closes the sockets this session opened (see onRevoke)
        return jsonResponse(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', true) }), true
      }

      // GET /auth/devices: the caller's own signed-in devices (never tokens or hashes)
      if (req.method === 'GET' && u.pathname === '/auth/devices') {
        const { token } = sessionFromReq(req)
        const user = requireUser(req, res)
        if (!user) return true
        return jsonResponse(res, 200, { devices: listDevices(user.id, token) }), true
      }

      // POST /auth/devices/revoke { deviceId }: sign one of the caller's own devices out, now
      if (req.method === 'POST' && u.pathname === '/auth/devices/revoke') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true
        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const deviceId = String(body.deviceId || '')
        if (!deviceId) return jsonResponse(res, 400, { error: 'deviceId is required' }), true
        const revoked = revokeDevice(user.id, deviceId)
        if (!revoked) return jsonResponse(res, 404, { error: 'No such device' }), true // someone else's device looks the same as none
        return jsonResponse(res, 200, { ok: true, revoked }), true
      }

      // POST /auth/device/release   the signed-in account frees this computer's slot (desktop app: the x-vespr-device header)
      if (req.method === 'POST' && u.pathname === '/auth/device/release') {
        const { token } = sessionFromReq(req); const sess = token ? getSessions()[sha256Hex(token)] : null
        const user = sess && sess.expiresAt > now() ? getUsers()[sess.userId] : null
        if (!user) return jsonResponse(res, 401, { error: 'Sign in first' }), true
        return jsonResponse(res, 200, { released: releaseDevice(user, req.headers['x-vespr-device']) }), true
      }

      // GET /auth/session: what the client asks on launch. A blocked account still gets 200 with its state (the client needs it to show the right screen);
      // the server enforces the same state on every protected route, so hiding a control is never the control.
      if (req.method === 'GET' && u.pathname === '/auth/session') {
        const { token } = sessionFromReq(req)
        const user = requireUser(req, res)
        if (!user) return true
        const a = (admissionFor || defaultAdmission)(user)
        const device = listDevices(user.id, token).find(d => d.current) || null
        return jsonResponse(res, 200, {
          user: { id: user.id, name: user.name },
          admission: { state: a.state, next: a.next || null, capabilities: a.capabilities || [], restrictions: a.restrictions || {} },
          device: device && { deviceId: device.deviceId, label: device.label, kind: device.kind, current: true }
        }), true
      }

      // ---- desktop sign-in return: the app starts a transaction, the website completes it, the app exchanges the one-use code ----
      // POST /auth/desktop/transactions   (no login: the app is not signed in yet; rate limited per address)
      if (req.method === 'POST' && u.pathname === '/auth/desktop/transactions') {
        let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const r = desktop.create({ ...body, ip: clientIp })
        if (r.status === 201) {
          const page = String(config.VESPR_DESKTOP_SIGNIN_URL || '') // the website page that shows "Sign in to VESPR on <device>?"; the id travels in the fragment, never a query
          r.body.browserUrl = page ? `${page}#tx=${r.body.txId}` : null
        }
        return jsonResponse(res, r.status, r.body), true
      }
      // GET /auth/desktop/transactions/<id>   what the website's confirmation page may show (device label, provider, times; nothing secret)
      const txMatch = /^\/auth\/desktop\/transactions\/([A-Za-z0-9_-]{20,100})$/.exec(u.pathname)
      if (req.method === 'GET' && txMatch) {
        const r = desktop.preview(txMatch[1]); return jsonResponse(res, r.status, r.body), true
      }
      // Account completion (the step defaultAdmission waits for). GET: where this account stands. POST { ageBand, acceptTerms }:
      // a self-declared age band ('under13' | '13-17' | 'adult'; a stricter claim from a provider or school stays), then, once the age is
      // settled, acceptance of the current Terms (stored as the hash of the exact text, VESPR_TERMS_SHA256). admission.js decides the rest:
      // minors stay guardian-pending until a configured method verifies a guardian; draft Terms are refused in production.
      if ((req.method === 'GET' || req.method === 'POST') && u.pathname === '/auth/account/facts') {
        const user = requireUser(req, res, { write: req.method === 'POST' })
        if (!user) return true
        const termsInfo = { available: Boolean(config.VESPR_TERMS_SHA256), status: config.VESPR_TERMS_STATUS === 'published' ? 'published' : 'draft' }
        const standing = u2 => { const a = (admissionFor || defaultAdmission)(u2); const sp = u2.sponsor || {}; return { state: a.state, next: a.next || null, reasons: a.reasons || [], terms: termsInfo, school: u2.school ? u2.school.via : null, sponsor: sp.state === 'approved' && sp.by ? { name: sp.by.name, role: sp.by.role } : null, org: (lk => lk ? { name: lk.org, how: lk.how } : null)(lifecycle.lockState(u2)) } }
        if (req.method === 'GET') return jsonResponse(res, 200, standing(user)), true
        let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const users = getUsers(); const rec = users[user.id]; if (!rec) return jsonResponse(res, 404, { error: 'No such account' }), true
        // check everything first, change after (the account list is shared in memory: a refused request must leave no trace)
        if (body.ageBand !== undefined && !['under13', '13-17', 'adult'].includes(body.ageBand)) return jsonResponse(res, 400, { error: 'ageBand is under13, 13-17 or adult' }), true
        const hasAge = body.ageBand !== undefined || Boolean(rec.age && (rec.age.claims || []).length)
        if (body.acceptTerms === true && !config.VESPR_TERMS_SHA256) return jsonResponse(res, 409, { error: 'There are no Terms to accept on this server yet', terms: termsInfo }), true
        if (body.acceptTerms === true && !hasAge) return jsonResponse(res, 400, { error: 'Say your age first' }), true
        if (body.ageBand !== undefined) {
          const others = ((rec.age && rec.age.claims) || []).filter(c => c && c.source !== 'self_declared')
          rec.age = { claims: [...others, { band: body.ageBand, source: 'self_declared', at: now() }] }
        }
        if (body.acceptTerms === true) rec.terms = { acceptedSha256: String(config.VESPR_TERMS_SHA256), at: now() }
        rec.updatedAt = now(); saveUsers(users)
        return jsonResponse(res, 200, standing(rec)), true
      }

      // POST /auth/desktop/complete { txId }   the signed-in browser says "this is me": a code goes back to the app only if admission lets the person in
      if (req.method === 'POST' && u.pathname === '/auth/desktop/complete') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true
        let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const r = desktop.complete(user, String(body.txId || '')); return jsonResponse(res, r.status, r.body), true
      }
      // POST /auth/desktop/exchanges { txId, code, verifier, installId }   the app trades the code for a device session
      if (req.method === 'POST' && u.pathname === '/auth/desktop/exchanges') {
        const xKey = `desktop:exchange:${clientIp}`
        if (isRateLimited(xKey)) return lockedResponse(res, 'Too many attempts. Please wait.', xKey), true
        let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const r = desktop.exchange({ ...body, deviceKey: req.headers['x-vespr-device'] })
        if (r.status !== 200) recordFailure(xKey)
        return jsonResponse(res, r.status, r.body), true
      }
      // POST /auth/desktop/cancel { txId, verifier? }
      if (req.method === 'POST' && u.pathname === '/auth/desktop/cancel') {
        let body; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
        const r = desktop.cancel(body); return jsonResponse(res, r.status, r.body), true
      }

      // POST /auth/2fa/totp/setup
      if (req.method === 'POST' && u.pathname === '/auth/2fa/totp/setup') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true

        const secretBytes = crypto.randomBytes(20)
        const secret = base32Encode(secretBytes)
        const issuer = encodeURIComponent('VESPR')
        const account = encodeURIComponent(user.email)
        const qrUri = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`

        updateUser(user.id, u => {
          u.totp = { ...u.totp, pendingSecret: secret }
        })

        return jsonResponse(res, 200, { secret, qrUri }), true
      }

      // POST /auth/2fa/totp/verify
      if (req.method === 'POST' && u.pathname === '/auth/2fa/totp/verify') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true

        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }

        const code = String(body.code || '').trim()
        const secret = user.totp?.pendingSecret || user.totp?.secret
        if (!secret) return jsonResponse(res, 400, { error: 'No TOTP setup in progress' }), true

        const totpKey = `totp:setup:${user.id}`
        if (isRateLimited(totpKey)) return lockedResponse(res, 'Too many wrong codes. Please wait 15 minutes.', totpKey), true
        const step = verifyTOTP(code, secret, Math.floor(now() / 1000))
        if (step === false) {
          recordFailure(totpKey)
          return jsonResponse(res, 400, { error: 'Invalid verification code' }), true
        }
        clearFailure(totpKey)

        // Generate 10 single-use recovery codes
        const rawRecoveryCodes = []
        const hashedRecoveryCodes = []
        for (let i = 0; i < 10; i++) {
          const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
          rawRecoveryCodes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
          hashedRecoveryCodes.push(sha256Hex(raw))
        }

        updateUser(user.id, u => {
          u.totp = {
            enabled: true,
            secret,
            lastStep: step
          }
          delete u.totp.pendingSecret
          u.recoveryCodes = hashedRecoveryCodes
        })
        lifecycle.securityChange(user.id, 'two-step sign-in turned on (app)', { keep: sha256Hex(sessionFromReq(req).token || '') })

        return jsonResponse(res, 200, {
          ok: true,
          recoveryCodes: rawRecoveryCodes
        }), true
      }

      // POST /auth/2fa/sms/send
      if (req.method === 'POST' && u.pathname === '/auth/2fa/sms/send') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true

        if (!user.emailVerified && config.VESPR_AUTH_SKIP_VERIFY !== '1') {
          return jsonResponse(res, 403, { error: 'A verified email is required before configuring SMS 2FA.' }), true
        }

        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }

        const phone = String(body.phone || '').trim().replace(/[\s()-]/g, '')
        if (!phone.startsWith('+') || phone.length < 10) {
          return jsonResponse(res, 400, { error: 'Valid E.164 phone number required (e.g. +14155552671)' }), true
        }

        // Country code allow-list (default: +1 for US/Canada)
        const allowedPrefixes = (config.VESPR_AUTH_SMS_COUNTRY_CODES || '+1').split(',').map(s => s.trim())
        if (!allowedPrefixes.some(pfx => phone.startsWith(pfx))) {
          return jsonResponse(res, 403, { error: `SMS 2FA is restricted to numbers with prefix: ${allowedPrefixes.join(', ')}` }), true
        }

        // Rate-limit sends per number and per IP to prevent toll fraud/pumping
        const numKey = `sms:num:${phone}`
        const ipKey = `sms:ip:${clientIp}`
        if (isRateLimited(numKey) || isRateLimited(ipKey)) {
          return jsonResponse(res, 429, { error: 'Too many SMS requests. Please wait a few minutes.' }), true
        }

        try {
          await sendSms(phone)
          recordFailure(numKey)
          recordFailure(ipKey)

          updateUser(user.id, u => {
            u.sms = { ...u.sms, pendingPhone: phone }
          })

          return jsonResponse(res, 200, { ok: true, message: 'Verification code sent via SMS.' }), true
        } catch (err) {
          return jsonResponse(res, 502, { error: 'Failed to send SMS verification' }), true
        }
      }

      // POST /auth/2fa/sms/verify
      if (req.method === 'POST' && u.pathname === '/auth/2fa/sms/verify') {
        const user = requireUser(req, res, { write: true })
        if (!user) return true

        let body
        try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }

        // Only the number a code was sent to: a caller must not be able to confirm some other number
        const phone = String(user.sms?.pendingPhone || '')
        const code = String(body.code || '').trim()
        const smsVerifyKey = `sms:verify:${user.id}`
        if (!phone) return jsonResponse(res, 400, { error: 'Send a code to a phone number first' }), true
        if (!/^\d{4,10}$/.test(code)) return jsonResponse(res, 400, { error: 'Enter the numeric code from the SMS' }), true
        if (isRateLimited(smsVerifyKey)) return lockedResponse(res, 'Too many wrong codes. Please wait 15 minutes.', smsVerifyKey), true

        let approved = false
        try {
          approved = await checkSms(phone, code)
        } catch {
          approved = false
        }

        if (!approved) {
          recordFailure(smsVerifyKey)
          return jsonResponse(res, 400, { error: 'Invalid or expired SMS verification code' }), true
        }
        clearFailure(smsVerifyKey)

        // Generate 10 single-use recovery codes
        const rawRecoveryCodes = []
        const hashedRecoveryCodes = []
        for (let i = 0; i < 10; i++) {
          const raw = crypto.randomBytes(5).toString('hex').toUpperCase()
          rawRecoveryCodes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`)
          hashedRecoveryCodes.push(sha256Hex(raw))
        }

        updateUser(user.id, u => {
          u.sms = {
            enabled: true,
            phone
          }
          u.recoveryCodes = hashedRecoveryCodes
        })
        lifecycle.securityChange(user.id, 'two-step sign-in turned on (text message)', { keep: sha256Hex(sessionFromReq(req).token || '') })

        return jsonResponse(res, 200, {
          ok: true,
          recoveryCodes: rawRecoveryCodes
        }), true
      }

      // Work sign-in: GET /auth/start/work/<company> -> the company's login; GET /auth/callback/work <- back (server/work.js)
      const workStart = /^\/auth\/start\/work\/([a-z0-9-]{1,40})$/.exec(u.pathname)
      if (req.method === 'GET' && workStart) {
        const nextUrl = u.searchParams.get('next') || '/prototype.html'
        if (!isAllowedNext(nextUrl)) return jsonResponse(res, 400, { error: 'Invalid or unapproved redirect target' }), true
        const r = await work.start(workStart[1], { base: baseUrlFor(req), next: nextUrl, hint: u.searchParams.get('login_hint') })
        if (!r.redirect) return jsonResponse(res, r.status, { error: r.error }), true
        res.writeHead(302, { Location: r.redirect, 'Set-Cookie': `vespr_work_state=${r.state}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secureRequest(req) ? '; Secure' : ''}` })
        res.end(); return true
      }
      if (req.method === 'GET' && u.pathname === '/auth/callback/work') {
        const r = await work.finish(u.searchParams, parseCookies(req).vespr_work_state || '')
        const clear = 'vespr_work_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0'
        if (!r.company) return jsonResponse(res, r.status, { error: r.error }, { 'Set-Cookie': clear }), true
        const acc = workAccount(r)
        if (!acc.user) return jsonResponse(res, acc.status, { error: acc.error }, { 'Set-Cookie': clear }), true
        lifecycle.keepLasting(acc.user.id, r.company.id, r.lasting) // for the daily check
        const raw = issueSession(acc.user)
        res.writeHead(302, { Location: `${r.next}#token=${raw}`, 'Set-Cookie': [sessionCookie(req, raw), clear] }); res.end(); return true
      }

      // OAuth Start: GET /auth/start/<provider>?next=<url>
      const startMatch = /^\/auth\/start\/(google|microsoft|github|clever|classlink)$/.exec(u.pathname)
      if (req.method === 'GET' && startMatch) {
        const provider = startMatch[1]
        const providers = getProviders()
        if (!providers[provider]) {
          return jsonResponse(res, 404, { error: `Provider ${provider} is not configured.` }), true
        }

        const nextUrl = u.searchParams.get('next') || '/prototype.html'
        if (!isAllowedNext(nextUrl)) {
          return jsonResponse(res, 400, { error: 'Invalid or unapproved redirect target' }), true
        }

        const stateKey = crypto.randomBytes(24).toString('hex')
        const nonce = crypto.randomBytes(16).toString('hex')
        const codeVerifier = base64url(crypto.randomBytes(32))
        const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())

        oauthStates.set(stateKey, {
          provider,
          next: nextUrl,
          codeVerifier,
          nonce,
          expiresAt: now() + STATE_TTL_MS
        })

        let authUrl = ''
        const callbackUrl = `${baseUrlFor(req)}/auth/callback/${provider}`
        const hintRaw = u.searchParams.get('login_hint') || ''
        const loginHint = /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(hintRaw) ? `&login_hint=${encodeURIComponent(hintRaw)}` : ''

        if (oauthProviders[provider]) {
          authUrl = oauthProviders[provider].authorizeUrl({ state: stateKey, nonce, codeChallenge, redirectUri: callbackUrl })
        } else if (provider === 'google') {
          const clientId = config.VESPR_AUTH_GOOGLE_ID
          authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=openid%20email%20profile&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateKey}&nonce=${nonce}&code_challenge=${codeChallenge}&code_challenge_method=S256${loginHint}`
        } else if (provider === 'microsoft') {
          const clientId = config.VESPR_AUTH_MICROSOFT_ID
          authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=openid%20email%20profile&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateKey}&nonce=${nonce}&code_challenge=${codeChallenge}&code_challenge_method=S256${loginHint}`
        } else if (provider === 'github') {
          const clientId = config.VESPR_AUTH_GITHUB_ID
          authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=read:user%20user:email&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateKey}`
        } else if (provider === 'clever') {
          const clientId = config.VESPR_AUTH_CLEVER_ID
          authUrl = `https://clever.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateKey}`
        } else if (provider === 'classlink') {
          // "profile" only: who the person is, nothing from the roster (docs/SCHOOL-SSO.md)
          const clientId = config.VESPR_AUTH_CLASSLINK_ID
          authUrl = `https://launchpad.classlink.com/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=profile&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateKey}`
        }

        res.writeHead(302, {
          Location: authUrl,
          'Set-Cookie': `vespr_oauth_state=${stateKey}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600${secureRequest(req) ? '; Secure' : ''}`
        })
        res.end()
        return true
      }

      // OAuth Callback: GET /auth/callback/<provider>
      const callbackMatch = /^\/auth\/callback\/(google|microsoft|github|clever|classlink)$/.exec(u.pathname)
      if (req.method === 'GET' && callbackMatch) {
        const provider = callbackMatch[1]
        const code = u.searchParams.get('code')
        const stateKey = u.searchParams.get('state')
        const authError = u.searchParams.get('error')

        if (authError) {
          return jsonResponse(res, 400, { error: `Authentication provider returned error: ${authError}` }), true
        }

        // The state must also match the cookie set when this browser started the flow: otherwise an attacker could finish their own sign-in in the victim's browser
        const stateCookie = parseCookies(req).vespr_oauth_state || ''
        if (stateCookie && (!stateKey || !safeEqual(stateCookie, stateKey))) {
          oauthStates.delete(stateKey)
          return jsonResponse(res, 400, { error: 'Invalid or expired authentication state' }), true
        }
        if (!stateCookie && config.NODE_ENV !== 'test') {
          oauthStates.delete(stateKey)
          return jsonResponse(res, 400, { error: 'Invalid or expired authentication state' }), true
        }
        const stateRecord = oauthStates.get(stateKey)
        if (!stateRecord || stateRecord.provider !== provider || stateRecord.expiresAt < now()) {
          oauthStates.delete(stateKey)
          return jsonResponse(res, 400, { error: 'Invalid or expired authentication state' }), true
        }
        oauthStates.delete(stateKey)

        let profile = null
        const callbackUrl = `${baseUrlFor(req)}/auth/callback/${provider}`

        if (oauthProviders[provider]) {
          try {
            profile = await oauthProviders[provider].exchange({ code, codeVerifier: stateRecord.codeVerifier, nonce: stateRecord.nonce, redirectUri: callbackUrl })
          } catch (err) {
            return jsonResponse(res, 401, { error: `Authentication failed: ${err.message}` }), true
          }
        } else if (fetcher) {
          // Direct test harness hook
          try {
            profile = await fetcher({ provider, code, stateRecord, callbackUrl })
          } catch (err) {
            return jsonResponse(res, 401, { error: err.message }), true
          }
        } else {
          try {
            if (provider === 'google') {
              const postData = new URLSearchParams({
                code,
                client_id: config.VESPR_AUTH_GOOGLE_ID,
                client_secret: config.VESPR_AUTH_GOOGLE_SECRET,
                code_verifier: stateRecord.codeVerifier,
                redirect_uri: callbackUrl,
                grant_type: 'authorization_code'
              }).toString()

              const tokenResp = await httpRequest('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
              }, postData)

              if (tokenResp.statusCode !== 200) throw new Error('Failed to exchange code with Google')
              const tokenData = JSON.parse(tokenResp.body)
              const idClaims = await verifyIdToken(
                tokenData.id_token,
                'https://www.googleapis.com/oauth2/v3/certs',
                ['https://accounts.google.com', 'accounts.google.com'],
                config.VESPR_AUTH_GOOGLE_ID,
                stateRecord.nonce
              )

              profile = {
                id: idClaims.sub,
                email: idClaims.email,
                name: idClaims.name || idClaims.email.split('@')[0],
                emailVerified: idClaims.email_verified === true || idClaims.email_verified === 'true'
              }
            } else if (provider === 'microsoft') {
              const postData = new URLSearchParams({
                code,
                client_id: config.VESPR_AUTH_MICROSOFT_ID,
                client_secret: config.VESPR_AUTH_MICROSOFT_SECRET,
                code_verifier: stateRecord.codeVerifier,
                redirect_uri: callbackUrl,
                grant_type: 'authorization_code'
              }).toString()

              const tokenResp = await httpRequest('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
              }, postData)

              if (tokenResp.statusCode !== 200) throw new Error('Failed to exchange code with Microsoft')
              const tokenData = JSON.parse(tokenResp.body)
              const idClaims = await verifyIdToken(
                tokenData.id_token,
                'https://login.microsoftonline.com/common/discovery/v2.0/keys',
                'https://login.microsoftonline.com/',
                config.VESPR_AUTH_MICROSOFT_ID,
                stateRecord.nonce
              )

              const stableId = (idClaims.tid ? `${idClaims.tid}:` : '') + (idClaims.oid || idClaims.sub)
              profile = {
                id: stableId,
                email: idClaims.email || idClaims.preferred_username,
                name: idClaims.name || (idClaims.preferred_username || '').split('@')[0],
                emailVerified: microsoftEmailVerified(idClaims) // see MSA_TENANT / xms_edov above
              }
            } else if (provider === 'github') {
              const postData = new URLSearchParams({
                client_id: config.VESPR_AUTH_GITHUB_ID,
                client_secret: config.VESPR_AUTH_GITHUB_SECRET,
                code,
                redirect_uri: callbackUrl
              }).toString()

              const tokenResp = await httpRequest('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Accept': 'application/json',
                  'Content-Length': Buffer.byteLength(postData)
                }
              }, postData)

              if (tokenResp.statusCode !== 200) throw new Error('Failed to exchange code with GitHub')
              const tokenData = JSON.parse(tokenResp.body)
              if (!tokenData.access_token) throw new Error('No access token returned from GitHub')

              const userResp = await httpRequest('https://api.github.com/user', {
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'User-Agent': 'VESPR-Auth'
                }
              })
              const ghUser = JSON.parse(userResp.body)

              const emailsResp = await httpRequest('https://api.github.com/user/emails', {
                headers: {
                  'Authorization': `Bearer ${tokenData.access_token}`,
                  'User-Agent': 'VESPR-Auth'
                }
              })
              const emails = JSON.parse(emailsResp.body)
              const primaryEmail = Array.isArray(emails) ? emails.find(e => e.primary && e.verified) : null

              if (!primaryEmail) {
                return jsonResponse(res, 401, { error: 'A verified primary email on GitHub is required.' }), true
              }

              profile = {
                id: String(ghUser.id),
                email: primaryEmail.email,
                name: ghUser.name || ghUser.login,
                username: ghUser.login,
                emailVerified: true
              }
            } else if (provider === 'clever') {
              const postData = new URLSearchParams({
                code,
                grant_type: 'authorization_code',
                redirect_uri: callbackUrl
              }).toString()

              const basicAuth = Buffer.from(`${config.VESPR_AUTH_CLEVER_ID}:${config.VESPR_AUTH_CLEVER_SECRET}`).toString('base64')
              const tokenResp = await httpRequest('https://clever.com/oauth/tokens', {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${basicAuth}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': Buffer.byteLength(postData)
                }
              }, postData)

              if (tokenResp.statusCode !== 200) throw new Error('Failed to exchange code with Clever')
              const tokenData = JSON.parse(tokenResp.body)

              const meResp = await httpRequest('https://api.clever.com/v3.0/me', {
                headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
              })
              const meData = JSON.parse(meResp.body)

              if (!meData.data?.id) throw new Error('Clever did not say who this is')
              profile = {
                id: meData.data.id,
                email: meData.data.email || null,
                name: meData.data.name?.first ? `${meData.data.name.first} ${meData.data.name.last || ''}`.trim() : null,
                emailVerified: false, // the district typed it; see SCHOOL_PROVIDERS
                staff: ['teacher', 'district_admin', 'school_admin', 'staff'].includes(String(meData.data.type || meData.type || '').toLowerCase())
              }
            } else if (provider === 'classlink') {
              const postData = new URLSearchParams({ client_id: config.VESPR_AUTH_CLASSLINK_ID, client_secret: config.VESPR_AUTH_CLASSLINK_SECRET, code, redirect_uri: callbackUrl, grant_type: 'authorization_code' }).toString()
              const tokenResp = await httpRequest('https://launchpad.classlink.com/oauth2/v2/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
              }, postData)
              if (tokenResp.statusCode !== 200) throw new Error('Failed to exchange code with ClassLink')
              const tokenData = JSON.parse(tokenResp.body)
              const meResp = await httpRequest('https://nodeapi.classlink.com/v2/my/info', { headers: { Authorization: `Bearer ${tokenData.access_token}` } })
              if (meResp.statusCode !== 200) throw new Error('ClassLink did not say who this is')
              const me = JSON.parse(meResp.body)
              if (!me.UserId) throw new Error('ClassLink did not say who this is')
              profile = {
                id: `${me.TenantId || 't'}:${me.UserId}`,
                email: me.Email || null,
                name: [me.FirstName, me.LastName].filter(Boolean).join(' ') || me.DisplayName || null,
                emailVerified: false, // the district typed it; see SCHOOL_PROVIDERS
                staff: /teacher|admin|staff/i.test(String(me.Role || ''))
              }
            }
          } catch (err) {
            return jsonResponse(res, 401, { error: `Authentication failed: ${err.message}` }), true
          }
        }

        if (SCHOOL_PROVIDERS.has(provider)) {
          const r = schoolAccount({ key: provider, id: profile && profile.id, email: profile && profile.email, name: profile && profile.name, via: provider, staff: Boolean(profile && profile.staff) })
          if (!r.user) return jsonResponse(res, r.status, { error: r.error }), true
          const rawSchoolToken = issueSession(r.user)
          res.writeHead(302, { Location: `${stateRecord.next}#token=${rawSchoolToken}`, 'Set-Cookie': [sessionCookie(req, rawSchoolToken), 'vespr_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0'] })
          res.end()
          return true
        }

        if (!profile || !profile.email || !profile.emailVerified) {
          return jsonResponse(res, 401, { error: provider === 'microsoft' ? 'Authentication failed: Microsoft did not confirm this organization owns the email address. Ask its admin, or sign in another way.' : 'Authentication failed: unverified email cannot be linked' }), true
        }

        { const lk = lifecycle.lockFor(profile.email); if (!lifecycle.lockAllows(lk, provider)) return jsonResponse(res, 403, { error: lifecycle.lockRefusal(lk) }), true }

        // Account linking rules:
        // 1. By provider {provider, id}
        const users = getUsers()
        let user = Object.values(users).find(u => u.providers?.[provider]?.id === profile.id)

        if (!user) {
          // 2. Link by verified email
          user = Object.values(users).find(u => u.email === profile.email)
          if (user) {
            // NEVER link to unverified local account (account takeover prevention!)
            if (!user.emailVerified) {
              return jsonResponse(res, 403, { error: 'Cannot link unverified local account' }), true
            }
            user.providers = user.providers || {}
            user.providers[provider] = {
              id: profile.id,
              email: profile.email,
              username: profile.username || null
            }
          } else {
            // 3. Create brand new account, but only where the operator allows sign-ups (same gate as password registration)
            const refusal = registrationRefusal(profile.email)
            if (refusal) {
              return jsonResponse(res, refusal.status, { error: refusal.error }), true
            }
            const userId = crypto.randomBytes(16).toString('hex')
            user = {
              id: userId,
              email: profile.email,
              name: freeName(users, profile.name || profile.email.split('@')[0]),
              passwordHash: null,
              salt: null,
              emailVerified: true,
              createdAt: now(),
              updatedAt: now(),
              roles: ['member'],
              providers: {
                [provider]: {
                  id: profile.id,
                  email: profile.email,
                  username: profile.username || null
                }
              },
              totp: { enabled: false },
              sms: { enabled: false },
              recoveryCodes: []
            }
            users[userId] = user
          }
          saveUsers(users)
        }

        if (['suspended', 'deletion_requested'].includes(user.activation)) return jsonResponse(res, 403, { error: 'This VESPR account is closed.' }), true
        const rawSessionToken = issueSession(user)

        // Redirect to next with fragment (#token=..., never query param); the cookie lets the site itself stay signed in without keeping the token in script
        const redirectTarget = `${stateRecord.next}#token=${rawSessionToken}`
        res.writeHead(302, { Location: redirectTarget, 'Set-Cookie': [sessionCookie(req, rawSessionToken), 'vespr_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0'] })
        res.end()
        return true
      }

      return false
    }
  }
}
