// Access (access.js): make / view / edit / delete per person and path, checked on the real wire messages a browser sends, plus
// server-checked names (locked or not), approval answers, other shared state, refusals that do not poison later checks, and the API.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createRequire } from 'node:module'
import * as encoding from 'lib0/encoding'
import { createAccess, rightsFor, decide, cleanPath, mayJoin, AGENT_STATE, AGENT_SETTINGS, routeNeed } from '../access.js'
const Y = createRequire(import.meta.url)('yjs')

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))
const tokens = new Map([['tok-alice', 'alice'], ['tok-bob', 'bob'], ['tok-carol', 'carol'], ['tok-dave', 'dave'], ['tok-coder', 'coder']])
const live = new Y.Doc()
const acc = createAccess({ DATA, identify: tk => tokens.get(tk), Y, getDoc: () => live, log: () => {} })

// the room: two files the old way (path keys), one the new way (id key + name), a chat message from alice and an agent's approval card
live.transact(() => {
  const files = live.getMap('files'); const names = live.getMap('filePaths')
  for (const [k, txt] of [['README.md', '# hi'], ['src/a.py', 'x = 1']]) { const tx = new Y.Text(); tx.insert(0, txt); files.set(k, tx) }
  const tx = new Y.Text(); tx.insert(0, 'y = 2'); files.set('@file:b', tx); names.set('@file:b', 'src/b.py')
  const chat = live.getArray('chat')
  const m1 = new Y.Map(); const t1 = new Y.Text(); t1.insert(0, 'hello'); m1.set('author', 'alice'); m1.set('text', t1); m1.set('role', 'user')
  const m2 = new Y.Map(); const t2 = new Y.Text(); t2.insert(0, 'run tests?'); m2.set('author', 'coder'); m2.set('role', 'approval'); m2.set('status', 'pending'); m2.set('text', t2)
  chat.push([m1, m2])
})

// a peer's change, sent exactly as y-websocket sends it (sync message, update); returns whether the server let it through
function send (who, change) {
  const peer = new Y.Doc(); Y.applyUpdate(peer, Y.encodeStateAsUpdate(live))
  let update = null; peer.on('update', u => { update = update ? Y.mergeUpdates([update, u]) : u })
  change(peer)
  const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); encoding.writeVarUint(enc, 2); encoding.writeVarUint8Array(enc, update)
  const ok = acc.allow('room', who, encoding.toUint8Array(enc))
  if (ok) Y.applyUpdate(live, update) // what y-websocket does with an allowed message
  return ok
}
const edit = (key, s) => d => d.getMap('files').get(key).insert(0, s)
const make = (p, s = '') => d => { const tx = new Y.Text(); tx.insert(0, s); d.getMap('files').set(p, tx) }
const makeNew = (id, p) => d => d.transact(() => { d.getMap('files').set(id, new Y.Text()); d.getMap('filePaths').set(id, p) })
const del = key => d => d.getMap('files').delete(key)
const rename = (id, p) => d => d.getMap('filePaths').set(id, p)
const post = (author, text) => d => { const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, text); m.set('author', author); m.set('text', tx); m.set('role', 'user'); d.getArray('chat').push([m]) }
const answer = (as, ok) => d => d.transact(() => { const m = d.getArray('chat').get(1); m.set('status', ok ? 'approved' : 'denied'); m.set('decidedBy', as) })
const lock = acl => { fs.writeFileSync(path.join(DATA, 'access', 'room.json'), JSON.stringify(acl)); acc.aclOf('room'); fresh() }
const fresh = () => { const tmp = createAccess({ DATA, identify: tk => tokens.get(tk), Y, getDoc: () => live, log: () => {} }); Object.assign(acc, { allow: tmp.allow, aclOf: tmp.aclOf, mayJoin: tmp.mayJoin }) }

