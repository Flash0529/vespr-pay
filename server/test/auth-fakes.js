// Fakes shared by auth-wiring.test.js and auth-demo-server.js: no network, no real provider, no real SMS. Secrets are generated at runtime.
import crypto from 'node:crypto'

// Fake SMS: random codes at runtime, one use each, records what was "sent"
export function fakeSms () {
  const codes = new Map()
  const t = { sent: [], failNext: false, async send (phone) {
    if (t.failNext) { t.failNext = false; throw new Error('carrier down') }
    let code = String(crypto.randomInt(100000, 1000000)); if (code === '123456') code = '654321'; codes.set(phone, code); t.sent.push(phone)
  }, async check (phone, code) {
    const ok = codes.get(phone) === code
    if (ok) codes.delete(phone)
    return ok
  }, last: phone => codes.get(phone) }
  return t
}

// Fake OAuth provider: authorization code flow, state echoed back, PKCE S256 enforced, codes single-use, redirect_uri must match
export function fakeProvider (name, profile) {
  const issued = new Map() // code -> { challenge, redirectUri }
  return {
    issued,
    authorizeUrl ({ state, nonce, codeChallenge, redirectUri }) {
      const u = new URL(`https://fake-${name}.invalid/authorize`)
      u.search = new URLSearchParams({ response_type: 'code', state, nonce, code_challenge: codeChallenge, code_challenge_method: 'S256', redirect_uri: redirectUri }).toString()
      return u.toString()
    },
    // what the provider's own page does after the person approves: returns the code for the callback
    approve (authorizeUrl) {
      const q = new URL(authorizeUrl).searchParams
      const code = crypto.randomBytes(12).toString('hex')
      issued.set(code, { challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') })
      return { code, state: q.get('state') }
    },
    async exchange ({ code, codeVerifier, redirectUri }) {
      const rec = issued.get(code)
      issued.delete(code)
      if (!rec) throw new Error('unknown or reused code')
      if (rec.redirectUri !== redirectUri) throw new Error('redirect_uri mismatch')
      const challenge = crypto.createHash('sha256').update(codeVerifier || '').digest('base64url')
      if (challenge !== rec.challenge) throw new Error('PKCE verifier does not match challenge')
      return profile
    }
  }
}
