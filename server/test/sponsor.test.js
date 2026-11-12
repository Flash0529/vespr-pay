// A grown-up approves a kid's account (server/sponsor.js, admission "awaiting_adult"): school students wait; staff (on the school's word) do
// not; the approving adult must be an active adult and becomes the sponsor; minors also need the approval method switched on by the
// operator (VESPR_GUARDIAN_METHODS); codes are single-use, expire, and cannot be guessed by trying.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const TERMS = 'b'.repeat(64)

async function world (extra = {}) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsor-')); let profile = null
  const classlink = { authorizeUrl: ({ state }) => 'https://launchpad.example/auth?state=' + state, exchange: async () => profile }
  const auth = createAuth({ DATA, identifyToken: () => null, oauthProviders: { classlink }, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/app/', VESPR_TERMS_SHA256: TERMS, ...extra } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`; let ip = 0
  const call = async (p, body, tok) => { const r = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.5.0.' + (++ip % 250), ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
  const school = async p => {
    profile = p
    const s = await fetch(base + '/auth/start/classlink?next=/app/', { redirect: 'manual' }); const state = new URL(s.headers.get('location')).searchParams.get('state')
    const cb = await fetch(base + '/auth/callback/classlink?' + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: { cookie: 'vespr_oauth_state=' + state } })
    return (cb.headers.get('location') || '').split('#token=')[1]
  }
  const adult = async (email, name) => {
    await call('/auth/register', { email, password: 'a-long-password-1', name })
    const tok = (await call('/auth/login', { email, password: 'a-long-password-1' })).j.token
    await call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, tok); return tok
  }
  return { auth, call, school, adult, close: () => { srv.close(); fs.rmSync(DATA, { recursive: true, force: true }) } }
}
const state = async (w, tok) => (await w.call('/auth/account/facts', null, tok)).j

await t('a school student waits for a grown-up; a teacher approves; the teacher is the sponsor', async () => {
  const w = await world({ VESPR_GUARDIAN_METHODS: 'teacher_approval,parent_approval' })
  const kid = await w.school({ id: 't1:100', email: null, name: 'Kid A', emailVerified: false, staff: false })
  assert.strictEqual((await state(w, kid)).state, 'needs_age', 'a school vouches for who they are, so no email step')
  await w.call('/auth/account/facts', { ageBand: '13-17', acceptTerms: true }, kid)
  assert.deepStrictEqual([(await state(w, kid)).state, (await state(w, kid)).next], ['awaiting_adult', 'adult'])
  const c = await w.call('/auth/sponsor/code', {}, kid); assert.strictEqual(c.s, 200); assert.match(c.j.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  const teacher = await w.adult('ms.t@example.test', 'Ms T')
  const look = await w.call('/auth/sponsor/lookup?code=' + c.j.code.toLowerCase().replace('-', ' '), null, teacher)
  assert.deepStrictEqual([look.s, look.j.name, look.j.school, look.j.ageBand], [200, 'Kid A', 'classlink', '13-17'])
  const ok = await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'teacher' }, teacher)
  assert.deepStrictEqual([ok.s, ok.j.state], [200, 'active_restricted'], 'a minor with an approving grown-up: the restricted kid mode')
  const f = await state(w, kid); assert.deepStrictEqual([f.state, f.sponsor], ['active_restricted', { name: 'Ms T', role: 'teacher' }])
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'teacher' }, teacher)).s, 404, 'a code works once')
  const tUser = Object.values(w.auth.getUsers()).find(u => u.name === 'Ms T'); assert.strictEqual(tUser.sponsoring.length, 1)
  w.close()
})

await t('minors stay waiting unless the operator switched the approval method on (a legal decision)', async () => {
  const w = await world({})
  const kid = await w.school({ id: 't1:101', email: null, name: 'Kid B', emailVerified: false, staff: false })
  await w.call('/auth/account/facts', { ageBand: 'under13', acceptTerms: true }, kid)
  const c = await w.call('/auth/sponsor/code', {}, kid)
  const mom = await w.adult('mom@example.test', 'Mom')
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'parent' }, mom)).j.state, 'guardian_pending')
  w.close()
})

await t('an adult-aged school student still needs approval (the school decides), and becomes fully active after it', async () => {
  const w = await world({})
  const kid = await w.school({ id: 't1:102', email: null, name: 'Senior', emailVerified: false, staff: false })
  await w.call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, kid)
  assert.strictEqual((await state(w, kid)).state, 'awaiting_adult')
  const c = await w.call('/auth/sponsor/code', {}, kid); const dad = await w.adult('dad@example.test', 'Dad')
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'parent' }, dad)).j.state, 'active')
  w.close()
})

await t('staff on the school\'s word need no approval and count as adults', async () => {
  const w = await world({})
  const teacher = await w.school({ id: 't1:200', email: null, name: 'Mr Staff', emailVerified: false, staff: true })
  assert.strictEqual((await state(w, teacher)).state, 'needs_terms', 'age comes from the school roster')
  await w.call('/auth/account/facts', { acceptTerms: true }, teacher)
  assert.strictEqual((await state(w, teacher)).state, 'active')
  assert.strictEqual((await w.call('/auth/sponsor/code', {}, teacher)).s, 409, 'nothing to approve')
  w.close()
})

await t('who may approve: an active adult only, never a student, never yourself; codes cannot be guessed', async () => {
  const w = await world({})
  const kid = await w.school({ id: 't1:103', email: null, name: 'Kid C', emailVerified: false, staff: false })
  await w.call('/auth/account/facts', { ageBand: '13-17', acceptTerms: true }, kid)
  const c = await w.call('/auth/sponsor/code', {}, kid)
  const other = await w.school({ id: 't1:104', email: null, name: 'Kid D', emailVerified: false, staff: false })
  await w.call('/auth/account/facts', { ageBand: 'adult', acceptTerms: true }, other)
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'parent' }, other)).s, 403, 'a student cannot approve')
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'teacher' }, kid)).s, 403, 'not yourself')
  await w.call('/auth/register', { email: 'new@example.test', password: 'a-long-password-1', name: 'New' })
  const fresh = (await w.call('/auth/login', { email: 'new@example.test', password: 'a-long-password-1' })).j.token
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'parent' }, fresh)).s, 403, 'an adult who has not finished their own set-up')
  const grown = await w.adult('g@example.test', 'G')
  assert.strictEqual((await w.call('/auth/sponsor/approve', { code: c.j.code, as: 'boss' }, grown)).s, 400)
  let last = 0; for (let i = 0; i < 22; i++) last = (await w.call('/auth/sponsor/lookup?code=AAAA-AAAA', null, grown)).s
  assert.strictEqual(last, 429, 'trying codes is limited')
  w.close()
})

console.log(`grown-up approval tests passed (${n})`)
