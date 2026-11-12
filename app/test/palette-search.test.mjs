import assert from 'node:assert'
import { matchText, search, inScope, messageItems, CHAT_ACTIONS } from '../palette-search.js'
const T = (q, t, o) => (matchText(q, t, o) || {}).tier ?? null
assert.strictEqual(T('new', 'New chat'), 1); assert.strictEqual(T('chat', 'New chat'), 2); assert.strictEqual(T('hat', 'New chat'), 3)
assert.strictEqual(T('new', 'Developer Settings: Compute Workers'), null, 'the old bug: n, e, w scattered across a long title is not a match')
assert.strictEqual(T('hello', 'Git: commit, push, open a pull request'), null)
assert.strictEqual(T('login review', 'Review the login change'), 4, 'every word, any order')
assert.strictEqual(T('dsw', 'Developer Settings: Compute Workers'), null, 'initials must be consecutive words (d s c w), not d s w')
assert.strictEqual(T('dscw', 'Developer Settings: Compute Workers'), 5)
assert.strictEqual(T('cpy', 'cart.py'), null); assert.strictEqual(T('cpy', 'cart.py', { scattered: true }), 6, 'file paths keep letter-order matching')
assert.strictEqual(T('', 'x'), null); assert.strictEqual(T('x', ''), null); assert.strictEqual(T(null, 'x'), null)
assert.deepStrictEqual(matchText('chat', 'New chat').ranges, [[4, 8]], 'highlight is the real text')
const items = [
  { k: 'Action', t: 'Developer Settings: Compute Workers', sub: 'Sandbox memory' }, { k: 'Conversation', t: 'New chat', sub: 'Ask, plan, or build' },
  { k: 'Conversation', t: 'Review the login change', sub: 'reviewer' }, { k: 'Agent', t: 'reviewer', sub: 'Code review' }, { k: 'File', t: 'src/cart.py', sub: 'open' }
]
assert.strictEqual(search('new', items)[0].t, 'New chat'); assert.strictEqual(search('new', items).length, 1, 'only real matches are listed')
assert.deepStrictEqual(search('review', items).map(i => i.t), ['reviewer', 'Review the login change'], 'a title match beats a subtitle match; agents list first on a tie')
assert.strictEqual(search('cpy', items)[0].t, 'src/cart.py'); assert.strictEqual(search('zzz', items).length, 0)
assert.strictEqual(search('', items, 2).length, 2); assert.strictEqual(search('code', items)[0].t, 'reviewer', 'subtitle-only matches still show, after title matches')
// Chat mode scope
assert.ok(inScope({ k: 'Conversation', t: 'x' }, 'chat') && inScope({ k: 'Agent', t: 'x' }, 'chat') && inScope({ k: 'Message', t: 'x' }, 'chat'))
for (const k of ['File', 'Memory', 'Visual Entity', 'Photo Asset']) assert.strictEqual(inScope({ k, t: 'x' }, 'chat'), false, k)
for (const t of ['SSH: add a host', 'Developer Settings: Cloudflare', 'Stripe Checkout & AI Credits', 'Git: commit, push, open a pull request', 'File System: Switch to Project Files', 'Classroom: Lecture Slides']) assert.strictEqual(inScope({ k: 'Action', t }, 'chat'), false, t)
for (const t of CHAT_ACTIONS) assert.strictEqual(inScope({ k: 'Action', t }, 'chat'), true, t)
assert.ok(inScope({ k: 'File', t: 'x' }, 'code') && inScope({ k: 'Action', t: 'SSH: add a host' }, 'code'), 'Code mode searches everything')
// messages
const chats = [{ id: 'c1', title: 'Fix the discount bug', messages: ['<p>The <b>discount</b> is applied twice</p>', 'ok'] }, { id: 'c2', title: 'General', messages: ['lunch at noon'] }]
const mi = messageItems('discount', chats); assert.strictEqual(mi.length, 1); assert.strictEqual(mi[0].convId, 'c1'); assert.strictEqual(mi[0].sub, 'in Fix the discount bug'); assert.ok(/discount/.test(mi[0].t) && !/</.test(mi[0].t))
assert.deepStrictEqual(messageItems('di', chats), [], 'too short to search messages'); assert.deepStrictEqual(messageItems('zzzz', chats), [])
assert.strictEqual(messageItems('a', null === 1 ? [] : chats).length, 0)
console.log('palette search tests passed')
