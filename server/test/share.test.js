// Tests for share links (server/share.js): no network, no real server; requests are fed to the handler directly. Tokens are generated at run time.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createShare, hashToken, safeRel } from '../share.js'
import { call } from './fakehttp.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'share-test-'))
const people = new Map([[crypto.randomBytes(8).toString('hex'), 'alice'], [crypto.randomBytes(8).toString('hex'), 'bob'], [crypto.randomBytes(8).toString('hex'), 'agent-coder']])
const tok = n => [...people].find(([, v]) => v === n)[0]
const identify = t => people.get(t) || null
const roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r)
let clock = 1_800_000_000_000
const now = () => clock
const files = new Map([['demo/src/app.js', 'console.log("hi")\n']])
const mk = (extra = {}) => createShare({ DATA, identify, roomOk, now, readFile: (room, rel) => files.get(room + '/' + rel) ?? null, ...extra })
let s = mk()
const as = (n, extra = {}) => ({ headers: { authorization: 'Bearer ' + tok(n) }, ...extra })
const post = (route, body, who, ip) => call(s.http, { method: 'POST', url: '/api/share/' + route, body, ip, ...(who ? as(who) : {}) })
const make = async (body, who = 'alice') => (await post('create', body, who)).json

// ── create: the token is long and random, the server keeps only a hash
const a = await post('create', { room: 'demo', role: 'view' }, 'alice')
assert.equal(a.status, 201)
assert.match(a.json.token, /^[A-Za-z0-9_-]{43}$/, '256-bit token as base64url')
assert.equal(a.headers['referrer-policy'], 'no-referrer'); assert.equal(a.headers['cache-control'], 'no-store')
const disk = fs.readFileSync(path.join(DATA, 'share', 'links.json'), 'utf8')
assert.ok(!disk.includes(a.json.token), 'the token itself is never stored')
assert.ok(disk.includes(hashToken(a.json.token)), 'its SHA-256 is')
assert.equal(fs.statSync(path.join(DATA, 'share', 'links.json')).mode & 0o777, 0o600)
assert.equal(hashToken('abc'), crypto.createHash('sha256').update('abc').digest('hex'))
const seen = new Set(); for (let i = 0; i < 60; i++) seen.add((await make({ room: 'demo', role: 'view' })).token); assert.equal(seen.size, 60, 'no repeats')

// ── validation
for (const [body, err] of [
  [{ room: 'Bad Room', role: 'view' }, 'bad_room'], [{ role: 'view' }, 'bad_room'], [{ room: 'demo', role: 'admin' }, 'bad_role'], [{ room: 'demo' }, 'bad_role'],
  [{ room: 'demo', role: 'view', file: '../etc/passwd' }, 'bad_file'], [{ room: 'demo', role: 'view', file: 5 }, 'bad_file'], [{ room: 'demo', role: 'edit', file: 'a.js' }, 'edit_needs_room'],
  [{ room: 'demo', role: 'view', expiresInSec: 5 }, 'bad_expiry'], [{ room: 'demo', role: 'view', expiresInSec: 1e9 }, 'bad_expiry'], [{ room: 'demo', role: 'view', expiresInSec: '60' }, 'bad_expiry']
]) { const r = await post('create', body, 'alice'); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.error, err) }
assert.equal((await post('create', { room: 'demo', role: 'view' })).status, 401, 'login needed to create')
assert.equal((await post('create', { room: 'demo', role: 'view' }, 'agent-coder')).status, 403, 'agents cannot mint links')
assert.equal((await call(s.http, { method: 'POST', url: '/api/share/create', ...as('alice'), body: '{nope' })).status, 400)
assert.equal((await call(s.http, { method: 'POST', url: '/api/share/create', ...as('alice'), body: 'x'.repeat(5000) })).status, 413)
assert.equal((await call(s.http, { method: 'GET', url: '/api/share/create', ...as('alice') })).status, 405)
assert.equal((await call(s.http, { method: 'GET', url: '/api/other' })).notMine, true, 'other routes pass through')
assert.equal(safeRel('a/../../x'), null); assert.equal(safeRel('a\\..\\b'), null); assert.equal(safeRel('/src//a.js'), 'src/a.js')