await t('rights: owner has all, grants add up by path, "*" counts for everyone, nothing outside a grant', () => {
  const acl = { owner: 'alice', grants: [{ who: 'bob', path: 'src/', rights: ['view', 'edit'] }, { who: '*', path: 'docs', rights: ['view'] }] }
  assert.deepStrictEqual([...rightsFor(acl, 'Alice ', 'x')].sort(), ['delete', 'edit', 'make', 'maker', 'manage', 'view'], 'owner, name compared without case or spaces')
  assert.deepStrictEqual([...rightsFor(acl, 'bob', 'src/a.py')].sort(), ['edit', 'view'])
  assert.deepStrictEqual([...rightsFor(acl, 'bob', 'srcx/a.py')], [], 'a folder grant does not cover a look-alike name')
  const noSlash = { owner: 'a', grants: [{ who: 'bob', path: 'src', rights: ['edit'] }] }
  assert.deepStrictEqual([...rightsFor(noSlash, 'bob', 'src/a.py')], ['edit'], 'a folder written without the slash still covers its files')
  assert.deepStrictEqual([...rightsFor(noSlash, 'bob', 'srcx/a.py')], [], 'but never a look-alike name')
  assert.deepStrictEqual([...rightsFor(acl, 'dave', 'docs/x.md')], ['view'])
  assert.deepStrictEqual([...rightsFor(null, 'anyone', 'x')].length, 6, 'an open workspace (no list) works as before')
  assert.strictEqual(mayJoin(acl, 'dave'), true); assert.strictEqual(mayJoin({ owner: 'a', grants: [] }, 'dave'), false)
  assert.strictEqual(cleanPath('../x'), null); assert.strictEqual(cleanPath('/src/'), 'src/'); assert.strictEqual(cleanPath(''), '')
  assert.strictEqual(decide(acl, 'bob', [{ kind: 'edit', path: 'README.md' }]), 'edit README.md')
})

await t('an open workspace: everyone edits as before, but nobody can post as someone else', () => {
  assert.strictEqual(send('bob', edit('README.md', 'b ')), true)
  assert.strictEqual(send('bob', post('alice', 'I am alice')), false, 'posting under another name is refused, locked or not')
  assert.strictEqual(send('bob', post('Bob', 'hi')), true, 'own name (case does not matter)')
  assert.strictEqual(send('bob', d => d.getArray('chat').get(0).get('text').insert(0, 'x')), false, "changing alice's message")
})

await t('a locked workspace: each change needs its right on that path', () => {
  lock({ owner: 'alice', grants: [{ who: 'bob', path: 'src/', rights: ['view', 'edit'] }, { who: 'carol', path: '', rights: ['view'] }, { who: 'coder', path: '', rights: ['view', 'make', 'edit', 'delete'] }] })
  assert.strictEqual(send('bob', edit('src/a.py', '# ')), true, 'edit inside his folder')
  assert.strictEqual(send('bob', edit('@file:b', '# ')), true, 'a new-style file is checked by its name (src/b.py)')
  assert.strictEqual(send('bob', edit('README.md', 'x')), false, 'edit outside it')
  assert.strictEqual(send('bob', make('src/new.py')), false, 'make needs make')
  assert.strictEqual(send('bob', del('src/a.py')), false, 'delete needs delete')
  assert.strictEqual(send('bob', rename('@file:b', 'src/c.py')), false, 'a rename needs make at the new name and delete at the old')
  assert.strictEqual(send('carol', edit('src/a.py', 'x')), false, 'view only')
  assert.strictEqual(send('carol', post('carol', 'question')), true, 'a viewer can still talk')
  assert.strictEqual(send('coder', makeNew('@file:n', 'src/x.py')), true, 'the agent was given make')
  assert.strictEqual(send('alice', del('README.md')), true, 'the owner may do anything')
  assert.ok(!live.getMap('files').has('README.md') && live.getMap('files').get('src/a.py').toString().startsWith('# '), 'the room holds exactly the allowed changes')
})

await t('a refusal does not poison the next check', () => {
  assert.strictEqual(send('bob', make('README2')), false, 'no make at the top level')
  assert.strictEqual(send('bob', edit('src/a.py', 'ok ')), true)
  assert.ok(live.getMap('files').get('src/a.py').toString().startsWith('ok '))
})

await t('grants widen exactly as given', () => {
  const a = acc.aclOf('room'); lock({ ...a, grants: [...a.grants, { who: 'bob', path: 'src/', rights: ['make'] }] })
  assert.strictEqual(send('bob', make('src/new.py')), true)
  assert.strictEqual(send('bob', make('docs/new.md')), false)
})

await t("approval cards: answered only in your own name, and only with edit on the workspace", () => {
  assert.strictEqual(send('bob', answer('bob', true)), false, 'bob can edit src/ only')
  assert.strictEqual(send('alice', answer('bob', true)), false, 'not in someone else\'s name')
  assert.strictEqual(send('alice', answer('alice', true)), true)
  assert.strictEqual(live.getArray('chat').get(1).get('decidedBy'), 'alice')
})

