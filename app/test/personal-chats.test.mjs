import assert from 'node:assert'
import { createPersonalStore, titleFrom, LIMITS } from '../personal-chats.js'
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), m } }
let clock = 1000; const now = () => ++clock
const st = mem(); const a = createPersonalStore(st, 'acct1', now)
assert.deepStrictEqual(a.list(), []); assert.strictEqual(a.active(), null)
// each chat is its own thread
const r1 = a.append('what is a hash map'); assert.ok(r1.ok); a.append('(not connected)', 'notice')
a.start(); const r2 = a.append('plan my week'); assert.notStrictEqual(r1.id, r2.id, 'a started chat is a new thread')
assert.strictEqual(a.list().length, 2); assert.strictEqual(a.list()[0].title, 'plan my week', 'newest first'); assert.strictEqual(a.get(r1.id).title, 'what is a hash map')
a.setActive(r1.id); assert.strictEqual(a.active().id, r1.id); a.append('and a set?'); assert.strictEqual(a.get(r1.id).messages.length, 3); assert.strictEqual(a.get(r2.id).messages.length, 1, 'the other chat is untouched')
assert.strictEqual(a.setActive('nope'), false)
// saved on this device, per account, and reloaded
const b = createPersonalStore(st, 'acct1', now); assert.strictEqual(b.list().length, 2); assert.strictEqual(b.active().id, r1.id)
assert.strictEqual(createPersonalStore(st, 'acct2', now).list().length, 0, 'another account sees nothing')
// the model only sees this chat's turns, never notices
a.append('Hash maps store key/value pairs.', 'assistant'); assert.deepStrictEqual(a.history(r1.id).map(m => m.role), ['user', 'user', 'assistant']); assert.strictEqual(a.history('x').length, 0)
// limits and bad input
assert.deepStrictEqual(a.append('   '), { ok: false, reason: 'empty' }); assert.strictEqual(a.append('x'.repeat(LIMITS.message + 1)).reason, 'long'); assert.strictEqual(a.append(5).ok, false); assert.strictEqual(a.append('hi', 'admin').ok, false)
assert.strictEqual(titleFrom('  hello\n\tworld  '), 'hello world'); assert.strictEqual(titleFrom('x'.repeat(100)).length, LIMITS.title); assert.strictEqual(titleFrom(''), 'New chat'); assert.strictEqual(titleFrom(null), 'New chat')
{ const s = createPersonalStore(mem(), 'x', now); for (let i = 0; i < LIMITS.threads + 5; i++) { s.start(); s.append('chat ' + i) } assert.strictEqual(s.list().length, LIMITS.threads, 'oldest chats are dropped past the cap'); assert.ok(s.list().every(t => t.title !== 'chat 0')) }
{ const s = createPersonalStore(mem(), 'x', now); s.append('first'); for (let i = 0; i < LIMITS.messages + 20; i++) s.append('m' + i); assert.strictEqual(s.active().messages.length, LIMITS.messages) }
// rename, remove, clear
assert.strictEqual(a.rename(r2.id, '  Weekly plan '), true); assert.strictEqual(a.get(r2.id).title, 'Weekly plan'); assert.strictEqual(a.rename(r2.id, '  '), false)
assert.strictEqual(a.remove(r1.id), true); assert.strictEqual(a.active(), null); assert.strictEqual(a.remove(r1.id), false); a.clear(); assert.strictEqual(a.list().length, 0)
// the old single thread is migrated once, as one chat; junk is dropped
{ const s = mem(); s.setItem('vespr-personal-chat:old', JSON.stringify([{ role: 'user', text: 'old question', at: 5 }, { role: 'notice', text: 'n', at: 6 }, { role: 'evil', text: 'x' }, { role: 'user', text: 7 }]))
  const m = createPersonalStore(s, 'old', now); assert.strictEqual(m.list().length, 1); assert.strictEqual(m.list()[0].title, 'old question'); assert.strictEqual(m.active().messages.length, 2)
  assert.strictEqual(createPersonalStore(s, 'old', now).list().length, 1, 'not migrated twice') }
// damaged storage is ignored; blocked storage still works until reload
{ const s = mem(); s.setItem('vespr-personal-chats:d', '{bad'); assert.deepStrictEqual(createPersonalStore(s, 'd', now).list(), [])
  s.setItem('vespr-personal-chats:e', JSON.stringify({ threads: [{ id: '<script>', messages: [] }, { id: 'ok1', title: 't', messages: [{ role: 'user', text: 'hi' }] }, null], active: 'ok1' })); const e = createPersonalStore(s, 'e', now); assert.deepStrictEqual(e.list().map(t => t.id), ['ok1'])
  const blocked = { getItem () { throw new Error('x') }, setItem () { throw new Error('x') } }; const z = createPersonalStore(blocked, 'z', now); assert.strictEqual(z.append('still works').id !== undefined, true); assert.strictEqual(z.list().length, 1) }
// search view: user and assistant text only, newest first, ids namespaced
{ const s = createPersonalStore(mem(), 'q', now); s.append('alpha'); s.append('notice', 'notice'); s.append('beta', 'assistant'); s.append('gamma'); const v = s.searchable(); assert.strictEqual(v.length, 1); assert.deepStrictEqual(v[0].messages, ['gamma', 'beta'], 'the first message is the title, so it is not listed twice'); assert.ok(v[0].id.startsWith('personal:')) }
console.log('personal chats tests passed')
