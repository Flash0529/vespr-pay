// Two people create the same new file at the same moment (offline from each other, then they reconnect).
// Nothing may be lost or doubled: both copies survive (the second one under .vespr-conflicts/), each with its own text exactly once,
// and every peer ends up with the same view. Found while checking group coding on 2026-11-11: this was listed as an unchecked race.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileStore } from '../file-store.js'
const Y = createRequire(import.meta.url)('../../extensions/murmio-collab/node_modules/yjs')

const sync = (a, b) => { Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b)) }
const make = () => { const A = new Y.Doc(), B = new Y.Doc(); for (const d of [A, B]) d.getMap('settings').set('fileStoreVersion', 1); sync(A, B); return [A, B, fileStore(A), fileStore(B)] }
const create = (store, path, text) => { const t = new Y.Text(); store.set(path, t); t.insert(0, text) }
const view = s => Object.fromEntries([...s.entries()].map(([p, t]) => [p, t.toString()]))

test('the same file created by two people at once keeps both texts, once each, and both peers agree', () => {
  const [A, B, sa, sb] = make()
  create(sa, 'cart.py', 'def total():\n    pass\n'); create(sb, 'cart.py', 'def total():\n    pass\n')
  sync(A, B)
  assert.deepEqual(view(sa), view(sb), 'both peers show the same files')
  const v = view(sa)
  assert.equal(Object.keys(v).length, 2, 'the name is kept once and the second copy goes to the conflicts folder')
  assert.ok(v['cart.py'] && Object.keys(v).some(p => p.startsWith('.vespr-conflicts')))
  for (const text of Object.values(v)) assert.equal(text, 'def total():\n    pass\n', 'no text is doubled or cut')
  assert.equal(sa.conflicts().length, 1)
})

test('different text created under the same name by two people: both survive, neither is merged into the other', () => {
  const [A, B, sa, sb] = make()
  create(sa, 'notes.md', 'alex wrote this'); create(sb, 'notes.md', 'sam wrote this')
  sync(A, B)
  assert.deepEqual(view(sa), view(sb))
  assert.deepEqual(Object.values(view(sa)).sort(), ['alex wrote this', 'sam wrote this'])
})

test('typing into the file after the clash goes to the copy the person sees and does not leak into the other', () => {
  const [A, B, sa, sb] = make()
  create(sa, 'a.py', 'x'); create(sb, 'a.py', 'x'); sync(A, B)
  sa.get('a.py').insert(1, 'yz'); sync(A, B)
  assert.equal(sb.get('a.py').toString(), 'xyz')
  const other = Object.entries(view(sb)).find(([p]) => p.startsWith('.vespr-conflicts'))
  assert.equal(other[1], 'x')
})
