// Direct and group messages (server/dm.js) and account handles (server/handles.js): no network, requests go straight to the handler.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDm, isDmRoom, reservedRoom, DM_LIMITS } from '../dm.js'
import { createHandles } from '../handles.js'
import { call } from './fakehttp.js'

// ---- handles
{ const users = { u1: { id: 'u1', name: 'Alex Morgan', email: 'alex@school.edu' }, u2: { id: 'u2', name: 'Alex Morgan', email: 'alex2@x.com' }, u3: { id: 'u3', name: '', email: 'sam.rivera@x.com' }, u4: { id: 'u4', name: 'agent-coder' }, u5: { id: 'u5', name: '漢字' }, u6: { id: 'u6', name: 'a' }, u7: { id: 'u7', handle: 'chosen', name: 'Somebody' } }
  let saves = 0; const h = createHandles({ getUsers: () => users, saveUsers: () => { saves++ } })
  assert.strictEqual(h.ensure(users.u1), 'alexmorgan'); assert.strictEqual(h.ensure(users.u1), 'alexmorgan', 'stable'); assert.strictEqual(h.ensure(users.u2), 'alexmorgan2', 'unique'); assert.strictEqual(h.ensure(users.u3), 'sam.rivera', 'from the email name when there is no name')
  assert.strictEqual(h.ensure(users.u4), 'user-agent-coder', 'agent-like names are not handles'); assert.strictEqual(h.ensure(users.u5), 'member', 'a name with no usable letters'); assert.strictEqual(h.ensure(users.u6), 'ax', 'at least two characters'); assert.strictEqual(h.ensure(users.u7), 'chosen', 'a chosen handle is kept')
  assert.ok(saves >= 5); assert.strictEqual(h.ensure(null), null)
  assert.strictEqual(h.handleOfIdentity('Alex Morgan'), 'alexmorgan', 'identity is the signed-in name'); assert.strictEqual(h.handleOfIdentity('alex@school.edu'), 'alexmorgan', 'or the email'); assert.strictEqual(h.handleOfIdentity('bob'), 'bob', 'token-file identities are their own handle'); assert.strictEqual(h.handleOfIdentity('a@b.com'), null, 'an email is never a handle'); assert.strictEqual(h.handleOfIdentity('agent-x'), null); assert.strictEqual(h.handleOfIdentity(''), null)
  assert.strictEqual(h.identityOfHandle('alexmorgan'), 'Alex Morgan'); assert.strictEqual(h.identityOfHandle('bob'), 'bob'); assert.strictEqual(h.identityOfHandle('bad handle!'), null) }

