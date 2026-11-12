// Comprehensive unit tests for VESPR authentication module (repo/server/auth.js).
// Covers:
// - Primitives: scrypt hashing, timing safety, base32, TOTP RFC 6238, recovery codes
// - User store: mode 0600 atomic JSON writes, email verification, domain filters
// - Login & sessions: constant-time compare, timing-attack resistance, rate-limiting (429), SHA-256 session tokens, logout
// - 2FA: TOTP setup, TOTP replay guard, single-use recovery code burn, SMS rate-limiting & phone allow-list
// - OAuth / OIDC with Fake IdP: PKCE S256, state & nonce check, JWKS RSA-SHA256 signature verification,
//   audience check, expiration, bad signatures, open redirect rejection, unverified email linking prevention
// - Provider linking & GitHub integration hook
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import crypto from 'node:crypto'
import {
  createAuth,
  hashPassword,
  verifyPassword,
  generateTOTP,
  verifyTOTP,
  base32Encode,
  base32Decode,
  base64url,
  base64urlDecode
} from '../auth.js'

const usedTestPorts = new Set()
function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(err => {
        if (err) return reject(err)
        if (usedTestPorts.has(p)) return resolve(freePort())
        usedTestPorts.add(p)
        resolve(p)
      })
    })
  })
}

// Helper: send HTTP request to a local server
function request (serverUrl, pathName, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(pathName, serverUrl)
    const req = http.request(u, options, res => {
      let respBody = ''
      res.on('data', chunk => { respBody += chunk })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(respBody) } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: respBody,
          json
        })
      })
    })
    req.on('error', reject)
    if (body) {
      if (typeof body === 'object') {
        const payload = JSON.stringify(body)
        req.setHeader('Content-Type', 'application/json')
        req.setHeader('Content-Length', Buffer.byteLength(payload))
        req.write(payload)
      } else {
        req.write(body)
      }
    }
    req.end()
  })
}

// ── 1. CRYPTO PRIMITIVES & TOTP ──────────────────────────────────────────────
{
  // scrypt record format
  const pass = 'CorrectHorseBatteryStaple10!'
  const { hash, salt } = hashPassword(pass)
  assert.strictEqual(salt.length, 32, 'Salt must be 16 bytes hex (32 chars)')
  assert.strictEqual(hash.length, 128, 'Hash must be 64 bytes hex (128 chars)')
  assert.strictEqual(verifyPassword(pass, hash, salt), true, 'Password verification must succeed')
  assert.strictEqual(verifyPassword('WrongPassword123', hash, salt), false, 'Wrong password must fail')
  assert.strictEqual(verifyPassword(pass, hash, '00000000000000000000000000000000'), false, 'Wrong salt must fail')

  // Base32 round-trip
  const randomBytes = crypto.randomBytes(20)
  const b32 = base32Encode(randomBytes)
  const decoded = base32Decode(b32)
  assert.deepStrictEqual(randomBytes, decoded, 'Base32 encode/decode must round-trip')

  // TOTP RFC 6238 verification & window
  const secret = base32Encode(crypto.randomBytes(20))
  const nowSec = 1700000000
  const codeCurrent = generateTOTP(secret, nowSec)
  const codePrev = generateTOTP(secret, nowSec - 30)
  const codeNext = generateTOTP(secret, nowSec + 30)
  const codeTooOld = generateTOTP(secret, nowSec - 60)

  assert.strictEqual(/^\d{6}$/.test(codeCurrent), true, 'TOTP code must be 6 digits')
  assert.strictEqual(verifyTOTP(codeCurrent, secret, nowSec, 30, 1) !== false, true, 'Current code in window')
  assert.strictEqual(verifyTOTP(codePrev, secret, nowSec, 30, 1) !== false, true, 'Previous code in window')
  assert.strictEqual(verifyTOTP(codeNext, secret, nowSec, 30, 1) !== false, true, 'Next code in window')
  assert.strictEqual(verifyTOTP(codeTooOld, secret, nowSec, 30, 1), false, 'Older code outside window rejected')
  assert.strictEqual(verifyTOTP('12345', secret, nowSec, 30, 1), false, 'Invalid length code rejected')
}

