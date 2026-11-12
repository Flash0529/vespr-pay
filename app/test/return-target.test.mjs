// Tests for app/return-target.js: the target survives failed sign-ins and reloads (sessionStorage only), bad values are dropped, and the landing respects server/policy.js. Run: node app/test/return-target.test.mjs
import assert from 'node:assert'
import { cleanTarget, saveTarget, loadTarget, clearTarget, landAfterSignIn, TARGET_TTL_MS } from '../return-target.js'
import { can } from '../../server/policy.js'
import { buildShareUrl, parseShareUrl } from '../share-client.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

// A Map-backed stand-in for sessionStorage; `broken` makes every call throw, like a blocked storage in a private window.
const fakeStore = ({ broken = false } = {}) => {
  const m = new Map()
  const boom = () => { if (broken) throw new Error('blocked') }
  return { getItem: k => { boom(); return m.has(k) ? m.get(k) : null }, setItem: (k, v) => { boom(); m.set(k, String(v)) }, removeItem: k => { boom(); m.delete(k) }, _m: m }
}

const TOKEN = 'a'.repeat(43)
const NOW = 1_800_000_000_000
const ORG = { id: 'org1', policy: {} }
const adult = (extra = {}) => ({ id: 'ana1', orgId: 'org1', roles: ['member'], ageBand: 'adult', classIds: [], ...extra })
const minor = (extra = {}) => ({ id: 'kid1', orgId: 'org1', roles: ['student'], ageBand: '13-17', classIds: ['c1'], ...extra })
const individual = (extra = {}) => ({ id: 'solo1', orgId: null, roles: ['member'], ageBand: 'adult', classIds: [], ...extra })

// ---- the pure shape check ----
t('a share token of the right shape is kept', () => assert.deepStrictEqual(cleanTarget({ kind: 'share', token: TOKEN }, NOW), { kind: 'share', token: TOKEN, requiresInternal: false, savedAt: NOW }))
t('a share token of the wrong shape is dropped', () => { for (const token of ['', 'short', TOKEN + 'x', 'a'.repeat(42) + '!', undefined, 42]) assert.strictEqual(cleanTarget({ kind: 'share', token }, NOW), null, String(token)) })
t('unknown kinds and non-objects are dropped', () => { for (const v of [null, 'share', 3, { kind: 'admin', room: 'x' }, { kind: 'room' }]) assert.strictEqual(cleanTarget(v, NOW), null, JSON.stringify(v)) })
t('a share target may carry an http(s) server address, and nothing else', () => {
  assert.strictEqual(cleanTarget({ kind: 'share', token: TOKEN, server: 'https://vespr.example:8443' }, NOW).server, 'https://vespr.example:8443')
  assert.strictEqual(cleanTarget({ kind: 'share', token: TOKEN }, NOW).server, undefined)
  for (const server of ['javascript:alert(1)', 'https://u:p@h.example', 'https://h.example/path', 'https://h.example?x=1', '//h.example', 'ftp://h.example']) assert.strictEqual(cleanTarget({ kind: 'share', token: TOKEN, server }, NOW), null, server)
})
t('room names are limited to letters, digits, dash and underscore', () => {
  assert.ok(cleanTarget({ kind: 'room', room: 'team-7_a' }, NOW))
  for (const room of ['a b', '../x', 'x/y', 'r'.repeat(65), '']) assert.strictEqual(cleanTarget({ kind: 'room', room }, NOW), null, room)
})
t('file paths refuse absolute paths and parent segments', () => {
  assert.ok(cleanTarget({ kind: 'file', room: 'r1', file: 'src/cart.py' }, NOW))
  for (const file of ['/etc/passwd', '../x.py', 'src/../../x', 'a\\b']) assert.strictEqual(cleanTarget({ kind: 'file', room: 'r1', file }, NOW), null, file)
})
t('requiresInternal is only true for the boolean true', () => { assert.strictEqual(cleanTarget({ kind: 'room', room: 'r1', requiresInternal: 'yes' }, NOW).requiresInternal, false); assert.strictEqual(cleanTarget({ kind: 'room', room: 'r1', requiresInternal: true }, NOW).requiresInternal, true) })

