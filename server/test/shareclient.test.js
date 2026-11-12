// End-to-end without a network: app/share-client.js talks to the real share.js and friends.js handlers through a fake fetch.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createShare } from '../share.js'
import { createFriends } from '../friends.js'
import { createShareClient, ShareError, friendlyMessage, buildShareUrl, parseShareUrl, scrubbedUrl, wsUrlForShare, linkState, roleLabel, expiryLabel, landing } from '../../app/share-client.js'
import { call } from './fakehttp.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'shareclient-test-'))
const people = new Map([['alice', crypto.randomBytes(8).toString('hex')], ['bob', crypto.randomBytes(8).toString('hex')]])
const byTok = new Map([...people].map(([n, t]) => [t, n]))
const identify = t => byTok.get(t) || null
const roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r)
const share = createShare({ DATA, identify, roomOk, readFile: () => 'hello\n' })
const friends = createFriends({ DATA, identify, roomOk })
const seenHeaders = []
const fetchImpl = async (url, init) => {
  const u = new URL(url); seenHeaders.push(init)
  const r = await call((q, s) => share.http(q, s) || friends.http(q, s), { method: init.method, url: u.pathname + u.search, headers: init.headers, body: init.body })
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json }
}
const mkc = n => createShareClient({ server: 'http://x/', token: people.get(n), fetchImpl })
const A = mkc('alice'); const B = mkc('bob'); const guest = createShareClient({ server: 'http://x', fetchImpl })

const link = await A.createLink({ room: 'demo', role: 'view', expiresInSec: 600, label: 'for bob' })
const url = buildShareUrl('https://app.example/vespr/', link.token)
assert.equal(url, 'https://app.example/vespr/#share=' + link.token); assert.equal(parseShareUrl(url), link.token)
assert.equal(scrubbedUrl(url), 'https://app.example/vespr/'); assert.equal(parseShareUrl('https://x/?share=' + link.token), null, 'only the fragment counts, never the query')
assert.equal(parseShareUrl('https://x/#share=short'), null); assert.equal(parseShareUrl('https://x/#a=1&share=' + link.token + '&b=2'), link.token)
assert.equal(wsUrlForShare('https://h.example/', 'demo', link.token), 'wss://h.example/ws/demo?token=' + link.token)
assert.deepEqual(await guest.openLink(link.token), { room: 'demo', file: null, role: 'view', expiresAt: link.expiresAt, by: 'alice' })
assert.ok(!seenHeaders.at(-1).headers.Authorization, 'opening a link sends no login'); assert.equal(seenHeaders.at(-1).referrerPolicy, 'no-referrer')
await A.openLink(link.token); assert.ok(!seenHeaders.at(-1).headers.Authorization, 'even a signed-in client sends no login when opening a link')
assert.equal((await A.listLinks('demo'))[0].label, 'for bob'); assert.deepEqual(await B.listLinks(), [])
await A.revokeLink(link.id)
await assert.rejects(guest.openLink(link.token), e => e instanceof ShareError && e.code === 'link_invalid' && e.status === 404)
await assert.rejects(A.createLink({ room: 'demo', role: 'edit', file: 'a.js' }), e => e.code === 'edit_needs_room')
await assert.rejects(createShareClient({ server: 'http://x', fetchImpl: async () => { throw new Error('down') } }).friends(), e => e.code === 'network')
const fl = await A.createLink({ room: 'demo', role: 'view', file: 'a.js' }); assert.equal((await guest.readSharedFile(fl.token)).text, 'hello\n')

// friends flow
await A.requestFriend('bob'); assert.equal((await B.friends()).incoming[0].handle, 'alice')
assert.equal(landing({ signedIn: true, home: await B.friends() }).attention, 1)
await B.acceptFriend('alice'); await A.shareProject('cart-shop', 'bob', 'view')
assert.deepEqual((await B.projects()).withMe.map(p => [p.room, p.owner, p.role]), [['cart-shop', 'alice', 'view']])
await assert.rejects(A.shareProject('cart-shop', 'nobody', 'view'), e => e.code === 'not_friends')
await A.unshareProject('cart-shop', 'bob'); await A.removeFriend('bob'); assert.deepEqual((await B.friends()).friends, [])

// landing: a link beats everything; signed-out people sign in first and still end up where they were going
assert.deepEqual(landing({ hash: '#share=' + link.token, signedIn: true, lastRoom: 'x' }), { kind: 'share', token: link.token })
assert.deepEqual(landing({ hash: '#share=' + link.token }), { kind: 'share', token: link.token }, 'a guest needs no account')
assert.deepEqual(landing({ signedIn: false, lastRoom: 'cart-shop' }), { kind: 'signin', then: { kind: 'room', room: 'cart-shop' } })
assert.deepEqual(landing({ signedIn: false }), { kind: 'signin', then: { kind: 'home', attention: 0 } })
assert.deepEqual(landing({ signedIn: true, lastRoom: 'cart-shop' }), { kind: 'room', room: 'cart-shop' })
assert.deepEqual(landing({ signedIn: true }), { kind: 'home', attention: 0 })
assert.deepEqual(landing({ hash: '#something-else', signedIn: true }), { kind: 'home', attention: 0 })

// labels
assert.equal(linkState({ revokedAt: 1 }, 5), 'revoked'); assert.equal(linkState({ expiresAt: 4 }, 5), 'expired'); assert.equal(linkState({ expiresAt: null }, 5), 'active')
assert.equal(roleLabel('edit'), 'Can edit'); assert.equal(roleLabel('view'), 'Can view')
assert.equal(expiryLabel(null), 'Never expires'); assert.equal(expiryLabel(1000, 2000), 'Expired'); assert.equal(expiryLabel(61000 + 1e6, 1e6), 'Expires in 1 min'); assert.equal(expiryLabel(1e6 + 7200e3, 1e6), 'Expires in 2 h'); assert.equal(expiryLabel(1e6 + 5 * 86400e3, 1e6), 'Expires in 5 days')
for (const c of ['link_invalid', 'network', 'not_friends', 'edit_needs_room', 'no_handle']) assert.ok(friendlyMessage(c).length > 10)
assert.ok(friendlyMessage('zzz').startsWith('Something went wrong')); assert.ok(!/ — /.test(friendlyMessage('link_invalid')))

fs.rmSync(DATA, { recursive: true, force: true })
console.log('shareclient tests passed: link build/parse (fragment only), open without login, revoke, errors, friends flow, project shares, landing order, labels')
