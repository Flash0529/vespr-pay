// Smoke tests for core.js and presence.js (the heavy fuzzing lives in core.test.js, owned by the test agent).
// Run: node app/editor/test/smoke.test.js   (Yjs comes from the app's own vendored build, the one the browser uses)
import assert from 'node:assert/strict'
import * as Y from '../../vendor/yjs.js'
import { createBinding, deltaToChanges, changesToText, sanitizeInsert, describeSpan, spanAt, formatMinute } from '../core.js'
import { setLocalSelection, remoteSelections } from '../presence.js'

let n = 0
const test = (name, fn) => { fn(); n++ }
const attrsOf = (ytext, i) => { let pos = 0; for (const op of ytext.toDelta()) { if (i < pos + op.insert.length) return op.attributes || {}; pos += op.insert.length } }
const pair = () => { // two peers that exchange updates when we say so
  const a = new Y.Doc(); const b = new Y.Doc()
  const sync = () => { Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b)) }
  return { a, b, ta: a.getText('f'), tb: b.getText('f'), sync }
}

test('deltaToChanges and changesToText agree with Y.Text', () => {
  const d = new Y.Doc(); const t = d.getText('f'); t.insert(0, 'hello world')
  let mirror = 'hello world'
  t.observe(ev => { mirror = changesToText(mirror, deltaToChanges(ev.delta)) })
  t.delete(3, 4); assert.equal(mirror, 'helorld')
  t.insert(3, 'XYZ'); assert.equal(mirror, 'helXYZorld')
  d.transact(() => { t.delete(0, 2); t.insert(0, 'Q'); t.insert(t.length, '!') }); assert.equal(mirror, t.toString())
  assert.deepEqual(deltaToChanges([{ retain: 2 }, { delete: 3 }, { insert: 'ab' }, { retain: 1 }, { insert: 'z' }]), [{ from: 2, to: 5, insert: 'ab' }, { from: 6, to: 6, insert: 'z' }])
  assert.deepEqual(deltaToChanges([{ retain: 4, attributes: { by: 'x' } }, { insert: 'k' }]), [{ from: 4, to: 4, insert: 'k' }]) // attribute-only retain only moves along
  assert.deepEqual(deltaToChanges([]), [])
})

test('changesToText: several changes in old coordinates, and bad ones throw', () => {
  assert.equal(changesToText('0123456789', [{ from: 8, to: 10, insert: '' }, { from: 0, to: 0, insert: '>' }, { from: 3, to: 5, insert: 'XY!' }]), '>012XY!567')
  assert.equal(changesToText('abc', []), 'abc')
  assert.throws(() => changesToText('abc', [{ from: 2, to: 9, insert: '' }]), RangeError)
  assert.throws(() => changesToText('abcdef', [{ from: 1, to: 4, insert: '' }, { from: 3, to: 5, insert: '' }]), RangeError)
})

test('applyLocal: one transaction, authorship on every insert, a person never inherits an agent', () => {
  const d = new Y.Doc(); const t = d.getText('f')
  const agent = createBinding({ Y, ytext: t, user: { name: 'coder', ai: true, model: 'nemotron' } })
  agent.applyLocal([{ from: 0, to: 0, insert: 'agent line\n' }])
  assert.deepEqual({ ...attrsOf(t, 0), t: 0 }, { by: 'coder', ai: true, model: 'nemotron', t: 0 })
  const person = createBinding({ Y, ytext: t, user: { name: 'Alex Morgan' } })
  let updates = 0; d.on('update', () => updates++)
  person.applyLocal([{ from: 5, to: 5, insert: 'XX' }, { from: 9, to: 10, insert: '' }, { from: 11, to: 11, insert: 'mine\n' }]) // several changes
  assert.equal(updates, 1)
  assert.equal(t.toString(), 'agentXX lin\nmine\n')
  const mid = attrsOf(t, 5)
  assert.equal(mid.by, 'Alex Morgan'); assert.equal(mid.ai, undefined); assert.equal(mid.model, undefined)
  assert.equal(attrsOf(t, 4).by, 'coder'); assert.equal(attrsOf(t, 4).ai, true) // the agent's text keeps its own
  assert.equal(attrsOf(t, t.length - 1).by, 'Alex Morgan'); assert.equal(attrsOf(t, t.length - 1).ai, undefined)
  assert.equal(attrsOf(t, 5).t, Math.floor(Date.now() / 60000))
  assert.throws(() => person.applyLocal([{ from: 0, to: 999, insert: '' }]), RangeError)
  assert.equal(t.toString(), 'agentXX lin\nmine\n') // a bad change changed nothing
  person.applyLocal([]); person.applyLocal([{ from: 2, to: 2, insert: '' }]) // empty changes are nothing, not an error
  assert.equal(updates, 1)
})

