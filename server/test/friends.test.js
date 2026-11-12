// Tests for the friends graph and project sharing (server/friends.js): no network; requests are fed to the handler directly.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createFriends, defaultHandleOf } from '../friends.js'
import { call } from './fakehttp.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'friends-test-'))
const names = ['alice', 'bob', 'carol', 'agent-coder', 'dana@example.com', 'guest~abc123']
const tokens = new Map(names.map(n => [crypto.randomBytes(8).toString('hex'), n]))
const tok = n => [...tokens].find(([, v]) => v === n)[0]
const identify = t => tokens.get(t) || null
const roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r)
let clock = 1_800_000_000_000
const mk = (extra = {}) => createFriends({ DATA, identify, roomOk, now: () => clock, ...extra })
let f = mk()
const get = (route, who) => call(f.http, { method: 'GET', url: '/api/friends' + route, headers: who ? { authorization: 'Bearer ' + tok(who) } : {} })
const post = (route, body, who) => call(f.http, { method: 'POST', url: '/api/friends/' + route, body, headers: who ? { authorization: 'Bearer ' + tok(who) } : {} })

// handles
assert.equal(defaultHandleOf('Alice'), 'alice'); assert.equal(defaultHandleOf('dana@example.com'), null, 'an email is never a handle')
assert.equal(defaultHandleOf('agent-coder'), null); assert.equal(defaultHandleOf('guest~abc123'), null); assert.equal(defaultHandleOf('a'), null); assert.equal(defaultHandleOf('x'.repeat(40)), null)

// request, accept, list
assert.equal((await get('')).status, 401)
assert.deepEqual((await post('request', { to: 'bob' }, 'alice')).json, { status: 'pending' })
assert.deepEqual((await post('request', { to: 'bob' }, 'alice')).json, { status: 'pending' }, 'asking twice changes nothing')
assert.deepEqual((await get('', 'alice')).json, { me: 'alice', friends: [], incoming: [], outgoing: [{ handle: 'bob', ts: clock }] })
assert.deepEqual((await get('', 'bob')).json.incoming, [{ handle: 'alice', ts: clock }])
assert.equal((await post('accept', { from: 'bob' }, 'alice')).status, 404, 'you cannot accept your own request')
assert.equal((await post('accept', { from: 'carol' }, 'bob')).status, 404)
clock += 1000
assert.deepEqual((await post('accept', { from: 'alice' }, 'bob')).json, { status: 'friends' })
assert.deepEqual((await get('', 'alice')).json.friends, [{ handle: 'bob', since: clock }]); assert.deepEqual((await get('', 'bob')).json.friends, [{ handle: 'alice', since: clock }])
assert.equal((await post('request', { to: 'alice' }, 'bob')).status, 409); assert.equal((await post('accept', { from: 'alice' }, 'bob')).status, 404, 'a second accept finds nothing')

// requests that cross become a friendship; self and bad handles
await post('request', { to: 'carol' }, 'alice'); assert.deepEqual((await post('request', { to: 'alice' }, 'carol')).json, { status: 'friends' })
assert.equal((await post('request', { to: 'alice' }, 'alice')).json.error, 'self'); assert.equal((await post('request', { to: 'Bad Handle!' }, 'alice')).json.error, 'bad_handle')
assert.equal((await post('request', { to: 'dana@example.com' }, 'alice')).json.error, 'bad_handle'); assert.equal((await post('request', {}, 'alice')).status, 400)

// decline: silent for the sender
await post('request', { to: 'bob' }, 'carol'); // carol and bob are not friends yet
assert.equal((await post('remove', { who: 'carol' }, 'bob')).status, 404, 'an incoming request is declined, not removed')
assert.deepEqual((await post('decline', { from: 'carol' }, 'bob')).json, { ok: true })
assert.deepEqual((await get('', 'bob')).json.incoming, [])
assert.equal((await post('decline', { from: 'carol' }, 'bob')).status, 404)
await post('request', { to: 'bob' }, 'carol'); assert.deepEqual((await post('remove', { who: 'bob' }, 'carol')).json, { ok: true }, 'the sender can cancel')