await t('shared state (settings, tasks) needs edit on the whole workspace; chat history only the owner deletes', () => {
  assert.strictEqual(send('bob', d => d.getMap('settings').set('agentMode', 'bypass')), false, 'bob cannot switch the agents to Bypass')
  assert.strictEqual(send('coder', d => d.getMap('tasks').set('t1', { title: 'x' })), true)
  assert.strictEqual(send('bob', d => d.getArray('chat').delete(0, 1)), false)
  assert.strictEqual(send('alice', d => d.getArray('chat').delete(0, 1)), true)
})

// the client's command() (vespr-client.js): push one in your name, keep the last 50
const cmd = (by, file) => d => d.transact(() => { const ui = d.getArray('ui'); ui.push([{ id: by + Math.random(), ts: Date.now(), by, type: 'open', file }]); if (ui.length > 50) ui.delete(0, ui.length - 50) })
await t('opening a file (the ui command list): a viewer may, in their own name; only the trim of old ones, nothing else', () => {
  assert.strictEqual(send('carol', cmd('carol', 'README.md')), true, 'view only, and still opens files')
  assert.strictEqual(send('carol', cmd('alice', 'README.md')), false, 'not in someone else’s name')
  assert.strictEqual(send('dave', cmd('dave', 'README.md')), false, 'no view, no commands')
  for (let i = 0; i < 55; i++) assert.strictEqual(send('alice', cmd('alice', 'x' + i)), true)
  assert.strictEqual(send('carol', cmd('carol', 'src/a.py')), true, 'the full list: her command plus the trim of the oldest')
  assert.strictEqual(live.getArray('ui').length, 50); assert.strictEqual(live.getArray('ui').get(49).by, 'carol')
  assert.strictEqual(send('carol', d => d.getArray('ui').delete(10, 1)), false, 'removing one from the middle')
  assert.strictEqual(send('carol', d => d.getArray('ui').delete(0, 50)), false, 'clearing the list')
  assert.strictEqual(send('carol', d => d.transact(() => { const ui = d.getArray('ui'); ui.push([{ by: 'carol', type: 'open', file: 'a' }]); ui.delete(10, 1) })), false, 'adding one and removing one from the middle (still 50)')
  assert.strictEqual(send('carol', d => d.getArray('ui').push([new Y.Map()])), false, 'not a plain command')
  live.getArray('ui').push([new Y.Map()]) // older data with a nested type in it
  assert.strictEqual(send('carol', d => { const ui = d.getArray('ui'); ui.get(ui.length - 1).set('by', 'carol') }), false, 'no changes inside it')
  assert.strictEqual(send('alice', d => d.getArray('ui').delete(0, 50)), true, 'the owner may')
  assert.strictEqual(decide(null, 'bob', [{ kind: 'ui', by: 'alice' }]), 'send commands as alice', 'names are checked in an open workspace too')
})

const claim = (by, p) => d => d.getMap('claims').set(p, { by, ai: false, since: Date.now() }) // what the editor does while you type
await t('claims ("editing this file"): your own name, on a file you may edit; release your own or on a file you may delete', () => {
  assert.strictEqual(send('bob', claim('bob', 'src/a.py')), true, 'bob types in his folder')
  assert.strictEqual(send('bob', claim('bob', 'README.md')), false, 'not outside it')
  assert.strictEqual(send('carol', claim('carol', 'src/a.py')), false, 'a viewer does not claim')
  assert.strictEqual(send('bob', claim('alice', 'src/a.py')), false, 'not in someone else’s name')
  assert.strictEqual(send('alice', claim('alice', 'src/a.py')), true, 'taking over a claim: the owner may edit there')
  assert.strictEqual(send('bob', d => d.getMap('claims').delete('src/a.py')), false, 'bob may not release alice’s claim (no delete there)')
  assert.strictEqual(send('alice', d => d.getMap('claims').delete('src/a.py')), true, 'her own')
  assert.strictEqual(send('coder', claim('coder', 'src/b.py')), true)
  assert.strictEqual(send('coder', d => d.transact(() => { d.getMap('files').delete('@file:n'); d.getMap('claims').delete('src/b.py') })), true, 'the agent releases its own while deleting a file')
  assert.strictEqual(send('bob', d => d.getMap('claims').set('src/x.py', new Y.Map())), false, 'not a plain claim')
  live.getMap('claims').set('old', new Y.Map()) // older data with a nested type in it
  assert.strictEqual(send('bob', d => d.getMap('claims').get('old').set('by', 'bob')), false, 'no changes inside it')
})