test('onRemote: only other origins, in pre-change coordinates; unicode counts UTF-16 units', () => {
  const { ta, tb, sync } = pair()
  const a = createBinding({ Y, ytext: ta, user: { name: 'alex' } })
  const b = createBinding({ Y, ytext: tb, user: { name: 'sam' } })
  let editorA = ''; let editorB = ''
  a.onRemote(ch => { editorA = changesToText(editorA, ch) }); b.onRemote(ch => { editorB = changesToText(editorB, ch) })
  a.applyLocal([{ from: 0, to: 0, insert: 'a😀 日本 éb' }]); editorA = changesToText(editorA, [{ from: 0, to: 0, insert: 'a😀 日本 éb' }]) // the editor applied its own change itself
  assert.equal(editorB, ''); sync(); assert.equal(editorB, 'a😀 日本 éb')
  a.applyLocal([{ from: 3, to: 3, insert: '[A]' }]); editorA = changesToText(editorA, [{ from: 3, to: 3, insert: '[A]' }])
  b.applyLocal([{ from: 3, to: 3, insert: '[B]' }]); editorB = changesToText(editorB, [{ from: 3, to: 3, insert: '[B]' }]) // same spot at the same instant
  sync()
  assert.equal(ta.toString(), tb.toString()); assert.equal(editorA, ta.toString()); assert.equal(editorB, tb.toString())
  assert.equal(ta.length, [...'a😀 日本 éb[A][B]'].length + 1) // emoji is two units: 2 + the rest
})

test('undo and redo touch only your own changes', () => {
  const { ta, tb, sync } = pair()
  const a = createBinding({ Y, ytext: ta, user: { name: 'alex' } })
  const b = createBinding({ Y, ytext: tb, user: { name: 'sam' } })
  a.applyLocal([{ from: 0, to: 0, insert: 'one ' }]); sync()
  b.applyLocal([{ from: 4, to: 4, insert: 'two ' }]); sync()
  assert.equal(ta.toString(), 'one two ')
  assert.ok(a.canUndo()); assert.ok(!b.canRedo())
  const seen = []; a.onRemote((ch, info) => seen.push({ ch, undo: info.undo }))
  assert.equal(a.undo(), true) // removes 'one ', keeps sam's 'two '
  assert.equal(ta.toString(), 'two '); assert.deepEqual(seen, [{ ch: [{ from: 0, to: 4, insert: '' }], undo: true }])
  assert.equal(a.canUndo(), false); assert.equal(a.undo(), false)
  assert.equal(a.redo(), true); assert.equal(ta.toString(), 'one two ')
  assert.equal(attrsOf(ta, 0).by, 'alex'); assert.equal(attrsOf(ta, 4).by, 'sam')
  sync(); assert.equal(tb.toString(), 'one two ')
  a.destroy(); assert.equal(a.undo(), false); a.applyLocal([{ from: 0, to: 0, insert: 'x' }]); assert.equal(ta.toString(), 'one two ') // destroyed: inert
})

// a stand-in for y-protocols Awareness (the bundle does not export it): same getStates / clientID / setLocalStateField
const fakeAwareness = (clientID, shared) => ({ clientID, getStates: () => shared, setLocalStateField (k, v) { shared.set(clientID, { ...(shared.get(clientID) || {}), [k]: v }) } })

test('presence: wire format, never yourself, only this file, survives typing', () => {
  const { a, b, ta, tb, sync } = pair()
  ta.insert(0, 'hello world'); sync()
  const states = new Map() // one shared table both sides see (what the websocket provider converges to)
  const awA = fakeAwareness(a.clientID, states); const awB = fakeAwareness(b.clientID, states)
  awA.setLocalStateField('user', { name: 'alex', color: 'hsl(10, 70%, 60%)', isAgent: false })
  awB.setLocalStateField('user', { name: 'sam', color: 'hsl(200, 70%, 60%)', isAgent: false })
  setLocalSelection({ Y, awareness: awA, ytext: ta, file: 'cart.py', anchor: 6, head: 11 })
  const wire = JSON.parse(JSON.stringify([...states]))[0][1].cursor // what a peer reads off the network
  assert.equal(wire.file, 'cart.py'); assert.ok(wire.anchor && wire.head)
  assert.deepEqual(remoteSelections({ Y, awareness: awA, ytext: ta, file: 'cart.py' }), []) // never yourself
  const seen = remoteSelections({ Y, awareness: awB, ytext: tb, file: 'cart.py' })
  assert.deepEqual(seen, [{ clientId: a.clientID, name: 'alex', color: 'hsl(10, 70%, 60%)', isAgent: false, anchor: 6, head: 11 }])
  assert.deepEqual(remoteSelections({ Y, awareness: awB, ytext: tb, file: 'other.py' }), []) // another file
  tb.insert(0, '>>> '); sync() // sam types before alex's selection: it keeps pointing at 'world'
  const moved = remoteSelections({ Y, awareness: awB, ytext: tb, file: 'cart.py' })[0]
  assert.equal(tb.toString().slice(moved.anchor, moved.head), 'world')
  states.get(a.clientID).cursor = { file: 'cart.py', anchor: { junk: true }, head: 'nope' } // a hostile or stale peer must not throw
  assert.deepEqual(remoteSelections({ Y, awareness: awB, ytext: tb, file: 'cart.py' }), [])
  setLocalSelection({ Y, awareness: awA, ytext: ta, file: 'cart.py', anchor: null, head: null }); assert.equal(states.get(a.clientID).cursor, null)
})