// ---- direct messages
const friendsOf = { alice: ['bob', 'carol', 'dave'], bob: ['alice', 'carol'], carol: ['alice', 'bob'], dave: ['alice'], erin: [] }
const areFriends = (a, b) => (friendsOf[a] || []).includes(b)
const tokens = { 'tok-alice': 'alice', 'tok-bob': 'bob', 'tok-carol': 'carol', 'tok-dave': 'dave', 'tok-erin': 'erin', 'tok-agent': 'agent-coder', 'tok-mail': 'a@b.com' }
const mk = (extra = {}) => createDm({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dm-')), identify: t => tokens[t] || null, handleOf: i => /^[a-z0-9][a-z0-9._-]{1,31}$/.test(i) && !/^agent/.test(i) ? i : null, areFriends, ...extra })
const post = (d, url, body, tok) => call(d.http.bind(d), { method: 'POST', url, headers: tok ? { authorization: 'Bearer ' + tok } : {}, body })
const get = (d, url, tok) => call(d.http.bind(d), { method: 'GET', url, headers: tok ? { authorization: 'Bearer ' + tok } : {} })

const d = mk()
assert.ok(isDmRoom('dm-0123456789abcdef') && !isDmRoom('dm-xyz') && !isDmRoom('dm-0123456789ABCDEF') && !isDmRoom('workspace') && !isDmRoom(null)); assert.ok(reservedRoom('dm-anything') && !reservedRoom('demo'))
assert.strictEqual((await get(d, '/api/dm/list')).status, 401); assert.strictEqual((await get(d, '/api/dm/list', 'nope')).status, 401); assert.strictEqual((await get(d, '/api/dm/list', 'tok-mail')).status, 400, 'an email identity has no handle'); assert.strictEqual((await get(d, '/api/dm/list', 'tok-agent')).status, 400, 'agents cannot message')
assert.strictEqual((await call(d.http.bind(d), { method: 'GET', url: '/api/other' })).notMine, true)
// open: friends only
let r = await post(d, '/api/dm/open', { with: ['bob'] }, 'tok-alice'); assert.strictEqual(r.status, 200); const t1 = r.json.thread; assert.ok(isDmRoom(t1.room)); assert.deepStrictEqual(t1.members, ['alice', 'bob']); assert.strictEqual(t1.kind, 'dm')
r = await post(d, '/api/dm/open', { with: ['alice'] }, 'tok-bob'); assert.strictEqual(r.json.thread.room, t1.room, 'the same two people always get the same conversation, whoever opens it')
r = await post(d, '/api/dm/open', { with: ['bob', 'bob', 'BOB'] }, 'tok-alice'); assert.strictEqual(r.json.thread.room, t1.room, 'duplicates collapse')
r = await post(d, '/api/dm/open', { with: ['erin'] }, 'tok-alice'); assert.strictEqual(r.status, 403); assert.strictEqual(r.json.error, 'not_friends'); assert.strictEqual((await post(d, '/api/dm/open', { with: ['agent-coder'] }, 'tok-alice')).status, 403)
for (const bad of [{}, { with: [] }, { with: 'bob' }, { with: ['alice'] }, { with: [null] }, { with: [''] }]) assert.strictEqual((await post(d, '/api/dm/open', bad, 'tok-alice')).status, 400, JSON.stringify(bad))
assert.strictEqual((await post(d, '/api/dm/open', 'not json', 'tok-alice')).status, 400)
// groups
r = await post(d, '/api/dm/open', { with: ['bob', 'carol'] }, 'tok-alice'); const g = r.json.thread; assert.strictEqual(g.kind, 'group'); assert.deepStrictEqual(g.members, ['alice', 'bob', 'carol']); assert.notStrictEqual(g.room, t1.room)
assert.strictEqual((await post(d, '/api/dm/open', { with: ['carol', 'bob'] }, 'tok-alice')).json.thread.room, g.room, 'order does not matter')
assert.strictEqual((await post(d, '/api/dm/open', { with: ['bob', 'dave'] }, 'tok-alice')).status, 200, 'friends of the opener need not be friends with each other')
// list shows only your own, with names
r = await get(d, '/api/dm/list', 'tok-alice'); assert.strictEqual(r.json.threads.length, 3); assert.ok(r.json.threads.every(t => t.members.some(m => m.handle === 'alice') && t.members.every(m => m.name)))
r = await get(d, '/api/dm/list', 'tok-dave'); assert.strictEqual(r.json.threads.length, 1); r = await get(d, '/api/dm/list', 'tok-erin'); assert.strictEqual(r.json.threads.length, 0)
// the realtime door
assert.strictEqual(d.allows(t1.room, 'alice'), true); assert.strictEqual(d.allows(t1.room, 'bob'), true); assert.strictEqual(d.allows(t1.room, 'carol'), false, 'not a member'); assert.strictEqual(d.allows(g.room, 'carol'), true)
assert.strictEqual(d.allows('dm-0123456789abcdef', 'alice'), false, 'nobody can squat a dm room that does not exist'); assert.strictEqual(d.allows('dm-nothex', 'alice'), false); assert.strictEqual(d.allows('workspace', 'erin'), true, 'ordinary rooms are not this module\'s business'); assert.strictEqual(d.allows(t1.room, 'a@b.com'), false); assert.strictEqual(d.allows(t1.room, 'agent-coder'), false); assert.strictEqual(d.allows(t1.room, ''), false)
// limits
{ const small = mk(); const many = Array.from({ length: DM_LIMITS.maxMembers }, (_, i) => 'f' + i); const fr = { ...friendsOf, alice: many }; const dd = createDm({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dm2-')), identify: t => tokens[t] || null, handleOf: i => i, areFriends: (a, b) => (fr[a] || []).includes(b) })
  assert.strictEqual((await post(dd, '/api/dm/open', { with: many }, 'tok-alice')).status, 400, 'too many people'); assert.strictEqual((await post(dd, '/api/dm/open', { with: many.slice(0, DM_LIMITS.maxMembers - 1) }, 'tok-alice')).status, 200) }
// stored, and read again
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm3-')); const mk2 = () => createDm({ DATA: dir, identify: t => tokens[t] || null, handleOf: i => i, areFriends }); const a = mk2(); const room = (await post(a, '/api/dm/open', { with: ['bob'] }, 'tok-alice')).json.thread.room; assert.strictEqual(mk2().allows(room, 'bob'), true) }
// ---- unfriending closes a one-to-one conversation (2026-11-11: a removed friend could still open the room); a group keeps its members; friending again brings it back
{ const fr = { alice: ['bob', 'carol'], bob: ['alice', 'carol'], carol: ['alice', 'bob'] }; const af = (a, b) => (fr[a] || []).includes(b)
  const dd = createDm({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'dm4-')), identify: t => tokens[t] || null, handleOf: i => i, areFriends: af })
  const one = (await post(dd, '/api/dm/open', { with: ['bob'] }, 'tok-alice')).json.thread.room
  const grp = (await post(dd, '/api/dm/open', { with: ['bob', 'carol'] }, 'tok-alice')).json.thread.room
  assert.strictEqual(dd.allows(one, 'bob'), true); assert.strictEqual(dd.allows(grp, 'bob'), true)
  fr.alice = ['carol']; fr.bob = ['carol'] // alice and bob stop being friends
  assert.strictEqual(dd.allows(one, 'bob'), false, 'the removed friend can no longer open the one-to-one room'); assert.strictEqual(dd.allows(one, 'alice'), false, 'and neither can the person who removed them (the conversation is closed for both)')
  assert.strictEqual(dd.allows(grp, 'bob'), true, 'a group keeps its members'); assert.strictEqual(dd.allows(grp, 'alice'), true)
  assert.deepStrictEqual((await get(dd, '/api/dm/list', 'tok-bob')).json.threads.map(t => t.kind), ['group'], 'the closed conversation leaves the list')
  assert.strictEqual((await post(dd, '/api/dm/open', { with: ['bob'] }, 'tok-alice')).status, 403, 'it cannot be reopened while they are not friends')
  fr.alice = ['bob', 'carol']; fr.bob = ['alice', 'carol'] // friends again
  assert.strictEqual(dd.allows(one, 'bob'), true, 'the same conversation comes back, nothing was deleted')
  assert.strictEqual((await post(dd, '/api/dm/open', { with: ['bob'] }, 'tok-alice')).json.thread.room, one)
}

console.log('direct message tests passed')