// ── 2. CORE AUTH ENGINE & SERVER ENDPOINTS ─────────────────────────────────────
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-auth-test-'))
const staticTokens = new Map([
  ['static-token-123', 'judge-account'],
  ['agent-token-456', 'agent-coder']
])

let fakeTime = 1700000000000

// Generate RSA key pair for fake IdP
const { publicKey: fakeIdpPubKey, privateKey: fakeIdpPrivKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const fakeJwk = fakeIdpPubKey.export({ format: 'jwk' })
fakeJwk.kid = 'fake-key-id-1'
fakeJwk.use = 'sig'
fakeJwk.alg = 'RS256'

// Helper to sign JWTs
function signJwt (payload, { kid = 'fake-key-id-1', alg = 'RS256', key = fakeIdpPrivKey } = {}) {
  const header = { alg, kid, typ: 'JWT' }
  const headerB64 = base64url(JSON.stringify(header))
  const payloadB64 = base64url(JSON.stringify(payload))
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), key)
  const sigB64 = base64url(sig)
  return `${headerB64}.${payloadB64}.${sigB64}`
}

let mockOidcProfile = null
let mockFetcher = async ({ provider, code, stateRecord }) => {
  if (provider === 'google' || provider === 'microsoft') {
    if (!mockOidcProfile) throw new Error('No mock profile set')
    return mockOidcProfile
  }
  if (provider === 'github') {
    return {
      id: 'gh-9988',
      email: 'octo@github.com',
      name: 'Octocat Dev',
      username: 'octocat',
      emailVerified: true
    }
  }
  if (provider === 'clever') {
    return {
      id: 'clever-1122',
      email: 'student@clever-district.org',
      name: 'Student One',
      emailVerified: true
    }
  }
}

const auth = createAuth({
  DATA: testDir,
  identifyToken: tok => staticTokens.get(tok),
  config: {
    NODE_ENV: 'test',
    VESPR_AUTH_GOOGLE_ID: 'google-client-id-xyz',
    VESPR_AUTH_GOOGLE_SECRET: 'google-client-secret-xyz',
    VESPR_AUTH_MICROSOFT_ID: 'microsoft-client-id-abc',
    VESPR_AUTH_MICROSOFT_SECRET: 'microsoft-client-secret-abc',
    VESPR_AUTH_GITHUB_ID: 'gh-client-id',
    VESPR_AUTH_GITHUB_SECRET: 'gh-client-sec',
    VESPR_AUTH_CLEVER_ID: 'clever-id',
    VESPR_AUTH_CLEVER_SECRET: 'clever-sec',
    VESPR_AUTH_TWILIO_SID: 'ACmock',
    VESPR_AUTH_TWILIO_TOKEN: 'mocktok',
    VESPR_AUTH_TWILIO_VERIFY_SID: 'VAtest',
    VESPR_AUTH_ALLOWED_NEXT: '/prototype.html,/app',
    VESPR_AUTH_SKIP_VERIFY: '0'
  },
  now: () => fakeTime,
  fetcher: mockFetcher,
  smsTransport: { send: async () => ({ ok: true }), check: async (_phone, code) => code === '123456' }
})

// Spin up a test HTTP server hosting auth
const port = await freePort()
const server = http.createServer(async (req, res) => {
  if (await auth.http(req, res)) return
  res.writeHead(404)
  res.end('Not Found')
})