const logged = (by, file) => d => { const m = new Y.Map(); m.set('ts', Date.now()); m.set('file', file); m.set('by', by); m.set('summary', 'x'); d.getArray('provenance').push([m]) } // vespr-client.js logFile
await t('the provenance log: new entries in your own name about a file you may change there; old entries stay as they are', () => {
  assert.strictEqual(send('bob', d => d.transact(() => { make('src/p.py')(d); logged('bob', 'src/p.py')(d) })), true, 'making a file and logging it (bob has make in src/)')
  assert.strictEqual(send('bob', logged('bob', 'README.md')), false, 'not about a file he may not change')
  assert.strictEqual(send('carol', logged('carol', 'src/a.py')), false, 'a viewer changes nothing, so logs nothing')
  assert.strictEqual(send('bob', logged('alice', 'src/a.py')), false, 'not in someone else’s name')
  assert.strictEqual(send('bob', d => d.getArray('provenance').delete(0, 1)), false, 'removing an entry')
  assert.strictEqual(send('bob', d => d.getArray('provenance').get(0).set('by', 'zed')), false, 'rewriting an entry')
  assert.strictEqual(send('bob', d => d.getArray('provenance').push(['plain'])), false, 'not an entry')
  assert.strictEqual(send('alice', d => d.getArray('provenance').delete(0, 1)), true, 'the owner may')
})

await t('presence and "what do you have?" pass untouched; garbage is refused', () => {
  assert.strictEqual(acc.allow('room', 'dave', Uint8Array.from([1, 0])), true, 'awareness (presence)')
  assert.strictEqual(acc.allow('room', 'dave', Uint8Array.from([0, 0, 0])), true, 'sync step 1')
  const enc = encoding.createEncoder(); encoding.writeVarUint(enc, 0); encoding.writeVarUint(enc, 2); encoding.writeVarUint8Array(enc, Uint8Array.from([9, 9, 9, 9]))
  assert.strictEqual(acc.allow('room', 'alice', encoding.toUint8Array(enc)), false)
  assert.strictEqual(send('alice', edit('src/a.py', 'still fine ')), true, 'and the room still works after it')
})