test('presence: an agent written the way agents/src/room.js writes it is read back', () => {
  const d = new Y.Doc(); const t = d.getText('f'); t.insert(0, 'abcdef')
  const states = new Map([[777, { user: { name: 'coder', color: '#a5b4fc', isAgent: true, model: 'm' }, cursor: { file: 'f.py', anchor: Y.createRelativePositionFromTypeIndex(t, 1), head: Y.createRelativePositionFromTypeIndex(t, 4) } }]])
  const aw = fakeAwareness(1, states)
  assert.deepEqual(remoteSelections({ Y, awareness: aw, ytext: t, file: 'f.py' }), [{ clientId: 777, name: 'coder', color: '#a5b4fc', isAgent: true, anchor: 1, head: 4 }])
})

test('lone surrogates: sanitized, so the sender and every peer read the same text; a pair split over touching changes stays one emoji', () => {
  assert.equal(sanitizeInsert('a\uD83Db\uDE00c'), 'a�b�c'); assert.equal(sanitizeInsert('x😀y'), 'x😀y'); assert.equal(sanitizeInsert('plain'), 'plain')
  const { ta, tb, sync } = pair(); const a = createBinding({ Y, ytext: ta, user: { name: 'alex' }, heal: false })
  a.applyLocal([{ from: 0, to: 0, insert: 'x\uD83Dy' }]); sync()
  assert.equal(ta.toString(), 'x�y'); assert.equal(tb.toString(), ta.toString())
  a.applyLocal([{ from: 1, to: 1, insert: '\uD83D' }, { from: 1, to: 1, insert: '\uDE00' }]); sync()
  assert.equal(ta.toString(), 'x😀�y'); assert.equal(tb.toString(), ta.toString())
  assert.deepEqual(changesToText('abcdef', [{ from: 1, to: 3, insert: '' }, { from: 3, to: 3, insert: 'Z' }]), 'aZdef') // touching changes are one replacement
})