// identities that cannot use friends
assert.equal((await post('request', { to: 'bob' }, 'agent-coder')).status, 403); assert.equal((await get('', 'guest~abc123')).status, 403)
assert.equal((await get('', 'dana@example.com')).json.error, 'no_handle')
assert.equal((await call(f.http, { method: 'GET', url: '/api/friends', headers: { authorization: 'Bearer nope' } })).status, 401)
assert.equal((await call(f.http, { method: 'GET', url: '/api/friendsx' })).notMine, true)

// projects shared with friends
assert.equal((await post('share', { room: 'cart-shop', with: 'bob', role: 'view' }, 'alice')).status, 200)
assert.equal((await post('share', { room: 'cart-shop', with: 'bob', role: 'edit' }, 'alice')).status, 200, 'sharing again updates the role')
assert.deepEqual((await get('/projects', 'bob')).json.withMe, [{ room: 'cart-shop', owner: 'alice', role: 'edit', ts: clock }])
assert.deepEqual((await get('/projects', 'alice')).json.byMe, [{ room: 'cart-shop', with: 'bob', role: 'edit', ts: clock }])
assert.deepEqual((await get('/projects', 'carol')).json, { byMe: [], withMe: [] })
assert.equal((await post('share', { room: 'cart-shop', with: 'dana', role: 'view' }, 'alice')).json.error, 'not_friends')
await post('request', { to: 'bob' }, 'carol'); assert.equal((await post('share', { room: 'cart-shop', with: 'bob', role: 'view' }, 'carol')).json.error, 'not_friends', 'a pending request is not a friendship')
assert.equal((await post('share', { room: 'Bad Room', with: 'bob', role: 'view' }, 'alice')).json.error, 'bad_room'); assert.equal((await post('share', { room: 'cart-shop', with: 'bob', role: 'root' }, 'alice')).json.error, 'bad_role')
assert.equal((await post('unshare', { room: 'cart-shop', with: 'bob' }, 'bob')).status, 404, 'only the owner can unshare')
assert.equal((await post('unshare', { room: 'cart-shop', with: 'bob' }, 'alice')).status, 200); assert.deepEqual((await get('/projects', 'bob')).json.withMe, [])
await post('share', { room: 'cart-shop', with: 'bob', role: 'view' }, 'alice'); await post('share', { room: 'api', with: 'alice', role: 'view' }, 'bob')
await post('remove', { who: 'bob' }, 'alice')
assert.deepEqual((await get('/projects', 'bob')).json, { byMe: [], withMe: [] }, 'unfriending ends sharing in both directions')
assert.deepEqual((await get('/projects', 'alice')).json, { byMe: [], withMe: [] })

// caps, throttle, restart
{
  const small = createFriends({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'friends-cap-')), identify, roomOk, now: () => clock, maxOutgoing: 2, mutationsPerMinute: 6 })
  small.request('alice', 'u1'); small.request('alice', 'u2')
  assert.throws(() => small.request('alice', 'u3'), e => e.code === 'too_many_requests')
  small.request('alice', 'u1'); small.request('alice', 'u1'); small.request('alice', 'u1')
  assert.throws(() => small.request('alice', 'u1'), e => e.code === 'slow_down')
  clock += 61000; small.request('alice', 'u1')
  const sm = createFriends({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'friends-cap-')), identify, roomOk, now: () => clock, maxFriends: 1 })
  sm.request('alice', 'u1'); sm.accept('u1', 'alice'); assert.throws(() => sm.request('alice', 'u2'), e => e.code === 'too_many_friends')
  const sh = createFriends({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'friends-cap-')), identify, roomOk, now: () => clock, maxShares: 1 })
  sh.request('alice', 'u1'); sh.accept('u1', 'alice'); sh.share('alice', { room: 'r1', with: 'u1', role: 'view' }); assert.throws(() => sh.share('alice', { room: 'r2', with: 'u1', role: 'view' }), e => e.code === 'too_many_shares')
}
f = mk(); assert.deepEqual((await get('', 'alice')).json.friends.map(x => x.handle), ['carol'], 'the graph survives a restart (and bob is gone)')
assert.equal(fs.statSync(path.join(DATA, 'friends', 'graph.json')).mode & 0o777, 0o600)

fs.rmSync(DATA, { recursive: true, force: true })
console.log('friends tests passed: request, accept, crossing requests, decline, cancel, remove, agents and emails refused, project shares, unfriend ends sharing, caps, throttle, restart')
