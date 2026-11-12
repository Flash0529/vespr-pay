// Sign-up gate: who may CREATE an account must be decided the same way for password registration and single sign-on.
// Before this test existed, "registrations closed" only guarded POST /auth/register; a new Google/Microsoft/GitHub/Clever identity got an account anyway.
// Runs the real auth module with production-style config (NODE_ENV is not 'test') and a fake identity provider. No network, no keys.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createAuth } from '../auth.js'

let profile = null
const fetcher = async () => profile

function request (base, pathName, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathName, base), options, res => {
      let text = ''
      res.on('data', c => { text += c })
      res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch {} resolve({ status: res.statusCode, headers: res.headers, json }) })
    })
    req.on('error', reject)
    if (body) { const p = JSON.stringify(body); req.setHeader('Content-Type', 'application/json'); req.setHeader('Content-Length', Buffer.byteLength(p)); req.write(p) }
    req.end()
  })
}

// One server per policy, each with its own data folder so accounts never leak between cases.
async function withServer (policy, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-signup-gate-'))
  const config = { VESPR_AUTH_GOOGLE_ID: 'g-id', VESPR_AUTH_GOOGLE_SECRET: 'g-sec', VESPR_AUTH_ALLOWED_NEXT: '/prototype.html', VESPR_AUTH_SKIP_VERIFY: '1', ...policy }
  const auth = createAuth({ DATA: dir, identifyToken: () => null, config, fetcher })
  const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const users = () => { try { return Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'auth', 'users.json'), 'utf8'))) } catch { return [] } }
  try { await fn({ base, auth, users }) } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}

// Drive a full fake Google sign-in for the given identity and return the callback response.
async function ssoSignIn (base, who) {
  profile = { id: 'sub-' + who.email, name: who.email.split('@')[0], emailVerified: true, ...who }
  const start = await request(base, '/auth/start/google?next=/prototype.html')
  assert.strictEqual(start.status, 302, 'start redirects to the provider')
  const state = new URL(start.headers.location).searchParams.get('state')
  return request(base, `/auth/callback/google?code=c&state=${state}`, { headers: { Cookie: `vespr_oauth_state=${state}` } })
}

const pw = (base, email) => request(base, '/auth/register', { method: 'POST' }, { email, password: 'Password12345!' })

// 1. Registration closed (operator never set VESPR_AUTH_ALLOWED_DOMAINS): password and SSO are both refused, and no account is written.
await withServer({}, async ({ base, users }) => {
  assert.strictEqual((await pw(base, 'p1@example.com')).status, 403, 'password sign-up refused when closed')
  const sso = await ssoSignIn(base, { email: 'new@example.com' })
  assert.strictEqual(sso.status, 403, 'a brand-new SSO identity gets no account on a closed server')
  assert.match(sso.json.error, /closed/i)
  assert.ok(!sso.headers['set-cookie'] && !sso.headers.location, 'no session cookie and no redirect on refusal')
  assert.strictEqual(users().length, 0, 'nothing was stored')
})

// 2. Domain restricted: SSO follows the same list as password registration.
await withServer({ VESPR_AUTH_ALLOWED_DOMAINS: 'school.org' }, async ({ base, users }) => {
  assert.strictEqual((await pw(base, 'x@other.com')).status, 403)
  const outside = await ssoSignIn(base, { email: 'x@other.com' })
  assert.strictEqual(outside.status, 403, 'SSO identity outside the allowed domain is refused')
  assert.match(outside.json.error, /restricted to: school\.org/)
  assert.strictEqual(users().length, 0)
  const inside = await ssoSignIn(base, { email: 'kid@school.org' })
  assert.strictEqual(inside.status, 302, 'SSO identity inside the allowed domain gets in')
  assert.ok(inside.headers.location.startsWith('/prototype.html#token='))
  assert.strictEqual(users().length, 1)
  const mixed = await ssoSignIn(base, { email: 'Teacher@School.ORG' })
  assert.strictEqual(mixed.status, 302, 'the domain match ignores case, as the password path does')
})

// 3. Open on purpose ('*'): unchanged behaviour.
await withServer({ VESPR_AUTH_ALLOWED_DOMAINS: '*' }, async ({ base, users }) => {
  const any = await ssoSignIn(base, { email: 'anyone@anywhere.net' })
  assert.strictEqual(any.status, 302)
  assert.strictEqual(users().length, 1)
})

// 4. An account that already exists keeps signing in even if the operator later closes sign-ups (the gate is for creation only).
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-signup-gate-'))
  try {
    const config = { VESPR_AUTH_GOOGLE_ID: 'g-id', VESPR_AUTH_GOOGLE_SECRET: 'g-sec', VESPR_AUTH_ALLOWED_NEXT: '/prototype.html', VESPR_AUTH_SKIP_VERIFY: '1' }
    for (const open of [true, false]) {
      const auth = createAuth({ DATA: dir, identifyToken: () => null, config: open ? { ...config, VESPR_AUTH_ALLOWED_DOMAINS: '*' } : config, fetcher })
      const server = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
      await new Promise(r => server.listen(0, '127.0.0.1', r))
      try {
        const res = await ssoSignIn(`http://127.0.0.1:${server.address().port}`, { email: 'old@example.com' })
        assert.strictEqual(res.status, 302, open ? 'first sign-in creates the account' : 'existing account still signs in after sign-ups close')
      } finally { server.close() }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// 5. Linking an SSO identity to an existing verified local account is not "creation" and stays allowed on a closed server.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-signup-gate-'))
  try {
    const config = { VESPR_AUTH_GOOGLE_ID: 'g-id', VESPR_AUTH_GOOGLE_SECRET: 'g-sec', VESPR_AUTH_ALLOWED_NEXT: '/prototype.html', VESPR_AUTH_SKIP_VERIFY: '1' }
    const open = createAuth({ DATA: dir, identifyToken: () => null, config: { ...config, VESPR_AUTH_ALLOWED_DOMAINS: '*' }, fetcher })
    let server = http.createServer(async (req, res) => { if (await open.http(req, res)) return; res.writeHead(404); res.end() })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    assert.strictEqual((await pw(`http://127.0.0.1:${server.address().port}`, 'linked@example.com')).status, 201)
    server.close()
    const closed = createAuth({ DATA: dir, identifyToken: () => null, config, fetcher })
    server = http.createServer(async (req, res) => { if (await closed.http(req, res)) return; res.writeHead(404); res.end() })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    try {
      const res = await ssoSignIn(`http://127.0.0.1:${server.address().port}`, { email: 'linked@example.com' })
      assert.strictEqual(res.status, 302, 'verified local account links to SSO on a closed server')
    } finally { server.close() }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

console.log('auth sign-up gate tests passed')