await t('the API: lock, owner-only grants, members-only view, revoke, unlock', async () => {
  const srv = http.createServer((req, res) => { if (!acc.http(req, res)) { res.writeHead(404); res.end() } })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const call = async (method, p, tok, body) => { const r = await fetch(base + p, { method, headers: tok ? { Authorization: 'Bearer ' + tok } : {}, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json() } }
  const real = createAccess({ DATA, identify: tk => tokens.get(tk), Y, getDoc: () => new Y.Doc(), log: () => {} }); acc.http = real.http
  assert.strictEqual((await call('GET', '/api/access/team')).s, 401)
  assert.strictEqual((await call('GET', '/api/access/team', 'tok-dave')).j.locked, false, 'open workspaces are visible to everyone signed in')
  assert.strictEqual((await call('POST', '/api/access/team/lock', 'tok-alice', {})).s, 201)
  assert.strictEqual((await call('POST', '/api/access/team/lock', 'tok-bob', {})).s, 409, 'only once')
  assert.strictEqual((await call('POST', '/api/access/team/grant', 'tok-bob', { who: 'bob', path: '', rights: ['edit'] })).s, 403, 'not the owner')
  assert.strictEqual((await call('POST', '/api/access/team/grant', 'tok-alice', { who: 'bob', path: '../etc', rights: ['view'] })).s, 400)
  assert.strictEqual((await call('POST', '/api/access/team/grant', 'tok-alice', { who: 'bob', path: 'src/', rights: ['fly'] })).s, 400)
  const g = await call('POST', '/api/access/team/grant', 'tok-alice', { who: 'bob', path: 'src/', rights: ['edit', 'view', 'view'] })
  assert.deepStrictEqual(g.j.grants, [{ who: 'bob', path: 'src/', rights: ['view', 'edit'] }])
  assert.strictEqual((await call('GET', '/api/access/team', 'tok-dave')).s, 403, 'non-members do not see the list')
  assert.deepStrictEqual((await call('GET', '/api/access/team', 'tok-bob')).j.mine, [], 'his rights on the whole workspace (his grant is on src/)')
  await call('POST', '/api/access/team/revoke', 'tok-alice', { who: 'bob', path: 'src/' })
  assert.strictEqual((await call('GET', '/api/access/team', 'tok-bob')).s, 403)
  assert.strictEqual((await call('POST', '/api/access/team/unlock', 'tok-alice', {})).s, 200)
  assert.strictEqual((await call('GET', '/api/access/team', 'tok-bob')).j.locked, false)
  assert.strictEqual(fs.statSync(path.join(DATA, 'access')).mode & 0o077, 0, 'access lists are private')
  srv.close()
})

await t('grants that end count for nothing afterwards', () => {
  const acl = { owner: 'a', grants: [{ who: 'bob', path: 'src/', rights: ['view', 'edit'], until: 1000 }] }
  assert.deepStrictEqual([...rightsFor(acl, 'bob', 'src/x', 999)].sort(), ['edit', 'view'])
  assert.deepStrictEqual([...rightsFor(acl, 'bob', 'src/x', 1000)], [], 'ended')
  assert.strictEqual(mayJoin(acl, 'bob', 999), true); assert.strictEqual(mayJoin(acl, 'bob', 1001), false)
})

await t('agents keep their own bookkeeping with view; people do not; access cards are the server\u2019s', () => {
  const acl = { owner: 'a', grants: [{ who: 'coder', path: 'src/', rights: ['view', 'edit'] }, { who: 'bob', path: '', rights: ['view'] }] }
  const isAgent = w => w === 'coder'
  for (const name of AGENT_STATE) assert.strictEqual(decide(acl, 'coder', [{ kind: 'state', name }], { isAgent }), null, name)
  assert.strictEqual(decide(acl, 'coder', [{ kind: 'state', name: 'settings' }], { isAgent }), 'change settings', 'not the settings')
  for (const key of AGENT_SETTINGS) assert.strictEqual(decide(acl, 'coder', [{ kind: 'setting', key }], { isAgent }), null, 'its own status key ' + key)
  for (const key of ['agentMode', 'runner', 'importRequest', 'focus']) assert.strictEqual(decide(acl, 'coder', [{ kind: 'setting', key }], { isAgent }), 'change settings', 'never ' + key)
  assert.strictEqual(decide(acl, 'bob', [{ kind: 'setting', key: 'runs' }], { isAgent }), 'change settings', 'a person is not an agent')
  assert.strictEqual(decide(acl, 'bob', [{ kind: 'state', name: 'plans' }], { isAgent }), 'change plans', 'a person is not an agent')
  assert.strictEqual(decide({ owner: 'a', grants: [] }, 'coder', [{ kind: 'state', name: 'plans' }], { isAgent }), 'change plans', 'not without view')
  assert.match(decide(null, 'bob', [{ kind: 'chat', author: 'bob', role: 'access' }]), /only the server/)
  assert.match(decide(null, 'bob', [{ kind: 'chat-edit', author: 'bob', access: true }]), /answer it with the buttons/, 'not even your own request card')
  assert.match(decide(null, 'bob', [{ kind: 'chat', author: 'bob', role: 'payment' }]), /payment card \(only the server does\)/, 'a payment card is the server\u2019s too (server/pay.js)')
  assert.match(decide(null, 'coder', [{ kind: 'chat', author: 'coder', role: 'payment' }]), /only the server/, 'not even the agent that asks for the payment posts its own card')
})

await t('manage, requests and answers over the API', async () => {
  const room = new Y.Doc(); let clock = 1_000_000
  const real = createAccess({ DATA, identify: tk => tokens.get(tk), Y, getDoc: () => room, log: () => {}, now: () => clock, isAgent: w => w === 'coder' })
  const srv = http.createServer((req, res) => { if (!real.http(req, res)) { res.writeHead(404); res.end() } })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const call = async (method, p, tok, body) => { const r = await fetch(base + '/api/access/proj' + p, { method, headers: { Authorization: 'Bearer ' + tok }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json() } }
  const rights = (who, p) => [...rightsFor(real.aclOf('proj'), who, p, clock)].sort()
  assert.strictEqual((await call('POST', '/lock', 'tok-coder', {})).s, 403, 'agents do not own workspaces')
  assert.strictEqual((await call('POST', '/lock', 'tok-alice', {})).s, 201)
  // manage: only the owner gives it, never to everyone or an agent
  assert.strictEqual((await call('POST', '/grant', 'tok-alice', { who: 'coder', path: '', rights: ['manage'] })).s, 400)
  assert.strictEqual((await call('POST', '/grant', 'tok-alice', { who: '*', path: 'src/', rights: ['manage'] })).s, 400)
  assert.strictEqual((await call('POST', '/grant', 'tok-alice', { who: 'bob', path: 'src/', rights: ['view', 'edit', 'manage'] })).s, 200)
  assert.strictEqual((await call('POST', '/grant', 'tok-alice', { who: 'carol', path: '', rights: ['view'] })).s, 200)
  // a manager gives only what he holds, only where he manages, and never manage
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'carol', path: 'src/', rights: ['edit'] })).s, 200, 'inside his folder')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'carol', path: 'docs/', rights: ['edit'] })).s, 403, 'outside it')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'carol', path: '', rights: ['edit'] })).s, 403, 'not the whole workspace')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'dave', path: 'src/', rights: ['delete'] })).s, 403, 'not a right he lacks')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'dave', path: 'src/', rights: ['manage'] })).s, 403, 'not manage')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'alice', path: 'src/', rights: ['view'] })).s, 400, 'not the owner')
  assert.strictEqual((await call('POST', '/revoke', 'tok-carol', { who: 'carol', path: 'src/' })).s, 403, 'members do not manage')
  assert.strictEqual((await call('POST', '/grant', 'tok-alice', { who: 'dave', path: 'src/', rights: ['view', 'manage'] })).s, 200, 'a second manager of src/')
  assert.strictEqual((await call('POST', '/revoke', 'tok-bob', { who: 'dave', path: 'src/' })).s, 403, 'one manager does not remove another')
  assert.strictEqual((await call('POST', '/grant', 'tok-bob', { who: 'dave', path: 'src/', rights: ['view'] })).s, 403, 'nor strips their manage')
  assert.strictEqual((await call('POST', '/revoke', 'tok-alice', { who: 'dave', path: 'src/' })).s, 200, 'the owner does')
  assert.strictEqual((await call('POST', '/unlock', 'tok-bob', {})).s, 403, 'only the owner opens it again')
  // asking: the agent asks, a card appears in chat, the right people may answer, the grant ends after an hour
  const q = await call('POST', '/request', 'tok-coder', { path: 'src/', rights: ['view', 'edit'], reason: 'fix the failing test\u0007 in src/a.py' })
  assert.strictEqual(q.s, 201); assert.strictEqual(q.j.request.agent, true); assert.strictEqual(q.j.request.reason, 'fix the failing test in src/a.py', 'control characters go')
  const c = room.getArray('chat').toArray().find(m => m.get('id') === 'access-' + q.j.request.id)
  assert.ok(c && c.get('role') === 'access' && c.get('status') === 'pending' && c.get('author') === 'coder', 'the card is in the chat')
  assert.strictEqual((await call('POST', '/request', 'tok-coder', { path: 'src/', rights: ['edit'] })).j.request.id, q.j.request.id, 'asking again returns the same request')
  assert.strictEqual((await call('POST', '/request', 'tok-coder', { path: '', rights: ['manage'] })).s, 400, 'agents never ask for manage')
  assert.strictEqual((await call('GET', '/requests', 'tok-carol')).j.requests.length, 0, 'carol may not answer it')
  assert.strictEqual((await call('GET', '/requests', 'tok-bob')).j.requests.length, 1, 'bob manages src/')
  assert.strictEqual((await call('GET', '', 'tok-bob')).j.waiting, 1)
  assert.strictEqual((await call('POST', '/answer', 'tok-carol', { id: q.j.request.id, approve: true })).s, 403)
  assert.strictEqual((await call('POST', '/answer', 'tok-coder', { id: q.j.request.id, approve: true })).s, 403, 'not your own')
  const ok = await call('POST', '/answer', 'tok-bob', { id: q.j.request.id, approve: true, for: '1h' })
  assert.strictEqual(ok.s, 200); assert.deepStrictEqual(ok.j.request.granted, ['view', 'edit'])
  assert.deepStrictEqual(rights('coder', 'src/a.py'), ['edit', 'view']); assert.deepStrictEqual(rights('coder', 'README.md'), [])
  assert.strictEqual(c.get('status'), 'approved'); assert.strictEqual(c.get('decidedBy'), 'bob'); assert.strictEqual(c.get('until'), clock + 3600_000)
  assert.strictEqual((await call('POST', '/answer', 'tok-alice', { id: q.j.request.id, approve: false })).s, 409, 'first answer decides')
  clock += 3600_000; assert.deepStrictEqual(rights('coder', 'src/a.py'), [], 'an hour later it has ended')
  // a no, and asking again too soon
  const q2 = await call('POST', '/request', 'tok-dave', { path: '', rights: ['view'], reason: 'let me in' })
  assert.strictEqual(q2.s, 201, 'a non-member may ask to join')
  assert.strictEqual((await call('POST', '/answer', 'tok-bob', { id: q2.j.request.id, approve: true })).s, 403, 'bob manages src/ only')
  assert.strictEqual((await call('POST', '/answer', 'tok-alice', { id: q2.j.request.id, approve: false })).s, 200)
  assert.strictEqual((await call('POST', '/request', 'tok-dave', { path: '', rights: ['view'] })).s, 429, 'not again right after a no')
  clock += 11 * 60_000; assert.strictEqual((await call('POST', '/request', 'tok-dave', { path: '', rights: ['view'] })).s, 201, 'later is fine')
  for (const p of ['a/', 'b/', 'c/']) await call('POST', '/request', 'tok-dave', { path: p, rights: ['edit'] })
  assert.strictEqual((await call('POST', '/request', 'tok-dave', { path: 'd/', rights: ['edit'] })).s, 429, 'at most 3 waiting')
  // always: merged into the permanent grant; a manager cannot give more than he holds
  const q3 = await call('POST', '/request', 'tok-carol', { path: 'src/', rights: ['delete'] })
  assert.strictEqual((await call('POST', '/answer', 'tok-bob', { id: q3.j.request.id, approve: true })).s, 403, 'bob has no delete')
  assert.strictEqual((await call('POST', '/answer', 'tok-alice', { id: q3.j.request.id, approve: true, for: 'always' })).s, 200)
  assert.deepStrictEqual(real.aclOf('proj').grants.find(g => g.who === 'carol' && g.path === 'src/').rights, ['edit', 'delete'])
  // a day without an answer: it lapses
  clock += 25 * 3600_000; const r = (await call('GET', '/requests', 'tok-dave')).j.requests
  assert.ok(r.every(x => x.status !== 'pending'), 'old requests lapse')
  const h = await call('GET', '/history', 'tok-bob'); assert.ok(h.j.history.some(e => e.action === 'allow' && e.by === 'bob'), 'the audit log')
  assert.strictEqual((await call('GET', '/history', 'tok-carol')).s, 403, 'members do not read it')
  // Agent maker rights and remote control authority (Ask #301)
  assert.strictEqual((await call('POST', '/agent-maker', 'tok-alice', { agent: 'coder', maker: 'bob', visibility: 'windows-only' })).s, 200)
  const agents = await call('GET', '/agents', 'tok-alice')
  assert.strictEqual(agents.s, 200)
  assert.strictEqual(agents.j.agents.coder.maker, 'bob')
  assert.strictEqual(agents.j.agents.coder.visibility, 'windows-only')
  // Bob controls agent
  const ctrl = await call('POST', '/agent-control', 'tok-bob', { agent: 'coder', action: 'pause' })
  assert.strictEqual(ctrl.s, 200)
  assert.strictEqual(ctrl.j.status, 'paused')
  // Carol without maker right is refused
  const carolCtrl = await call('POST', '/agent-control', 'tok-carol', { agent: 'coder', action: 'resume' })
  assert.strictEqual(carolCtrl.s, 403)
  // decide checks agent-control and agent-visibility
  assert.strictEqual(decide(real.aclOf('proj'), 'bob', [{ kind: 'agent-control', agent: 'coder' }]), null)
  assert.strictEqual(decide(real.aclOf('proj'), 'carol', [{ kind: 'agent-control', agent: 'coder' }]), 'control agent coder')
  srv.close()
})

