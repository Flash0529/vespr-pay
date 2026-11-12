import assert from 'node:assert'
import { createTabs, MAX_TABS, MAX_PATH } from '../tabs.js'

let n = 0
const t = (name, fn) => {
  try {
    fn()
    n++
  } catch (e) {
    console.error('FAILED: ' + name)
    throw e
  }
}

t('open adds tabs and sets active', () => {
  const m = createTabs()
  const r1 = m.open('src/a.py')
  assert.equal(r1.active, 'src/a.py')
  assert.deepEqual(m.paths(), ['src/a.py'])
  assert.equal(m.active(), 'src/a.py')

  const r2 = m.open('src/b.py')
  assert.equal(r2.active, 'src/b.py')
  assert.deepEqual(m.paths(), ['src/a.py', 'src/b.py'])
})

t('re-opening an existing tab activates it without duplicating', () => {
  const m = createTabs()
  m.open('a.py')
  m.open('b.py')
  m.open('a.py')
  assert.equal(m.active(), 'a.py')
  assert.deepEqual(m.paths(), ['a.py', 'b.py'])
})

t('max limit evicts the least recently used unpinned tab', () => {
  const m = createTabs({ max: 3 })
  m.open('1.py')
  m.open('2.py')
  m.open('3.py')
  // Touch 1.py so 2.py is least recently used
  m.open('1.py')

  // Open 4.py -> should evict 2.py
  const r = m.open('4.py')
  assert.equal(r.evicted, '2.py')
  assert.deepEqual(m.paths(), ['1.py', '3.py', '4.py'])
  assert.equal(m.active(), '4.py')
})

t('pinned tabs are protected from eviction', () => {
  const m = createTabs({ max: 3 })
  m.open('1.py')
  m.pin('1.py', true)
  m.open('2.py')
  m.open('3.py')

  // Access 3.py, 1.py is pinned, 2.py is unpinned and LRU
  m.open('3.py')
  const r = m.open('4.py')
  assert.equal(r.evicted, '2.py')
  assert.deepEqual(m.paths(), ['1.py', '3.py', '4.py'])
  assert.equal(m.list().find(it => it.path === '1.py').pinned, true)
})

t('closing active tab selects adjacent right or left tab', () => {
  const m = createTabs()
  m.open('a.py')
  m.open('b.py')
  m.open('c.py')

  // Active is c.py (last). Close c.py -> next active should be b.py (left)
  const r1 = m.close('c.py')
  assert.equal(r1.closed, 'c.py')
  assert.equal(r1.active, 'b.py')
  assert.equal(m.active(), 'b.py')

  // Active is b.py. Switch to a.py, close a.py -> next active is b.py (right)
  m.open('a.py')
  const r2 = m.close('a.py')
  assert.equal(r2.closed, 'a.py')
  assert.equal(r2.active, 'b.py')
  assert.equal(m.active(), 'b.py')

  // Close last remaining tab
  const r3 = m.close('b.py')
  assert.equal(r3.closed, 'b.py')
  assert.equal(r3.active, '')
  assert.equal(m.active(), '')
  assert.deepEqual(m.paths(), [])
})

t('closeOthers preserves pinned tabs and target tab', () => {
  const m = createTabs()
  m.open('1.py')
  m.pin('1.py', true)
  m.open('2.py')
  m.open('3.py')
  m.open('4.py')

  const r = m.closeOthers('3.py')
  assert.deepEqual(r.closed, ['2.py', '4.py'])
  assert.deepEqual(m.paths(), ['1.py', '3.py'])
  assert.equal(m.active(), '3.py')
})

t('closeOthers on unknown target is a no-op and preserves all tabs', () => {
  const m = createTabs()
  m.open('1.py')
  m.open('2.py')
  const r = m.closeOthers('unknown.py')
  assert.deepEqual(r.closed, [])
  assert.deepEqual(m.paths(), ['1.py', '2.py'])
  assert.equal(m.active(), '2.py')
})

t('closeToRight only closes unpinned tabs to the right of target', () => {
  const m = createTabs()
  m.open('a.py')
  m.open('b.py')
  m.open('c.py')
  m.open('d.py')
  m.pin('d.py', true)
  m.open('e.py')

  // Order: a, b, c, d (pinned), e
  const r = m.closeToRight('b.py')
  assert.deepEqual(r.closed, ['c.py', 'e.py'])
  assert.deepEqual(m.paths(), ['a.py', 'b.py', 'd.py'])
})