// ── resolve: same answer for unknown, malformed, expired and revoked
const exp = await make({ room: 'demo', role: 'view', expiresInSec: 3600 })
const rev = await make({ room: 'demo', role: 'edit' })
let r = await post('resolve', { token: a.json.token })
assert.equal(r.status, 200); assert.deepEqual(r.json, { room: 'demo', file: null, role: 'view', expiresAt: null, by: 'alice' })
assert.equal((await post('resolve', { token: exp.token })).status, 200)
clock += 3600 * 1000 - 1; assert.equal((await post('resolve', { token: exp.token })).status, 200, 'still valid 1 ms before expiry')
clock += 1
const dead = await post('resolve', { token: exp.token })
assert.equal((await post('revoke', { id: rev.id }, 'bob')).status, 404, 'only the creator can revoke')
assert.equal((await post('resolve', { token: rev.token })).status, 200, 'a failed revoke changed nothing')
assert.equal((await post('revoke', { id: rev.id }, 'alice')).status, 200)
const gone = await post('resolve', { token: rev.token })
const unknown = await post('resolve', { token: crypto.randomBytes(32).toString('base64url') })
const junk = await post('resolve', { token: 'short' })
const missing = await post('resolve', {})
for (const x of [dead, gone, unknown, junk, missing]) { assert.equal(x.status, 404); assert.deepEqual(x.json, { error: 'link_invalid' }) }
assert.deepEqual([dead.raw, gone.raw, unknown.raw].map(x => x.length), [dead.raw.length, dead.raw.length, dead.raw.length], 'the three look identical')
assert.equal((await post('revoke', { id: rev.id }, 'alice')).status, 200, 'revoking twice is fine')

// ── list: yours only, never the token, with a state
const l = await call(s.http, { method: 'GET', url: '/api/share/list?room=demo', ...as('alice') })
assert.ok(l.json.links.length >= 60); assert.ok(!l.raw.includes(a.json.token)); assert.ok(l.raw.indexOf('"token"') < 0)
assert.equal(l.json.links.find(x => x.id === rev.id).state, 'revoked'); assert.equal(l.json.links.find(x => x.id === exp.id).state, 'expired')
assert.deepEqual((await call(s.http, { method: 'GET', url: '/api/share/list', ...as('bob') })).json.links, [])
assert.equal((await call(s.http, { method: 'GET', url: '/api/share/list' })).status, 401)

// ── file links: read only, through POST
const f = await make({ room: 'demo', role: 'view', file: 'src/app.js', label: 'x\u0000y' })
assert.equal(f.file, 'src/app.js'); assert.equal(f.label, 'xy')
r = await post('file', { token: f.token }); assert.equal(r.status, 200); assert.equal(r.json.text, 'console.log("hi")\n')
assert.equal((await post('file', { token: a.json.token })).json.error, 'not_a_file_link')
const nof = await make({ room: 'demo', role: 'view', file: 'nope.js' }); assert.equal((await post('file', { token: nof.token })).status, 404)
assert.equal(s.guest(f.token, 'demo', 'ip'), null, 'a file link never opens a realtime socket')

// ── the realtime door
const g = s.guest(a.json.token, 'demo', '1.1.1.1')
assert.ok(g && g.role === 'view' && /^guest~[0-9a-f]{6}$/.test(g.who))
assert.equal(s.guest(a.json.token, 'other', '1.1.1.1'), null, 'a link opens its own room only')
assert.equal(s.guest('x'.repeat(43), 'demo', '1.1.1.1'), null)
assert.equal(identify(a.json.token), null, 'the link token is not a general login')
assert.equal((await call(s.http, { method: 'POST', url: '/api/share/create', body: { room: 'demo', role: 'view' }, headers: { authorization: 'Bearer ' + a.json.token } })).status, 401, 'a link cannot make links')

// view drops document edits, edit does not; awareness always passes
const sync = k => Buffer.from([0, k, 1, 2, 3]); const aware = Buffer.from([1, 4, 5])
assert.equal(s.mayForward('view', sync(0)), true, 'state vector request')
assert.equal(s.mayForward('view', sync(1)), false, 'sync step 2'); assert.equal(s.mayForward('view', sync(2)), false, 'update')
assert.equal(s.mayForward('view', aware), true); assert.equal(s.mayForward('view', Buffer.from([])), false); assert.equal(s.mayForward('view', Buffer.from([9, 9])), false)
assert.equal(s.mayForward('view', new Uint8Array(sync(2)).buffer), false, 'ArrayBuffer frames too')
assert.equal(s.mayForward('edit', sync(2)), true)
const fakeWs = () => { const e = new EventEmitter(); e.closed = null; e.close = (c, why) => { e.closed = [c, why]; e.emit('close') }; return e }
const w = fakeWs(); const got = []; s.restrict(w, 'view'); w.on('message', d => got.push([...d])); w.on('close', () => got.push('closed'))
w.emit('message', sync(2)); w.emit('message', aware); w.emit('message', sync(0)); w.emit('message', sync(1))
assert.deepEqual(got, [[1, 4, 5], [0, 0, 1, 2, 3]], 'only awareness and the state request reach the document')
const w2 = fakeWs(); const got2 = []; s.restrict(w2, 'edit'); w2.on('message', d => got2.push(d)); w2.emit('message', sync(2)); assert.equal(got2.length, 1)