// ---- survives sign-in trouble and reloads, in sessionStorage only ----
t('a saved target is still there after a failed sign-in and a reload', () => {
  const s = fakeStore()
  assert.strictEqual(saveTarget(s, { kind: 'share', token: TOKEN }, NOW), true)
  assert.strictEqual(loadTarget(s, NOW + 60_000).token, TOKEN) // wrong password: load does not remove
  assert.strictEqual(loadTarget(s, NOW + 120_000).token, TOKEN) // reload: same
})
t('a reload gets the share token and server back, and clearing after use leaves nothing', () => {
  const s = fakeStore()
  saveTarget(s, { kind: 'share', token: TOKEN, server: 'https://vespr.example' }, NOW)
  const back = loadTarget(s, NOW + 5_000)
  assert.deepStrictEqual([back.token, back.server], [TOKEN, 'https://vespr.example'])
  clearTarget(s)
  assert.strictEqual(loadTarget(s, NOW + 6_000), null)
})
t('the target is cleared only when cleared on purpose', () => {
  const s = fakeStore()
  saveTarget(s, { kind: 'room', room: 'r1' }, NOW)
  clearTarget(s)
  assert.strictEqual(loadTarget(s, NOW), null)
})
t('an expired target is dropped', () => {
  const s = fakeStore()
  saveTarget(s, { kind: 'share', token: TOKEN }, NOW)
  assert.strictEqual(loadTarget(s, NOW + TARGET_TTL_MS + 1), null)
  assert.strictEqual(s._m.has('vespr-return'), false)
})
t('corrupt stored text is dropped, not thrown', () => {
  const s = fakeStore(); s._m.set('vespr-return', '{not json'); assert.strictEqual(loadTarget(s, NOW), null); assert.strictEqual(s._m.has('vespr-return'), false)
})
t('a blocked storage means nothing is saved and nothing throws', () => {
  const s = fakeStore({ broken: true })
  assert.strictEqual(saveTarget(s, { kind: 'share', token: TOKEN }, NOW), false)
  assert.strictEqual(loadTarget(s, NOW), null)
  clearTarget(s)
})
t('a rejected target is not saved', () => { assert.strictEqual(saveTarget(fakeStore(), { kind: 'share', token: 'nope' }, NOW), false) })
t('the share token is read from the fragment and never kept in a URL', () => {
  const href = buildShareUrl('https://vespr.example/prototype.html', TOKEN)
  assert.strictEqual(parseShareUrl(href), TOKEN)
  const s = fakeStore(); saveTarget(s, { kind: 'share', token: parseShareUrl(href) }, NOW)
  assert.ok(!JSON.stringify([...s._m.values()]).includes('http'), 'no URL is stored, only the token')
})

// ---- landing: the person lands unless policy or the document says no ----
t('nothing waiting means the home screen', () => assert.deepStrictEqual(landAfterSignIn({ target: null, user: adult(), can }), { kind: 'home' }))
t('a signed-in member lands on a share link', () => {
  const r = landAfterSignIn({ target: { kind: 'share', token: TOKEN }, user: adult(), context: { org: ORG, linkOrgId: 'org1' }, can })
  assert.strictEqual(r.kind, 'land')
})
t('a company rule that refuses a share link shows the reason, not the target', () => {
  const r = landAfterSignIn({ target: { kind: 'share', token: TOKEN }, user: minor(), context: { org: ORG, linkOrgId: 'other-org' }, can })
  assert.strictEqual(r.kind, 'blocked')
  assert.ok(r.reason && r.reason.length > 0)
})
t('a room or file that the document marks internal-only is blocked for an individual account', () => {
  const r = landAfterSignIn({ target: { kind: 'room', room: 'r1', requiresInternal: true }, user: individual(), can })
  assert.strictEqual(r.kind, 'blocked')
  assert.match(r.reason, /organization/)
})
t('the same internal-only target lands for an organization member', () => {
  assert.strictEqual(landAfterSignIn({ target: { kind: 'file', room: 'r1', file: 'a.py', requiresInternal: true }, user: adult(), context: { org: ORG }, can }).kind, 'land')
})
t('without a policy check a share link still lands, and a refusal shows its reason', () => {
  assert.strictEqual(landAfterSignIn({ target: { kind: 'share', token: TOKEN }, user: adult(), context: {}, can: null }).kind, 'land') // no user check configured: the server still checks the token
  assert.strictEqual(landAfterSignIn({ target: { kind: 'share', token: TOKEN }, user: adult(), context: {}, can: () => ({ allow: false, reason: 'No.' }) }).reason, 'No.')
})

console.log(`return-target: ${n} tests passed`)
