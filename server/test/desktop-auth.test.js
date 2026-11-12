// Desktop sign-in return (server/desktop-auth.js): the app starts a transaction, the person signs in on the website, the browser is sent back with a
// one-use code, and the app trades the code (plus its PKCE verifier) for a device session. Pure module: fake clock, fake random, fake store.
import assert from 'node:assert'
import crypto from 'node:crypto'
import { createDesktopAuth, CODE_TTL_MS, TX_TTL_MS } from '../desktop-auth.js'

const b64u = b => Buffer.from(b).toString('base64url')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
const verifierA = b64u(crypto.randomBytes(32))
const challengeOf = v => b64u(crypto.createHash('sha256').update(v).digest())

function rig (over = {}) {
  let t = 1_800_000_000_000; let n = 0
  const db = { txs: {} }
  const store = { load: () => JSON.parse(JSON.stringify(db)), save: v => { db.txs = JSON.parse(JSON.stringify(v.txs)) } }
  const users = { u1: { id: 'u1', name: 'Ann' }, u2: { id: 'u2', name: 'Bob' } }
  const admitted = new Set(['u1', 'u2']); const blockedState = { state: 'needs_age', next: 'age' }
  const sessions = []; const revoked = []
  const d = createDesktopAuth({
    store, now: () => t,
    random: len => Buffer.from(sha('seed' + ++n).slice(0, len * 2), 'hex'),
    getUser: id => users[id] || null,
    providers: () => ({ password: true, google: true, microsoft: false }),
    admissionFor: u => (admitted.has(u.id) ? { state: 'active', next: null, restrictions: {} } : { ...blockedState, restrictions: {} }),
    issueSession: (user, o) => { const tok = 'tok-' + sessions.length; sessions.push({ user: user.id, ...o, tok }); return tok },
    revokeSessionKey: key => { revoked.push(key); return true },
    ...over
  })
  return { d, db, store, tick: ms => { t += ms }, now: () => t, users, admitted, sessions, revoked, mk: () => createDesktopAuth({ store, now: () => t, random: () => crypto.randomBytes(24), getUser: id => users[id], providers: () => ({ password: true }), admissionFor: () => ({ state: 'active', restrictions: {} }), issueSession: () => 'x', revokeSessionKey: () => true }) }
}
const start = (r, o = {}) => r.d.create({ provider: 'password', challenge: challengeOf(verifierA), state: b64u(crypto.randomBytes(16)), redirect: 'loopback', port: 51234, deviceLabel: 'Ann laptop', clientVersion: '1.0.0', ip: '1.1.1.1', ...o })

