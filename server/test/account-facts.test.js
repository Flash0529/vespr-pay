// Account completion (auth.js /auth/account/facts): a signed-in person declares an age band and accepts the current Terms; the
// admission rules decide. Adults become active; 13-17 stay guardian-pending; no Terms configured means nothing to accept.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
async function server (config) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'account-facts-'))
  const auth = createAuth({ DATA, identifyToken: () => null, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', ...config } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`; let ip = 0
  const call = async (p, body, tok) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.2.0.' + (++ip), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
  const user = async (email, name) => { await call('/auth/register', { email, password: 'a-long-password-1', name }); const l = await call('/auth/login', { email, password: 'a-long-password-1' }); return l.j.token || l.j.sessionToken }
  return { call, user, close: () => { srv.close(); fs.rmSync(DATA, { recursive: true, force: true }) } }
}

await t('age, then Terms; adults become active, minors wait for a guardian; sign-in needed', async () => {
  const s = await server({ VESPR_TERMS_SHA256: 'a'.repeat(64) })
  const tok = await s.user('ann@example.test', 'Ann')
  assert.strictEqual((await s.call('/auth/account/facts')).s, 401, 'sign in first')
  assert.strictEqual((await s.call('/auth/account/facts', null, tok)).j.state, 'needs_age')
  assert.strictEqual((await s.call('/auth/account/facts', { acceptTerms: true }, tok)).s, 400, 'age before Terms')
  assert.strictEqual((await s.call('/auth/account/facts', { ageBand: 'grown-up' }, tok)).s, 400)
  const r = await s.call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, tok)
  assert.deepStrictEqual([r.s, r.j.state], [200, 'active'])
  const kid = await s.user('kid@example.test', 'Kid')
  assert.strictEqual((await s.call('/auth/account/facts', { ageBand: '13-17', acceptTerms: true }, kid)).j.state, 'guardian_pending', 'minors wait for a verified guardian')
  s.close()
})

await t('no Terms on the server: nothing to accept, said plainly', async () => {
  const s = await server({})
  const tok = await s.user('ben@example.test', 'Ben')
  await s.call('/auth/account/facts', { ageBand: 'adult' }, tok)
  const r = await s.call('/auth/account/facts', { acceptTerms: true }, tok)
  assert.strictEqual(r.s, 409); assert.match(r.j.error, /no Terms to accept/); assert.strictEqual(r.j.terms.available, false)
  s.close()
})

console.log(`account facts tests passed (${n})`)