// revoke and expiry close open sockets
const w3 = fakeWs(); s.attach(w3, g); assert.equal((await post('revoke', { id: g.id }, 'alice')).status, 200); assert.deepEqual(w3.closed, [4403, 'revoked'])
assert.equal(s.guest(a.json.token, 'demo', '1.1.1.1'), null, 'revoked: no new sockets either')
const w4 = fakeWs(); s.attach(w4, { id: 'zz', expiresAt: Date.now() + 40 }); await new Promise(r => setTimeout(r, 120)); assert.deepEqual(w4.closed, [4401, 'expired'])
const w6 = fakeWs(); s.attach(w6, { id: 'zx', expiresAt: Date.now() + 40 }); w6.emit('close'); await new Promise(r => setTimeout(r, 120)); assert.equal(w6.closed, null, 'a closed socket leaves no timer behind')
const w5 = fakeWs(); s.attach(w5, { id: 'zy', expiresAt: null }); w5.emit('close') // no timer left behind

// ── rate limit: failed guesses per address
const s2 = mk({ maxFailures: 5 }); const ok = await (async () => (await call(s2.http, { method: 'POST', url: '/api/share/create', body: { room: 'demo', role: 'view' }, ...as('alice') })).json)()
const guess = ip => call(s2.http, { method: 'POST', url: '/api/share/resolve', body: { token: crypto.randomBytes(32).toString('base64url') }, ip })
for (let i = 0; i < 5; i++) assert.equal((await guess('9.9.9.9')).status, 404)
const blocked = await guess('9.9.9.9'); assert.equal(blocked.status, 429)
assert.equal((await call(s2.http, { method: 'POST', url: '/api/share/resolve', body: { token: ok.token }, ip: '9.9.9.9' })).status, 429, 'even the right token waits while blocked')
assert.equal((await call(s2.http, { method: 'POST', url: '/api/share/resolve', body: { token: ok.token }, ip: '8.8.8.8' })).status, 200, 'other addresses are not affected')
assert.equal(s2.guest(ok.token, 'demo', '9.9.9.9'), null, 'the WebSocket door shares the limit')
clock += 10 * 60 * 1000 + 1; assert.equal((await call(s2.http, { method: 'POST', url: '/api/share/resolve', body: { token: ok.token }, ip: '9.9.9.9' })).status, 200, 'the window passes')
assert.equal(s2.clientIp({ headers: { 'x-forwarded-for': '6.6.6.6' }, socket: { remoteAddress: '1.2.3.4' } }), '1.2.3.4', 'a spoofed forwarding header is ignored by default')
assert.equal(mk({ trustProxy: true }).clientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 5.5.5.5' }, socket: { remoteAddress: '1.2.3.4' } }), '5.5.5.5')

// a guest-named identity (should never come from identify, but if it does) cannot make or list links
const gt = crypto.randomBytes(8).toString('hex'); const sg = mk({ identify: x => (x === gt ? 'guest~abc123' : identify(x)) })
assert.equal((await call(sg.http, { method: 'POST', url: '/api/share/create', body: { room: 'demo', role: 'view' }, headers: { authorization: 'Bearer ' + gt } })).status, 401)

// ── limits and persistence
const s3 = mk({ maxLinksPerUser: 2 }); const mk3 = () => call(s3.http, { method: 'POST', url: '/api/share/create', body: { room: 'tiny', role: 'view' }, ...as('bob') })
const first = (await mk3()).json; assert.equal((await mk3()).status, 201); assert.equal((await mk3()).status, 429)
await call(s3.http, { method: 'POST', url: '/api/share/revoke', body: { id: first.id }, ...as('bob') }); assert.equal((await mk3()).status, 201, 'revoked links free a slot')
s = mk() // a restart: a new instance reads the same file
assert.equal((await post('resolve', { token: a.json.token })).status, 404, 'revoked stays revoked')
assert.equal((await post('resolve', { token: f.token })).status, 200, 'active stays active after a restart')

fs.rmSync(DATA, { recursive: true, force: true })
console.log('share tests passed: hashed storage, 256-bit tokens, validation, uniform 404, expiry, revoke (creator only, closes sockets), view/edit socket filter, file links, rate limit, caps, restart')
