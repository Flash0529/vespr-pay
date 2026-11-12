// The keyboard path for approvals: murmio.approve / murmio.deny answer the newest pending card and nothing else; plus the keybinding table is complete and unique.
const assert = require('node:assert')
const Module = require('node:module')
const orig = Module._load
Module._load = function (req, ...a) { return req === 'vscode' ? { Uri: {}, window: {}, commands: {} } : orig.call(this, req, ...a) }
const Y = require('yjs')
const { ChatView } = require('../lib/chatView')
const pkg = require('../package.json')

const ydoc = new Y.Doc(); const chat = ydoc.getArray('chat')
const card = (id, status) => { const m = new Y.Map(); const t = new Y.Text(); ydoc.transact(() => { m.set('id', id); m.set('ts', Date.now()); m.set('author', 'coder'); m.set('isAgent', true); m.set('role', 'approval'); m.set('status', status); m.set('text', t); chat.push([m]); t.insert(0, 'Run it?') }); return m }
const a = card('a1', 'approved'); const b = card('a2', 'pending'); const c = card('a3', 'pending')
const view = new ChatView(() => ({ ydoc, chat, me: { name: 'shamit' } }), {})
assert.strictEqual(view.decideLatest(true), true)
assert.strictEqual(c.get('status'), 'approved', 'the newest pending card is answered'); assert.strictEqual(c.get('decidedBy'), 'shamit')
assert.strictEqual(b.get('status'), 'pending', 'older pending cards are left alone'); assert.strictEqual(a.get('status'), 'approved')
assert.strictEqual(view.decideLatest(false), true); assert.strictEqual(b.get('status'), 'denied')
assert.strictEqual(view.decideLatest(true), false, 'nothing left to answer')

const ids = new Set(pkg.contributes.commands.map(x => x.command))
for (const k of pkg.contributes.keybindings) assert.ok(ids.has(k.command), 'bound command is declared: ' + k.command)
const keys = pkg.contributes.keybindings.map(k => k.key); assert.strictEqual(new Set(keys).size, keys.length, 'no two commands share a key')
for (const need of ['murmio.approve', 'murmio.deny', 'murmio.say', 'murmio.askAgent', 'murmio.runIt', 'murmio.mode', 'murmio.codemap']) assert.ok(ids.has(need), 'declared: ' + need)
console.log('shortcut tests passed:', pkg.contributes.commands.length, 'commands,', keys.length, 'keybindings')