// ---- happy path, loopback
{
  const r = rig(); const st = b64u(crypto.randomBytes(16))
  const c = start(r, { state: st }); assert.strictEqual(c.status, 201); const txId = c.body.txId
  assert.ok(txId.length >= 32 && c.body.expiresAt === r.now() + TX_TTL_MS)
  const pv = r.d.preview(txId); assert.strictEqual(pv.status, 200)
  assert.deepStrictEqual(Object.keys(pv.body).sort(), ['createdAt', 'deviceLabel', 'expiresAt', 'provider', 'status'], 'the preview leaks nothing else')
  assert.strictEqual(pv.body.status, 'pending'); assert.strictEqual(pv.body.deviceLabel, 'Ann laptop')
  const done = r.d.complete(r.users.u1, txId); assert.strictEqual(done.status, 200)
  const url = new URL(done.body.redirect)
  assert.strictEqual(url.origin, 'http://127.0.0.1:51234'); assert.strictEqual(url.pathname, '/vespr-cb'); assert.strictEqual(url.searchParams.get('state'), st)
  const code = url.searchParams.get('code'); assert.ok(code && !JSON.stringify(done.body).replace(done.body.redirect, '').includes(code), 'the code appears only inside the redirect')
  const ex = r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' })
  assert.strictEqual(ex.status, 200); assert.strictEqual(ex.body.token, 'tok-0'); assert.strictEqual(ex.body.admission.state, 'active')
  assert.deepStrictEqual(r.sessions[0], { user: 'u1', label: 'Ann laptop', installId: 'install-0001-abcd', kind: 'device', tok: 'tok-0' })
  // storage holds only hashes: no tx id, no code, no verifier
  const raw = JSON.stringify(r.db); for (const secret of [txId, code, verifierA, 'tok-0']) assert.ok(!raw.includes(secret), 'a secret was stored in the clear')
}
// ---- scheme fallback
{
  const r = rig(); const c = start(r, { redirect: 'scheme', port: undefined }); assert.strictEqual(c.status, 201)
  const u = new URL(r.d.complete(r.users.u1, c.body.txId).body.redirect)
  assert.strictEqual(u.protocol, 'vespr:'); assert.strictEqual(u.hostname + u.pathname, 'auth/done')
}
// ---- the start request is strict: no free redirect URL, only the two fixed targets
{
  const r = rig(); const bad = o => assert.strictEqual(start(r, o).status, 400, JSON.stringify(o))
  bad({ challenge: 'short' }); bad({ challenge: 'a'.repeat(43) + '!' }); bad({ challenge: 'a'.repeat(44) }); bad({ challenge: undefined })
  bad({ state: '' }); bad({ state: 'x'.repeat(65) }); bad({ state: 'has space and ünïcode' }); bad({ state: 'a'.repeat(15) })
  bad({ redirect: 'http://evil.example/cb' }); bad({ redirect: 'https://127.0.0.1:5000/vespr-cb' }); bad({ redirect: undefined })
  bad({ port: 80 }); bad({ port: 1023 }); bad({ port: 65536 }); bad({ port: '51234; x' }); bad({ port: 51234.5 }); bad({ port: undefined })
  bad({ redirect: 'scheme', port: 51234 }); bad({ provider: 'github-evil' }); bad({ provider: 'microsoft' }) // not configured
  bad({ provider: undefined }); bad({ deviceLabel: 5 }); bad({ clientVersion: {} })
  assert.strictEqual(start(r, { port: '51234' }).status, 400, 'a port must be a number')
  const long = start(r, { deviceLabel: 'x'.repeat(200) + '\n\u0007' }); assert.strictEqual(long.status, 201)
  assert.strictEqual(r.d.preview(long.body.txId).body.deviceLabel.length, 60, 'the label is cut and cleaned'); assert.ok(!/[\u0000-\u001f]/.test(r.d.preview(long.body.txId).body.deviceLabel))
  assert.strictEqual(start(r, { provider: 'google' }).status, 201, 'a configured provider is allowed')
}
// ---- the verifier must match; five wrong tries kill the transaction
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  const other = b64u(crypto.randomBytes(32))
  for (let i = 0; i < 4; i++) assert.strictEqual(r.d.exchange({ txId, code, verifier: other, installId: 'install-0001-abcd' }).status, 400)
  assert.strictEqual(r.d.preview(txId).body.status, 'ready', 'still alive after four failures')
  assert.strictEqual(r.d.exchange({ txId, code: 'not-the-code'.padEnd(43, 'x'), verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'fifth failure (wrong code)')
  assert.strictEqual(r.d.preview(txId).body.status, 'cancelled', 'five failures cancel it')
  assert.strictEqual(r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'even the right pair is refused afterwards')
  assert.strictEqual(r.sessions.length, 0, 'no session was ever issued')
}
// ---- time: code 60 s, transaction 10 min
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  r.tick(CODE_TTL_MS + 1)
  assert.strictEqual(r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'code older than 60 s')
  const again = r.d.complete(r.users.u1, txId); assert.strictEqual(again.status, 200, 'the browser may mint a fresh code while the transaction lives')
  r.tick(TX_TTL_MS); assert.strictEqual(r.d.complete(r.users.u1, txId).status, 404, 'transaction expired'); assert.strictEqual(r.d.preview(txId).status, 404)
  const r2 = rig(); const t2 = start(r2).body.txId; r2.tick(TX_TTL_MS + 1); assert.strictEqual(r2.d.complete(r2.users.u1, t2).status, 404)
  // a code minted a second before the transaction ends is still inside its own 60 s, but the transaction is over: refused
  const r3 = rig(); const t3 = start(r3).body.txId; r3.tick(TX_TTL_MS - 1000); const c3 = new URL(r3.d.complete(r3.users.u1, t3).body.redirect).searchParams.get('code')
  r3.tick(2000); assert.strictEqual(r3.d.exchange({ txId: t3, code: c3, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'the transaction ended before the code did')
}
// ---- replay: the second use fails AND revokes the session the first use created
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  const ok = r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }); assert.strictEqual(ok.status, 200)
  const replay = r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' })
  assert.strictEqual(replay.status, 400); assert.strictEqual(replay.body.error, 'code_used'); assert.deepStrictEqual(r.revoked, [sha('tok-0')], 'the session made from the first use is revoked (by its stored key, not its token)')
  assert.strictEqual(r.sessions.length, 1, 'the replay did not mint another session')
  // a failed attempt on a transaction that was never used revokes nothing
  const t2 = start(r).body.txId; r.d.complete(r.users.u1, t2); r.d.exchange({ txId: t2, code: 'x'.repeat(43), verifier: verifierA, installId: 'install-0001-abcd' }); assert.deepStrictEqual(r.revoked, [sha('tok-0')])
}
// ---- admission is enforced on the server, at complete AND again at exchange
{
  const r = rig(); r.admitted.delete('u1'); const txId = start(r).body.txId
  const blocked = r.d.complete(r.users.u1, txId); assert.strictEqual(blocked.status, 403)
  assert.deepStrictEqual({ error: blocked.body.error, state: blocked.body.state, next: blocked.body.next }, { error: 'not_admitted', state: 'needs_age', next: 'age' })
  assert.ok(!JSON.stringify(blocked.body).includes('code='), 'no code for a blocked account'); assert.strictEqual(r.d.preview(txId).body.status, 'pending')
  r.admitted.add('u1'); const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code') // the same transaction resumes after the account is completed
  r.admitted.delete('u1') // suspended / guardian revoked between the two steps
  const ex = r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }); assert.strictEqual(ex.status, 403); assert.strictEqual(ex.body.state, 'needs_age')
  assert.strictEqual(r.sessions.length, 0, 'no session for an account that is no longer admitted')
}
// ---- re-minting: a fresh code replaces the old one, three at most, always the same person
{
  const r = rig(); const txId = start(r).body.txId; const first = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  const second = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code'); assert.notStrictEqual(first, second)
  assert.strictEqual(r.d.exchange({ txId, code: first, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'the older code no longer works')
  assert.strictEqual(r.d.complete(r.users.u2, txId).status, 409, 'someone else cannot take over a transaction already bound to a person')
  assert.strictEqual(r.d.complete(r.users.u1, txId).status, 200); assert.strictEqual(r.d.complete(r.users.u1, txId).status, 429, 'a fourth mint is refused')
}
// ---- cancel
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  assert.strictEqual(r.d.cancel({ txId, verifier: b64u(crypto.randomBytes(32)) }).status, 403, 'a wrong verifier cannot cancel')
  assert.strictEqual(r.d.cancel({ txId }).status, 200, 'the browser can cancel with the transaction id alone')
  assert.strictEqual(r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'a late code is refused after cancel'); assert.strictEqual(r.d.complete(r.users.u1, txId).status, 409)
  const t2 = start(r).body.txId; const c2 = new URL(r.d.complete(r.users.u1, t2).body.redirect).searchParams.get('code'); r.d.exchange({ txId: t2, code: c2, verifier: verifierA, installId: 'install-0001-abcd' })
  assert.strictEqual(r.d.cancel({ txId: t2, verifier: verifierA }).status, 409, 'a used transaction cannot be cancelled'); assert.strictEqual(r.d.cancel({ txId: 'nope' }).status, 404)
}
// ---- many sign-ins at once stay apart
{
  const r = rig(); const a = start(r).body.txId; const b = start(r).body.txId; assert.notStrictEqual(a, b)
  const codeB = new URL(r.d.complete(r.users.u2, b).body.redirect).searchParams.get('code'); r.d.complete(r.users.u1, a)
  assert.strictEqual(r.d.exchange({ txId: a, code: codeB, verifier: verifierA, installId: 'install-0001-abcd' }).status, 400, 'B\'s code does not open A')
  assert.strictEqual(r.d.exchange({ txId: b, code: codeB, verifier: verifierA, installId: 'install-0001-abcd' }).status, 200)
  assert.strictEqual(r.sessions[0].user, 'u2')
}
// ---- the exchange checks its own input
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  for (const bad of [{ installId: 'short' }, { installId: 'bad id with spaces!!' }, { installId: undefined }, { verifier: 'tooshort' }, { verifier: 'a'.repeat(129) }, { verifier: undefined }, { code: undefined }, { code: 5 }, { txId: undefined }, { txId: {} }]) {
    assert.ok([400, 404].includes(r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd', ...bad }).status), JSON.stringify(bad))
  }
  assert.strictEqual(r.d.preview('nope').status, 404); assert.strictEqual(r.d.preview(undefined).status, 404); assert.strictEqual(r.d.preview({}).status, 404)
  assert.strictEqual(r.d.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }).status, 200, 'the good request still works after the bad ones (only five failures kill it)')
}
// ---- start requests are rate limited per address
{
  const r = rig(); for (let i = 0; i < 20; i++) assert.strictEqual(start(r, { ip: '9.9.9.9' }).status, 201)
  assert.strictEqual(start(r, { ip: '9.9.9.9' }).status, 429); assert.strictEqual(start(r, { ip: '8.8.8.8' }).status, 201, 'another address is unaffected')
  r.tick(10 * 60 * 1000 + 1); assert.strictEqual(start(r, { ip: '9.9.9.9' }).status, 201, 'the window passes')
}
// ---- a restarted server keeps its transactions (state lives in the store, not in memory)
{
  const r = rig(); const txId = start(r).body.txId; const code = new URL(r.d.complete(r.users.u1, txId).body.redirect).searchParams.get('code')
  const restarted = r.mk(); assert.strictEqual(restarted.exchange({ txId, code, verifier: verifierA, installId: 'install-0001-abcd' }).status, 200)
}
console.log('desktop auth unit tests passed')