t('move reorders tabs safely', () => {
  const m = createTabs()
  m.open('a.py')
  m.open('b.py')
  m.open('c.py')

  assert.equal(m.move(0, 2), true)
  assert.deepEqual(m.paths(), ['b.py', 'c.py', 'a.py'])

  // Out of bounds returns false without modifying
  assert.equal(m.move(-1, 2), false)
  assert.equal(m.move(0, 10), false)
  assert.deepEqual(m.paths(), ['b.py', 'c.py', 'a.py'])
})

t('rename updates single file and rewrites folder prefixes', () => {
  const m = createTabs()
  m.open('src/a.py')
  m.open('src/sub/b.py')
  m.open('lib/c.py')

  // Rename single file
  assert.equal(m.rename('lib/c.py', 'lib/main.py'), true)
  assert.deepEqual(m.paths(), ['src/a.py', 'src/sub/b.py', 'lib/main.py'])

  // Rename folder src -> pkg
  assert.equal(m.rename('src', 'pkg'), true)
  assert.deepEqual(m.paths(), ['pkg/a.py', 'pkg/sub/b.py', 'lib/main.py'])
  assert.equal(m.active(), 'lib/main.py')
})

t('rename collision preserves pinned status of either tab', () => {
  const m = createTabs()
  m.open('a.py')
  m.pin('a.py', true)
  m.open('b.py')
  // Rename b.py to a.py -> should merge and retain pinned
  assert.equal(m.rename('b.py', 'a.py'), true)
  assert.deepEqual(m.paths(), ['a.py'])
  assert.equal(m.list()[0].pinned, true)

  const m2 = createTabs()
  m2.open('x.py')
  m2.open('y.py')
  m2.pin('y.py', true)
  // Rename unpinned x.py to pinned y.py -> resulting tab must remain pinned
  assert.equal(m2.rename('x.py', 'y.py'), true)
  assert.deepEqual(m2.paths(), ['y.py'])
  assert.equal(m2.list()[0].pinned, true)
})

t('folder rename exceeding MAX_PATH skips invalid targets', () => {
  const m = createTabs()
  m.open('short/file.js')
  const giantPrefix = 'x'.repeat(MAX_PATH)
  // Renaming 'short' to giantPrefix would make nextPath > MAX_PATH
  const res = m.rename('short', giantPrefix)
  // Should not throw and should not produce an invalid > MAX_PATH entry
  for (const p of m.paths()) {
    assert(p.length <= MAX_PATH)
  }
})

t('serialize and deserialize round trip preserves state', () => {
  const m = createTabs()
  m.open('a.py')
  m.open('b.py')
  m.pin('b.py', true)
  m.open('c.py')

  const json = m.serialize()
  const m2 = createTabs()
  assert.equal(m2.deserialize(json), true)
  assert.equal(m2.active(), 'c.py')
  assert.deepEqual(m2.list(), [
    { path: 'a.py', pinned: false },
    { path: 'b.py', pinned: true },
    { path: 'c.py', pinned: false }
  ])
})

t('hostile inputs do not throw and are handled cleanly', () => {
  // Null or non-object constructor arguments
  const mNull = createTabs(null)
  assert.deepEqual(mNull.paths(), [])
  const mNum = createTabs(42)
  assert.deepEqual(mNum.paths(), [])
  const mNeg = createTabs({ max: -5 })
  assert.deepEqual(mNeg.paths(), [])

  const m = createTabs()
  m.open(null)
  m.open(undefined)
  m.open(123)
  m.open({})
  m.open('')
  m.open('a\u0000b')
  m.open('x'.repeat(MAX_PATH + 10))
  assert.deepEqual(m.paths(), [])

  m.close(null)
  m.pin(null)
  m.move('0', '1')
  m.rename(null, {})

  assert.equal(m.deserialize('not json'), false)
  assert.equal(m.deserialize('{"__proto__": {"polluted": true}}'), false)
  assert.equal(m.deserialize('{"items": [null, 123, {"path": ""}]}'), true)
  assert.deepEqual(m.paths(), [])
})

console.log(`tabs tests passed (${n})`)