await t('uploads, snapshots and git follow the access list, not just sign-in', async () => {
  assert.deepStrictEqual(routeNeed('POST', '/api/upload/team'), { room: 'team', right: 'make', path: 'uploads/' })
  assert.deepStrictEqual(routeNeed('GET', '/api/upload/team/abc'), { room: 'team', right: 'view', path: '' })
  assert.strictEqual(routeNeed('POST', '/api/snapshot/team').right, 'manage'); assert.strictEqual(routeNeed('DELETE', '/api/snapshot/team/x').right, 'manage'); assert.strictEqual(routeNeed('GET', '/api/snapshot/team').right, 'view')
  assert.strictEqual(routeNeed('POST', '/api/git/team/commit').right, 'edit'); assert.strictEqual(routeNeed('GET', '/api/git/team/log').right, 'view')
  assert.strictEqual(routeNeed('POST', '/git/team.git/git-receive-pack').right, 'edit', 'push'); assert.strictEqual(routeNeed('GET', '/git/team.git/info/refs', '?service=git-receive-pack').right, 'edit')
  assert.strictEqual(routeNeed('GET', '/git/team.git/info/refs', '?service=git-upload-pack').right, 'view', 'clone'); assert.strictEqual(routeNeed('GET', '/api/access/team'), null)
  assert.strictEqual(routeNeed('GET', '/api/log/team').right, 'view'); assert.deepStrictEqual(routeNeed('POST', '/api/nas/team'), { room: 'team', right: 'make', path: 'nas/' })
  assert.strictEqual(routeNeed('DELETE', '/api/nas/team/x').right, 'delete'); assert.strictEqual(routeNeed('POST', '/api/nas/team/x/verify').right, 'view'); assert.strictEqual(routeNeed('GET', '/api/nas/team/x').right, 'view')
  fs.writeFileSync(path.join(DATA, 'access', 'gated.json'), JSON.stringify({ owner: 'alice', grants: [{ who: 'bob', path: '', rights: ['view'] }, { who: 'carol', path: '', rights: ['view', 'make', 'edit'] }] }))
  const g = createAccess({ DATA, identify: tk => tokens.get(tk), Y, getDoc: () => new Y.Doc(), log: () => {} })
  const srv = http.createServer((req, res) => { if (!g.gate(req, res)) { res.writeHead(299); res.end('{}') } })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const hit = async (method, p, auth) => (await fetch(base + p, { method, headers: auth ? { Authorization: auth } : {} })).status
  const B = tk => 'Bearer ' + tk, basic = tk => 'Basic ' + Buffer.from('x:' + tk).toString('base64')
  assert.strictEqual(await hit('GET', '/api/upload/gated', B('tok-bob')), 299, 'a viewer lists uploads')
  assert.strictEqual(await hit('POST', '/api/upload/gated', B('tok-bob')), 403, 'but adds none')
  assert.strictEqual(await hit('POST', '/api/upload/gated', B('tok-carol')), 299, 'make may')
  assert.strictEqual(await hit('GET', '/api/upload/gated', B('tok-dave')), 403, 'a non-member sees nothing')
  assert.strictEqual(await hit('POST', '/api/snapshot/gated', B('tok-carol')), 403, 'publishing a copy needs manage')
  assert.strictEqual(await hit('POST', '/api/snapshot/gated', B('tok-alice')), 299, 'the owner may')
  assert.strictEqual(await hit('POST', '/git/gated.git/git-receive-pack', basic('tok-bob')), 403, 'a viewer cannot push (git sends the token as the password)')
  assert.strictEqual(await hit('GET', '/git/gated.git/info/refs?service=git-upload-pack', basic('tok-bob')), 299, 'but may clone')
  assert.strictEqual(await hit('GET', '/git/gated.git/info/refs?service=git-upload-pack', basic('tok-dave')), 403)
  assert.strictEqual(await hit('POST', '/api/upload/gated'), 299, 'not signed in: the feature answers 401 itself')
  assert.strictEqual(await hit('POST', '/api/upload/openroom', B('tok-dave')), 299, 'an open workspace works as before')
  assert.strictEqual(g.allows('gated', 'carol', 'manage', ''), false); assert.strictEqual(g.allows('gated', 'alice', 'manage', ''), true); assert.strictEqual(g.allows('openroom', 'x', 'manage', ''), true)
  srv.close()
})

fs.rmSync(DATA, { recursive: true, force: true })
console.log(`access tests passed (${n}): rights by person and path, open rooms keep working but names are checked, every change kind in a locked room, refusals do not poison, grants widen exactly, approval answers, shared state and chat history, presence and garbage, the API`)