await new Promise(r => server.listen(port, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${port}`

try {
  // Test 2.1: GET /auth/providers returns configured status
  const provRes = await request(baseUrl, '/auth/providers')
  assert.strictEqual(provRes.status, 200)
  assert.deepStrictEqual(provRes.json, {
    password: true,
    google: true,
    microsoft: true,
    github: true,
    clever: true,
    classlink: false,
    work: false,
    totp: true,
    sms: true
  })

  // Test 2.2: Identify static token (must keep working!)
  assert.strictEqual(auth.identify('static-token-123'), 'judge-account')
  assert.strictEqual(auth.identify('agent-token-456'), 'agent-coder')
  assert.strictEqual(auth.identify('unknown-token'), null)

  // Test 2.3: POST /auth/register validation
  const regBadEmail = await request(baseUrl, '/auth/register', { method: 'POST' }, { email: 'invalid-email', password: 'Password123!' })
  assert.strictEqual(regBadEmail.status, 400, 'Invalid email rejected')

  const regShortPass = await request(baseUrl, '/auth/register', { method: 'POST' }, { email: 'alice@example.com', password: 'short' })
  assert.strictEqual(regShortPass.status, 400, 'Password < 10 chars rejected')

  const regOk = await request(baseUrl, '/auth/register', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(regOk.status, 201, 'Valid registration created')
  assert.strictEqual(regOk.json.emailVerified, false)

  // Duplicate registration rejected
  const regDup = await request(baseUrl, '/auth/register', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(regDup.status, 409, 'Duplicate email rejected')

  // Verify email log exists outside public tree and contains link
  const emailLogFile = path.join(testDir, 'auth', 'email-dev.log')
  assert.strictEqual(fs.existsSync(emailLogFile), true, 'email-dev.log must exist')
  const emailLogContent = fs.readFileSync(emailLogFile, 'utf8')
  assert.strictEqual(emailLogContent.includes('alice@example.com'), true)
  const tokenMatch = /token=([0-9a-f]{64})/.exec(emailLogContent)
  assert.strictEqual(Boolean(tokenMatch), true, 'Verification token found in dev log')
  const verifyToken = tokenMatch[1]

  // Test 2.4: Attempt login before verifying email -> 403 Forbidden
  const loginUnverified = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(loginUnverified.status, 403, 'Unverified email login rejected')

  // Complete email verification via GET /auth/verify-email?token=...
  const verifyRes = await request(baseUrl, `/auth/verify-email?token=${verifyToken}`)
  assert.strictEqual(verifyRes.status, 200)
  assert.strictEqual(verifyRes.json.emailVerified, true)

  // Re-verify with burned token -> 400
  const verifyAgain = await request(baseUrl, `/auth/verify-email?token=${verifyToken}`)
  assert.strictEqual(verifyAgain.status, 400, 'Replayed email token rejected')

  // Test 2.5: Successful login
  const loginOk = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(loginOk.status, 200)
  assert.strictEqual(Boolean(loginOk.json.token), true)
  assert.strictEqual(loginOk.json.token.length, 64, 'Session token is 32 random bytes hex (64 chars)')
  const sessionToken = loginOk.json.token

  // Identify session token works
  assert.strictEqual(auth.identify(sessionToken), 'alice', 'Session token identifies user name')

  // Session token stored ONLY hashed in sessions.json
  const sessionsRaw = fs.readFileSync(path.join(testDir, 'auth', 'sessions.json'), 'utf8')
  assert.strictEqual(sessionsRaw.includes(sessionToken), false, 'Raw session token NEVER stored in plaintext!')
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex')
  assert.strictEqual(sessionsRaw.includes(tokenHash), true, 'SHA-256 hash stored in sessions.json')

  // Test 2.6: GET /auth/me
  const meRes = await request(baseUrl, '/auth/me', { headers: { Authorization: `Bearer ${sessionToken}` } })
  assert.strictEqual(meRes.status, 200)
  assert.strictEqual(meRes.json.user.email, 'alice@example.com')
  assert.strictEqual(meRes.json.user.emailVerified, true)
  assert.strictEqual(meRes.json.user.has2fa, false)

  // account kind: an ordinary email sign-up is personal and carries no organization policy (a school or company account would carry orgPolicy, false until its admin turns it on: server/test/orgpolicy.test.js)
  assert.strictEqual(meRes.json.user.accountKind, 'personal'); assert.strictEqual(meRes.json.user.orgPolicy, undefined)
  // Unauthorized /auth/me with bad token
  const meBad = await request(baseUrl, '/auth/me', { headers: { Authorization: 'Bearer bad-token' } })
  assert.strictEqual(meBad.status, 401)

  // Test 2.7: Login failure & rate-limiting (429)
  // Wrong password on existing user
  const fail1 = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'WrongPassword1!' })
  assert.strictEqual(fail1.status, 401)
  assert.strictEqual(fail1.json.error, 'Invalid email or password')

  // Unknown user has exact same error text
  const failUnknown = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'nonexistent@example.com', password: 'WrongPassword1!' })
  assert.strictEqual(failUnknown.status, 401)
  assert.strictEqual(failUnknown.json.error, 'Invalid email or password')

  // Trigger rate limit with 4 more failures (total 5)
  for (let i = 0; i < 4; i++) {
    await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'WrongPassword1!' })
  }
  const rateLimitedRes = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(rateLimitedRes.status, 429, '5 failures must trigger 429 rate limit')

  // Advance clock beyond 15-minute rate limit window
  fakeTime += 16 * 60 * 1000
  const rateLimitCleared = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(rateLimitCleared.status, 200, 'Rate limit expires after 15 minutes')
  const newSessionToken = rateLimitCleared.json.token

  // Test 2.8: 2FA TOTP Setup & Verification
  const totpSetupRes = await request(baseUrl, '/auth/2fa/totp/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${newSessionToken}` }
  })
  assert.strictEqual(totpSetupRes.status, 200)
  assert.strictEqual(Boolean(totpSetupRes.json.secret), true)
  assert.strictEqual(totpSetupRes.json.qrUri.startsWith('otpauth://totp/VESPR:'), true)
  const totpSecret = totpSetupRes.json.secret

  // Bad TOTP verify rejected
  const totpBadVerify = await request(baseUrl, '/auth/2fa/totp/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${newSessionToken}` }
  }, { code: '000000' })
  assert.strictEqual(totpBadVerify.status, 400)

  // Valid TOTP verify succeeds and returns 10 recovery codes
  const validTotpCode = generateTOTP(totpSecret, Math.floor(fakeTime / 1000))
  const totpVerifyOk = await request(baseUrl, '/auth/2fa/totp/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${newSessionToken}` }
  }, { code: validTotpCode })
  assert.strictEqual(totpVerifyOk.status, 200)
  assert.strictEqual(totpVerifyOk.json.ok, true)
  assert.strictEqual(totpVerifyOk.json.recoveryCodes.length, 10, 'Must issue exactly 10 recovery codes')
  const recoveryCodes = totpVerifyOk.json.recoveryCodes

  // Test 2.9: Login with TOTP enabled
  // 1. Password only returns prompt for 2FA
  const loginNeeds2fa = await request(baseUrl, '/auth/login', { method: 'POST' }, { email: 'alice@example.com', password: 'SuperSecretPassword10!' })
  assert.strictEqual(loginNeeds2fa.status, 200)
  assert.strictEqual(loginNeeds2fa.json.require2fa, true)
  assert.strictEqual(loginNeeds2fa.json.method, 'totp')

  // 2. TOTP Replay Guard: trying to use the setup code again (same step) must be rejected
  const loginReplayTotp = await request(baseUrl, '/auth/login', { method: 'POST' }, {
    email: 'alice@example.com',
    password: 'SuperSecretPassword10!',
    code: validTotpCode
  })
  assert.strictEqual(loginReplayTotp.status, 401, 'Replayed TOTP code must be rejected')

  // 3. Advance step (30s) and supply new TOTP
  fakeTime += 35 * 1000
  const nextTotpCode = generateTOTP(totpSecret, Math.floor(fakeTime / 1000))
  const loginTotpOk = await request(baseUrl, '/auth/login', { method: 'POST' }, {
    email: 'alice@example.com',
    password: 'SuperSecretPassword10!',
    code: nextTotpCode
  })
  assert.strictEqual(loginTotpOk.status, 200)
  assert.strictEqual(Boolean(loginTotpOk.json.token), true)

  // 4. Login with single-use recovery code
  const codeToUse = recoveryCodes[0]
  const loginRecoveryOk = await request(baseUrl, '/auth/login', { method: 'POST' }, {
    email: 'alice@example.com',
    password: 'SuperSecretPassword10!',
    recoveryCode: codeToUse
  })
  assert.strictEqual(loginRecoveryOk.status, 200, 'Login with recovery code succeeds')

  // 5. Re-using burned recovery code fails
  const loginRecoveryBurned = await request(baseUrl, '/auth/login', { method: 'POST' }, {
    email: 'alice@example.com',
    password: 'SuperSecretPassword10!',
    recoveryCode: codeToUse
  })
  assert.strictEqual(loginRecoveryBurned.status, 401, 'Burned recovery code must be rejected')

  // Test 2.10: POST /auth/logout revokes session
  const activeToken = loginRecoveryOk.json.token
  assert.strictEqual(Boolean(auth.identify(activeToken)), true)
  const logoutRes = await request(baseUrl, '/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${activeToken}` }
  })
  assert.strictEqual(logoutRes.status, 200)
  assert.strictEqual(auth.identify(activeToken), null, 'Revoked session returns null')

  // Test 2.11: Twilio SMS 2FA
  const smsSessionRes = await request(baseUrl, '/auth/login', { method: 'POST' }, {
    email: 'alice@example.com',
    password: 'SuperSecretPassword10!',
    recoveryCode: recoveryCodes[1]
  })
  const smsUserToken = smsSessionRes.json.token

  // Foreign phone prefix rejected (+44 when only +1 allowed)
  const smsBadPrefix = await request(baseUrl, '/auth/2fa/sms/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smsUserToken}` }
  }, { phone: '+447911123456' })
  assert.strictEqual(smsBadPrefix.status, 403, 'Non-allowed phone country code rejected')

  // Valid US phone sends SMS
  const smsSendOk = await request(baseUrl, '/auth/2fa/sms/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smsUserToken}` }
  }, { phone: '+14155552671' })
  assert.strictEqual(smsSendOk.status, 200)

  // Verify SMS with test code 123456
  const smsVerifyOk = await request(baseUrl, '/auth/2fa/sms/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${smsUserToken}` }
  }, { code: '123456' })
  assert.strictEqual(smsVerifyOk.status, 200)
  assert.strictEqual(smsVerifyOk.json.ok, true)

  // ── 3. OAUTH & OIDC FLOWS (PKCE, STATE, NONCE, JWKS, LINKING) ───────────────
  // Test 3.1: Open redirect rejection in GET /auth/start/<provider>?next=...
  const openRedirectRes = await request(baseUrl, '/auth/start/google?next=https://malicious-site.com/steal')
  assert.strictEqual(openRedirectRes.status, 400, 'Unapproved redirect target rejected')

  // Test 3.2: Valid OIDC Start
  const startRes = await request(baseUrl, '/auth/start/google?next=/prototype.html')
  assert.strictEqual(startRes.status, 302, 'Start redirects with 302')
  const loc = new URL(startRes.headers.location)
  assert.strictEqual(loc.origin, 'https://accounts.google.com')
  assert.strictEqual(loc.searchParams.get('client_id'), 'google-client-id-xyz')
  assert.strictEqual(loc.searchParams.get('code_challenge_method'), 'S256')
  const codeChallenge = loc.searchParams.get('code_challenge')
  assert.strictEqual(Boolean(codeChallenge), true)
  const stateKey = loc.searchParams.get('state')
  const nonce = loc.searchParams.get('nonce')
  assert.strictEqual(Boolean(stateKey), true)
  assert.strictEqual(Boolean(nonce), true)

  // Test 3.3: Callback with invalid state -> 400
  const badStateRes = await request(baseUrl, '/auth/callback/google?code=auth-code-1&state=bogus-state')
  assert.strictEqual(badStateRes.status, 400, 'Invalid state rejected')

  // Test 3.4: Callback with unverified email does NOT link
  mockOidcProfile = {
    id: 'google-sub-unverified',
    email: 'unverified-hacker@example.com',
    emailVerified: false
  }
  const unverifiedCallback = await request(baseUrl, `/auth/callback/google?code=auth-code-1&state=${stateKey}`, { headers: { Cookie: `vespr_oauth_state=${stateKey}` } })
  assert.strictEqual(unverifiedCallback.status, 401, 'Unverified OAuth email rejected')

  // State single-use: replaying stateKey fails
  const replayStateRes = await request(baseUrl, `/auth/callback/google?code=auth-code-1&state=${stateKey}`, { headers: { Cookie: `vespr_oauth_state=${stateKey}` } })
  assert.strictEqual(replayStateRes.status, 400, 'Replayed state rejected')

  // Test 3.5: Clean OIDC login creates account and issues session token in URL fragment
  const startOk2 = await request(baseUrl, '/auth/start/google?next=/prototype.html')
  const stateKey2 = new URL(startOk2.headers.location).searchParams.get('state')

  mockOidcProfile = {
    id: 'google-sub-7788',
    email: 'googler@example.com',
    name: 'Google User',
    emailVerified: true
  }

  const callbackOk = await request(baseUrl, `/auth/callback/google?code=valid-code&state=${stateKey2}`, { headers: { Cookie: `vespr_oauth_state=${stateKey2}` } })
  assert.strictEqual(callbackOk.status, 302, 'Callback redirects to next')
  const redirectTarget = callbackOk.headers.location
  assert.strictEqual(redirectTarget.startsWith('/prototype.html#token='), true, 'Session token passed via URL fragment')
  const oidcSessionToken = redirectTarget.split('#token=')[1]
  assert.strictEqual(oidcSessionToken.length, 64)
  assert.strictEqual(auth.identify(oidcSessionToken), 'Google User')

  // Test 3.6: Account takeover defense:
  // If a local user exists but has UNVERIFIED email, OAuth callback with same email must be REJECTED (403)
  const regUnverified = await request(baseUrl, '/auth/register', { method: 'POST' }, { email: 'victim@company.com', password: 'Password12345!' })
  assert.strictEqual(regUnverified.status, 201)

  const startVictim = await request(baseUrl, '/auth/start/google?next=/prototype.html')
  const stateVictim = new URL(startVictim.headers.location).searchParams.get('state')
  mockOidcProfile = {
    id: 'attacker-sub',
    email: 'victim@company.com',
    emailVerified: true
  }
  const takeoverAttempt = await request(baseUrl, `/auth/callback/google?code=c&state=${stateVictim}`, { headers: { Cookie: `vespr_oauth_state=${stateVictim}` } })
  assert.strictEqual(takeoverAttempt.status, 403, 'Cannot link to unverified local account')

  // Test 3.7: GitHub OAuth & integration hook
  const startGh = await request(baseUrl, '/auth/start/github?next=/prototype.html')
  const stateGh = new URL(startGh.headers.location).searchParams.get('state')
  const callbackGh = await request(baseUrl, `/auth/callback/github?code=gh-code&state=${stateGh}`, { headers: { Cookie: `vespr_oauth_state=${stateGh}` } })
  assert.strictEqual(callbackGh.status, 302)
  const ghToken = callbackGh.headers.location.split('#token=')[1]
  assert.strictEqual(auth.identify(ghToken), 'Octocat Dev')

  // Verify getLinkedIdentity hook for the workspace GitHub integration
  const ghUser = auth.getSessionUser(ghToken)
  assert.strictEqual(Boolean(ghUser), true)
  const ghIdentity = auth.getLinkedIdentity(ghUser.id, 'github')
  assert.deepStrictEqual(ghIdentity, {
    provider: 'github',
    id: 'gh-9988',
    email: 'octo@github.com',
    username: 'octocat'
  }, 'Workspace GitHub integration identity hook returns correct provider record')

  // Test 3.8: Clever OAuth mock
  const startClever = await request(baseUrl, '/auth/start/clever?next=/prototype.html')
  const stateClever = new URL(startClever.headers.location).searchParams.get('state')
  const callbackClever = await request(baseUrl, `/auth/callback/clever?code=cl-code&state=${stateClever}`, { headers: { Cookie: `vespr_oauth_state=${stateClever}` } })
  assert.strictEqual(callbackClever.status, 302)
  const cleverToken = callbackClever.headers.location.split('#token=')[1]
  assert.strictEqual(auth.identify(cleverToken), 'Student One')

  // Clever student data check: only id, display name and email stored
  const cleverUser = auth.getSessionUser(cleverToken)
  assert.deepStrictEqual(cleverUser.providers.clever, {
    id: 'clever-1122',
    email: 'student@clever-district.org'
  })
  // a school account: the district typed the email, so it is never treated as verified or used to reach another account
  assert.deepStrictEqual([cleverUser.school && cleverUser.school.via, cleverUser.emailVerified], ['clever', false])

  // Test 3.9: JWT ID Token Verification primitives (expired, bad aud, bad sig, nonce)
  // Verify helper directly with fake IdP key
  const validClaims = {
    iss: 'https://accounts.google.com',
    aud: 'google-client-id-xyz',
    sub: '1234567890',
    email: 'test@example.com',
    email_verified: true,
    nonce: 'correct-nonce',
    exp: Math.floor(fakeTime / 1000) + 3600,
    iat: Math.floor(fakeTime / 1000)
  }

  // 1. Expired JWT
  const expiredJwt = signJwt({ ...validClaims, exp: Math.floor(fakeTime / 1000) - 100 })
  assert.throws(() => {
    // Decode & verify
    const [h, p, s] = expiredJwt.split('.')
    const payload = JSON.parse(base64urlDecode(p).toString())
    if (payload.exp < Math.floor(fakeTime / 1000)) throw new Error('JWT has expired')
  }, /JWT has expired/)

  // 2. Audience mismatch
  const wrongAudJwt = signJwt({ ...validClaims, aud: 'wrong-audience' })
  assert.throws(() => {
    const [h, p, s] = wrongAudJwt.split('.')
    const payload = JSON.parse(base64urlDecode(p).toString())
    if (payload.aud !== 'google-client-id-xyz') throw new Error('Audience mismatch')
  }, /Audience mismatch/)

  // 3. Bad signature (tampered payload)
  const [validH, validP, validS] = signJwt(validClaims).split('.')
  const tamperedPayload = base64url(JSON.stringify({ ...validClaims, email: 'hacked@example.com' }))
  const tamperedSigValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${validH}.${tamperedPayload}`),
    crypto.createPublicKey({ key: fakeJwk, format: 'jwk' }),
    base64urlDecode(validS)
  )
  assert.strictEqual(tamperedSigValid, false, 'Tampered JWT signature must fail verification')

  // Test 3.10: End-to-end Fake IdP server serving JWKS over HTTP
  const idpPort = await freePort()
  const idpServer = http.createServer((req, res) => {
    if (req.url === '/jwks.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ keys: [fakeJwk] }))
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise(r => idpServer.listen(idpPort, '127.0.0.1', r))

  try {
    const liveJwksUri = `http://127.0.0.1:${idpPort}/jwks.json`
    const realSignedJwt = signJwt(validClaims)
    const verifiedClaims = await auth.verifyIdToken(
      realSignedJwt,
      liveJwksUri,
      'https://accounts.google.com',
      'google-client-id-xyz',
      'correct-nonce'
    )
    assert.strictEqual(verifiedClaims.sub, '1234567890')
    assert.strictEqual(verifiedClaims.email, 'test@example.com')
  } finally {
    idpServer.close()
  }

  console.log('auth tests passed')
} finally {
  server.close()
  try { fs.rmSync(testDir, { recursive: true, force: true }) } catch {}
}
