// The classroom story, with the REAL account and role code: a student and a teacher sign in through a (faked) school provider, the real auth module makes their
// accounts (server/auth.js schoolAccount: a student, and a teacher the school says is staff), and the payment flow (server/pay.js) asks the real policy
// (server/policy.js approval.decide) who may answer. An agent asks for a payment; the student cannot approve, refund or answer it and is told why;
// the teacher (and an adult with an operator token) can. PayPal is faked, nothing else is.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createRequire } from 'node:module'
import { createAuth } from '../auth.js'
import { createPay } from '../pay.js'
import { createPayPal } from '../paypal.js'
import { createFakePayPal } from './fakepaypal.js'
import { call } from './fakehttp.js'
const Y = createRequire(import.meta.url)('yjs')

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const ID = 'school-id-' + 'a'.repeat(16); const SECRET = 'school-secret-' + 'b'.repeat(16)
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-school-'))
let profile = null
const classlink = { authorizeUrl: ({ state }) => 'https://launchpad.example/auth?state=' + state, exchange: async () => profile }
const auth = createAuth({ DATA: path.join(DATA, 'auth'), identifyToken: () => null, oauthProviders: { classlink }, config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1', VESPR_AUTH_ALLOWED_NEXT: '/app/' } })
const authSrv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => authSrv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${authSrv.address().port}`
const signIn = async p => { // the real ClassLink-shaped sign-in flow of server/auth.js, with the provider faked
  profile = p
  const s = await fetch(base + '/auth/start/classlink?next=/app/', { redirect: 'manual' }); const state = new URL(s.headers.get('location')).searchParams.get('state')
  const cb = await fetch(base + '/auth/callback/classlink?' + new URLSearchParams({ state, code: 'c' }), { redirect: 'manual', headers: { cookie: 'vespr_oauth_state=' + state } })
  assert.strictEqual(cb.status, 302); return (cb.headers.get('location') || '').split('#token=')[1]
}
const studentTok = await signIn({ id: 'tenant9:5551', email: null, name: 'Sam Student', emailVerified: false })
const teacherTok = await signIn({ id: 'tenant9:6662', email: null, name: 'Terry Teacher', emailVerified: false, staff: true })
const student = auth.getSessionUser(studentTok); const teacher = auth.getSessionUser(teacherTok)
eq([student.school.staff, teacher.school.staff], [false, true], 'the real auth module made a student and a staff account'); ok(!student.age && teacher.age.claims[0].band === 'adult', 'staff are adults on the school’s word; the student has no adult age')

const operator = { 'tok-coder': 'coder', 'tok-alex': 'alex' }
const identify = t => auth.identify(t) || operator[t]
const fake = createFakePayPal({ clientId: ID, clientSecret: SECRET })
let clock = 1_800_000_000_000
const docs = new Map(); const getDoc = r => { if (!docs.has(r)) docs.set(r, new Y.Doc()); return docs.get(r) }
const pay = createPay({ DATA: path.join(DATA, 'pay'), identify, isAgent: w => w === 'coder', Y, getDoc, now: () => clock, log: () => {}, sweepMs: 3600_000, userOf: t => auth.getSessionUser(t),
  paypal: createPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: fake.fetch, now: () => clock, log: () => {} }) })
const api = (method, url, token, body) => call(pay.http, { method, url, headers: { host: 'school.test:8241', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body })
const ask = body => api('POST', '/api/pay/class/request', 'tok-coder', body)
const answer = (tok, id, approve) => api('POST', '/api/pay/class/answer', tok, { id, approve })
const refund = (tok, id) => api('POST', '/api/pay/class/refund', tok, { id })

// the student's agent asks; everyone in the room sees the card
const a = await ask({ amount: '12.50', label: 'Poster printing', reason: 'The science fair poster is due Friday' }); eq(a.status, 201); const id = a.json.request.id
eq(getDoc('class').getArray('chat').toArray().find(m => m.get('id') === 'pay-' + id).get('status'), 'pending')

// the student cannot answer: the server says why, in the real policy's words, and nothing is created at PayPal
const no = await answer(studentTok, id, true); eq([no.status, no.json.error], [403, 'Students cannot approve payments.'])
eq((await answer(studentTok, id, false)).status, 403, 'not even a No: a student answers nothing'); eq(fake.state.creates, 0); eq(pay.reqs('class')[0].status, 'pending')
const list = await api('GET', '/api/pay/class', studentTok); eq([list.json.canAnswer, list.json.whyNot], [false, 'Students cannot approve payments.'], 'the room list tells the student why, so the card can say it')
const tl = await api('GET', '/api/pay/class', teacherTok); eq([tl.json.canAnswer, tl.json.whyNot], [true, ''])

// the teacher approves; the buyer pays; it is captured; the student still cannot refund it, the teacher can
const yes = await answer(teacherTok, id, true); eq([yes.status, yes.json.request.status, yes.json.request.decidedBy], [200, 'awaiting_buyer', 'Terry Teacher'])
fake.approve(yes.json.request.orderId); const done = await api('POST', '/api/pay/class/check', studentTok, { id }); eq(done.json.request.status, 'captured', 'a student can see and check it, never decide it')
eq((await refund(studentTok, id)).status, 403, 'a student cannot refund'); eq(fake.state.refunds, 0)
const rf = await refund(teacherTok, id); eq([rf.status, rf.json.request.status, rf.json.request.refundedBy], [200, 'refunded', 'Terry Teacher'])
eq(pay.reqs('class')[0].trail.map(t => `${t.to}:${t.by}`), ['pending:coder', 'awaiting_buyer:Terry Teacher', 'captured:PayPal', 'refunded:Terry Teacher'], 'the room history names who did what')

// an adult with an operator token can approve too (the existing member role), and the agent still cannot
const b = await ask({ amount: '5', label: 'Glue', reason: 'For the poster' }); eq((await answer('tok-coder', b.json.request.id, true)).status, 403, 'the agent cannot approve'); eq((await answer('tok-alex', b.json.request.id, false)).json.request.decidedBy, 'alex')
// a school student's session also cannot make the agent's request for it: only an agent asks
eq((await api('POST', '/api/pay/class/request', studentTok, { amount: '5', label: 'x' })).status, 403, 'only agents ask')

authSrv.close(); pay.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`pay school tests passed (${n}): real auth accounts and the real approval.decide policy: the student's agent asks, the student cannot approve, deny or refund and is told why, the teacher and an adult can, the agent cannot`)
process.exit(0)
