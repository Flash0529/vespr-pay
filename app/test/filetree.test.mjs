// Tests for app/filetree.js. Run: node app/test/filetree.test.mjs
import assert from 'node:assert'
import { ancestors, createTreeState, parseOpen, countFiles, arrowAction, MAX_OPEN } from '../filetree.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

t('ancestors', () => {
  assert.deepStrictEqual(ancestors('a/b/c.py'), ['a', 'a/b'])
  assert.deepStrictEqual(ancestors('c.py'), [])
  assert.deepStrictEqual(ancestors(''), [])
  assert.deepStrictEqual(ancestors('/x//y.py'), ['x'])
})

t('everything starts closed; the folders around the active file are open', () => {
  const s = createTreeState()
  assert.ok(!s.isOpen('skills'))
  s.setActive('skills/web/SKILL.md')
  assert.ok(s.isOpen('skills') && s.isOpen('skills/web') && !s.isOpen('docs'))
})

t('moving to another part closes what was only open for the old file', () => {
  const s = createTreeState(); s.setActive('skills/web/SKILL.md'); s.setActive('docs/notes.md')
  assert.ok(!s.isOpen('skills') && !s.isOpen('skills/web') && s.isOpen('docs'))
})

t('what the person opened by hand stays open when they leave', () => {
  const s = createTreeState(); s.setActive('cart.py'); s.toggle('docs'); s.setActive('skills/a.md'); s.setActive('cart.py')
  assert.ok(s.isOpen('docs') && !s.isOpen('skills'))
})

t('closing the folder of the file you are in keeps it closed until you move', () => {
  const s = createTreeState(); s.setActive('skills/a.md')
  assert.strictEqual(s.toggle('skills'), false); assert.ok(!s.isOpen('skills'))
  s.setActive('skills/b.md'); assert.ok(s.isOpen('skills')) // another file in it: opens again
  assert.strictEqual(s.setActive('skills/b.md'), false) // same file: no change
})

t('a manually opened folder can be closed and stays closed', () => {
  const s = createTreeState(); s.toggle('docs'); assert.ok(s.isOpen('docs')); s.toggle('docs'); assert.ok(!s.isOpen('docs'))
  s.setActive('x.py'); assert.ok(!s.isOpen('docs'))
})

t('serialize and restore keep only the hand-opened folders', () => {
  const s = createTreeState(); s.setActive('skills/a.md'); s.toggle('docs')
  const saved = s.serialize(); assert.deepStrictEqual(JSON.parse(saved), ['docs'])
  const r = createTreeState(saved); assert.ok(r.isOpen('docs') && !r.isOpen('skills'))
})

t('hostile or broken saved data is dropped', () => {
  assert.deepStrictEqual(parseOpen('not json'), [])
  assert.deepStrictEqual(parseOpen('{"a":1}'), [])
  assert.deepStrictEqual(parseOpen([1, null, '', 'ok', 'x\0y', 'a'.repeat(400)]), ['ok'])
  assert.ok(parseOpen(Array.from({ length: 5000 }, (_, i) => 'd' + i)).length <= MAX_OPEN)
  assert.deepStrictEqual(parseOpen(undefined), [])
})

t('the open list is capped and prune forgets folders that are gone', () => {
  const s = createTreeState(); for (let i = 0; i < MAX_OPEN + 20; i++) s.toggle('d' + i)
  assert.ok(s.manual.size <= MAX_OPEN)
  const p = createTreeState(['a', 'b/c', 'gone']); p.prune(['a/x.py', 'b/c/y.py'])
  assert.ok(p.isOpen('a') && p.isOpen('b/c') && !p.isOpen('gone'))
})

t('countFiles', () => {
  assert.strictEqual(countFiles({ n: 'd', dir: 1, kids: [{ n: 'a', dir: 0 }, { n: 'e', dir: 1, kids: [{ n: 'b', dir: 0 }, { n: 'c', dir: 0 }] }] }), 3)
  assert.strictEqual(countFiles(null), 0)
})

t('arrow keys: open, step in, step out, move', () => {
  const rows = [{ path: 'docs', dir: 1, open: false, depth: 0 }, { path: 'skills', dir: 1, open: true, depth: 0 }, { path: 'skills/a.md', dir: 0, depth: 1 }, { path: 'z.py', dir: 0, depth: 0 }]
  assert.deepStrictEqual(arrowAction(rows, 0, 'ArrowRight'), { toggle: 'docs' })
  assert.deepStrictEqual(arrowAction(rows, 1, 'ArrowRight'), { move: 2 })
  assert.deepStrictEqual(arrowAction(rows, 1, 'ArrowLeft'), { toggle: 'skills' })
  assert.deepStrictEqual(arrowAction(rows, 2, 'ArrowLeft'), { move: 1 })
  assert.strictEqual(arrowAction(rows, 3, 'ArrowLeft'), null)
  assert.deepStrictEqual(arrowAction(rows, 0, 'ArrowDown'), { move: 1 })
  assert.strictEqual(arrowAction(rows, 3, 'ArrowDown'), null)
  assert.deepStrictEqual(arrowAction(rows, 3, 'Home'), { move: 0 })
  assert.deepStrictEqual(arrowAction(rows, 0, 'End'), { move: 3 })
  assert.strictEqual(arrowAction(rows, 9, 'ArrowUp'), null)
})

console.log(`filetree tests passed (${n})`)
