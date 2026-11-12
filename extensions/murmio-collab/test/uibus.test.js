// The UI command bus: only your own shell drives your SDE, only real and safe files, only agents that are here; old entries are history.
const assert = require('node:assert')
const Y = require('yjs')
const { plan, attach, safeRel } = require('../lib/uibus')

const ctx = { me: 'alice', filesHas: p => ['cart.py', 'src/a.js'].includes(p), agents: () => ['coder'] }
assert.deepStrictEqual(plan({ by: 'alice', type: 'open', file: 'cart.py', line: 8 }, ctx), { kind: 'open', file: 'cart.py', line: 8 })
assert.deepStrictEqual(plan({ by: 'alice', type: 'open', file: 'src/a.js' }, ctx), { kind: 'open', file: 'src/a.js', line: 1 }, 'no line means line 1')
assert.strictEqual(plan({ by: 'alice', type: 'open', file: 'cart.py', line: 99999999 }, ctx).line, 1_000_000); assert.strictEqual(plan({ by: 'alice', type: 'open', file: 'cart.py', line: -4 }, ctx).line, 1); assert.strictEqual(plan({ by: 'alice', type: 'open', file: 'cart.py', line: '8' }, ctx).line, 1)
assert.strictEqual(plan({ by: 'mallory', type: 'open', file: 'cart.py' }, ctx), null, 'someone else cannot drive your SDE')
for (const bad of ['../etc/passwd', '/etc/passwd', '.git/config', 'a/../b', '.vscode/tasks.json', 'src//a.js', 'a\\b', 'nope.py', '', 'x'.repeat(400)]) assert.strictEqual(plan({ by: 'alice', type: 'open', file: bad }, ctx), null, 'refused: ' + bad)
assert.strictEqual(plan({ by: 'alice', type: 'open', file: { toString: () => 'cart.py' } }, ctx), null)
assert.deepStrictEqual(plan({ by: 'alice', type: 'follow', agent: 'coder' }, ctx), { kind: 'follow', agent: 'coder' }); assert.strictEqual(plan({ by: 'alice', type: 'follow', agent: 'bob' }, ctx), null, 'only agents that are here')
assert.deepStrictEqual(plan({ by: 'alice', type: 'unfollow' }, ctx), { kind: 'unfollow' })
for (const x of [null, undefined, 'open', 5, { by: 'alice', type: 'exec', cmd: 'rm -rf /' }, { by: 'alice' }]) assert.strictEqual(plan(x, ctx), null)
assert.ok(safeRel('a/b/c.py') && !safeRel('a/./..'))

// attach: entries that appear later run once; history, other people's, stale and malformed ones do not
const d = new Y.Doc(); const arr = d.getArray('ui'); let t = 1_000_000; const now = () => t
arr.push([{ id: 'old1', ts: t - 1000, by: 'alice', type: 'open', file: 'cart.py' }])
const ran = []; const stop = attach(d, ctx, p => ran.push(p), now)
assert.strictEqual(ran.length, 0, 'what was there before attach is history')
arr.push([{ id: 'n1', ts: t, by: 'alice', type: 'open', file: 'cart.py', line: 3 }]); assert.deepStrictEqual(ran, [{ kind: 'open', file: 'cart.py', line: 3 }])
arr.push([{ id: 'n2', ts: t, by: 'mallory', type: 'open', file: 'cart.py' }, { id: 'n3', ts: t - 60_000, by: 'alice', type: 'open', file: 'cart.py' }, { id: 'n4', ts: t + 3_600_000, by: 'alice', type: 'open', file: 'cart.py' }, { id: 'n5', ts: t, by: 'alice', type: 'follow', agent: 'coder' }, 'junk', { type: 'open' }])
assert.deepStrictEqual(ran.slice(1), [{ kind: 'follow', agent: 'coder' }], 'only the valid fresh one ran: ' + JSON.stringify(ran))
arr.push([{ id: 'n1', ts: t, by: 'alice', type: 'open', file: 'cart.py' }]); assert.strictEqual(ran.length, 2, 'the same id never runs twice')
const failing = attach(new Y.Doc(), ctx, () => { throw new Error('boom') }, now); failing()
const d2 = new Y.Doc(); attach(d2, ctx, () => { throw new Error('boom') }, now); d2.getArray('ui').push([{ id: 'z', ts: t, by: 'alice', type: 'unfollow' }]) // a failing run does not throw into the document
stop(); arr.push([{ id: 'n6', ts: t, by: 'alice', type: 'unfollow' }]); assert.strictEqual(ran.length, 2, 'stopped')
console.log('uibus tests passed')