// alex types after 'hello' while sam deletes 'hello': Yjs takes the shared authorship markers with the deleted text
const healScene = opts => {
  const { ta, tb, sync } = pair(); ta.insert(0, 'seed text', { by: 'import' }); sync()
  const a = createBinding({ Y, ytext: ta, user: { name: 'alex' }, ...opts }); const b = createBinding({ Y, ytext: tb, user: { name: 'sam' }, ...opts })
  a.applyLocal([{ from: 9, to: 9, insert: 'hello' }]); sync()
  b.applyLocal([{ from: 9, to: 14, insert: '' }]); a.applyLocal([{ from: 14, to: 14, insert: ' world' }]); sync()
  return { ta, tb, a, b, sync, at: ta.toString().indexOf(' world') }
}
test('heal: your authorship comes back after another peer deletes the text your run hangs on', () => {
  const { ta, tb, a, b, sync, at } = healScene({ heal: false })
  assert.equal(ta.toString(), 'seed text world'); assert.equal(tb.toString(), ta.toString())
  assert.notEqual(attrsOf(ta, at).by, 'alex', 'precondition: Yjs loses the authorship in this scene, or the test proves nothing')
  assert.equal(b.heal(), 0) // sam has nothing that lost its markers
  assert.equal(a.heal(), 6); sync()
  for (const t of [ta, tb]) { for (let i = at; i < at + 6; i++) assert.equal(attrsOf(t, i).by, 'alex'); assert.equal(attrsOf(t, 2).by, 'import'); assert.equal(attrsOf(t, at).ai, undefined) }
  assert.equal(a.heal(), 0) // nothing left to fix
  a.undo(); sync(); assert.equal(ta.toString(), 'seed text'); assert.equal(tb.toString(), 'seed text') // undo still works after a heal
})
test('heal never touches text another writer put in through the same Y.Doc (an agent in the same process)', () => {
  const { a: da, ta, tb, sync } = pair(); ta.insert(0, 'seed text', { by: 'import' }); sync()
  const alex = createBinding({ Y, ytext: ta, user: { name: 'alex' }, heal: false }); const sam = createBinding({ Y, ytext: tb, user: { name: 'sam' }, heal: false })
  alex.applyLocal([{ from: 9, to: 9, insert: 'hello' }]); sync()
  da.transact(() => ta.insert(14, ' AGENT', { by: 'coder', ai: true, model: 'm', t: 1 }), 'agent'); sync()
  sam.applyLocal([{ from: 9, to: 14, insert: '' }]); sync(); alex.heal(); sync()
  const i = ta.toString().indexOf('AGENT'); assert.equal(attrsOf(ta, i).by, 'coder'); assert.equal(attrsOf(ta, i).ai, true); assert.equal(attrsOf(tb, i).by, 'coder')
})
test('describeSpan: attrs -> the hover text (author, agent badge, model, time, request), with and without a resolver', () => {
  const t = Date.UTC(2026, 9, 29, 14, 5) / 60000 // 14:05 UTC
  assert.equal(formatMinute(t, true), '14:05'); assert.equal(formatMinute(undefined), ''); assert.equal(formatMinute(0), '')
  const person = describeSpan({ by: 'Alex Morgan', t }, null, { utc: true })
  assert.deepEqual(person, { imported: false, author: 'Alex Morgan', agent: false, model: '', time: '14:05', request: '', text: 'Alex Morgan · 14:05' })
  const agent = { by: 'coder', ai: true, model: 'demo-model', msg: 'm-1', t }
  assert.equal(describeSpan(agent, null, { utc: true }).text, 'coder (agent) · demo-model · 14:05') // no resolver: author, model and time only
  const asked = describeSpan(agent, a => ({ request: '  fix the\n discount   code ' }), { utc: true })
  assert.equal(asked.request, 'fix the discount code'); assert.equal(asked.text, 'coder (agent) · demo-model · 14:05 · asked: fix the discount code'); assert.equal(asked.agent, true)
  let seen; describeSpan(agent, a => { seen = a.msg; return null }); assert.equal(seen, 'm-1') // the resolver gets the attributes, so the shell can look up attrs.msg
  assert.equal(describeSpan(agent, () => { throw new Error('no such message') }, { utc: true }).text, 'coder (agent) · demo-model · 14:05') // a resolver that fails changes nothing
  assert.equal(describeSpan(agent, () => ({ request: 'x'.repeat(500) })).request.length, 200)
  assert.equal(describeSpan({ by: 'import' }).imported, true); assert.match(describeSpan({ by: 'import' }).text, /Imported with the project/)
  assert.equal(describeSpan({}), null); assert.equal(describeSpan(null), null); assert.equal(describeSpan({ t: 5 }), null) // nobody recorded: no tooltip
})
test('spanAt: the run one author wrote, found by index, across minutes and next to an agent', () => {
  const d = new Y.Doc(); const t = d.getText('f'); t.insert(0, 'seed ', { by: 'import' })
  t.insert(5, 'one ', { by: 'alex', t: 100 }); t.insert(9, 'two ', { by: 'alex', t: 101 }) // same author, a later minute: one run
  t.insert(13, 'AGENT ', { by: 'coder', ai: true, model: 'm', msg: 'x', t: 102 }); t.insert(19, 'tail', { by: 'alex', t: 103 })
  assert.equal(t.toString(), 'seed one two AGENT tail')
  assert.deepEqual(spanAt(t, 2), { from: 0, to: 5, attrs: { by: 'import' } })
  const mid = spanAt(t, 10); assert.equal(mid.from, 5); assert.equal(mid.to, 13); assert.equal(mid.attrs.t, 101) // the run spans both minutes, the attrs are the character's own
  const ag = spanAt(t, 15); assert.equal(ag.from, 13); assert.equal(ag.to, 19); assert.equal(describeSpan(ag.attrs, () => ({ request: 'add a comment' }), { utc: true }).text, 'coder (agent) · m · 00:00 · asked: add a comment'.replace('00:00', formatMinute(102, true)))
  assert.equal(spanAt(t, 19).from, 19); assert.equal(spanAt(t, 22).to, 23); assert.equal(spanAt(t, 23), null); assert.equal(spanAt(t, -1), null)
})
// the same scene with the default (automatic) heal: it runs by itself shortly after the remote delete
{
  const { ta, tb, sync, at } = healScene({})
  await new Promise(r => setTimeout(r, 400)); sync()
  for (const t of [ta, tb]) for (let i = at; i < at + 6; i++) assert.equal(attrsOf(t, i).by, 'alex')
  n++
}

console.log(`editor smoke tests passed: ${n}`)
