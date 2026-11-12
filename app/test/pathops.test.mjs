// Tests for app/pathops.js. Run: node app/test/pathops.test.mjs
import assert from 'node:assert'
import { validateName, joinPath, exists, planCreate, planRename, planDelete, isMarker, visiblePaths, FOLDER_MARKER, MAX_SEGMENT } from '../pathops.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const P = ['README.md', 'cart.py', 'docs/notes.md', 'docs/deep/a.md', 'docs/deep/b.md', 'src/app.js']

t('validateName accepts plain names, dotfiles and nested paths', () => {
  for (const ok of ['a.py', '.gitignore', 'src/new_file-2.js', './x.md', '  y.txt  ']) assert.ok(validateName(ok).ok, ok)
  assert.strictEqual(validateName('./x.md').name, 'x.md')
  assert.strictEqual(validateName('  y.txt  ').name, 'y.txt')
})

t('validateName refuses everything unsafe, with a plain reason', () => {
  const bad = [null, undefined, 5, '', '   ', '/abs', 'a\\b', 'a//b', 'a/', '..', 'a/../b', 'a/./b', '.', 'bad name.py', 'a/b c', 'tab\tname', 'nul\0name', 'ends.', 'café.py', '.git', '.GIT/config', 'x/.keep', 'a'.repeat(MAX_SEGMENT + 1), Array(14).fill('d').join('/'), 'a/'.repeat(5) + 'b'.repeat(120) + '/' + 'c'.repeat(120) + '/' + 'e'.repeat(100)]
  for (const b of bad) { const r = validateName(b); assert.strictEqual(r.ok, false, String(b).slice(0, 30)); assert.ok(r.reason.length > 4) }
})

t('__proto__ and constructor are ordinary names', () => {
  assert.ok(validateName('__proto__').ok); assert.ok(validateName('constructor').ok)
  const r = planCreate(P, '', '__proto__', 'file'); assert.ok(r.ok); assert.deepStrictEqual(r.add, ['__proto__'])
})

t('joinPath', () => {
  assert.strictEqual(joinPath('', 'a.py'), 'a.py'); assert.strictEqual(joinPath('docs', 'a.md'), 'docs/a.md')
  assert.strictEqual(joinPath('/docs/', '/a.md'), 'docs/a.md'); assert.strictEqual(joinPath(null, 'a'), 'a')
})

t('exists is case-insensitive and tells files from folders', () => {
  assert.strictEqual(exists(P, 'readme.MD'), 'file'); assert.strictEqual(exists(P, 'DOCS'), 'folder'); assert.strictEqual(exists(P, 'docs/deep'), 'folder')
  assert.strictEqual(exists(P, 'nope'), null); assert.strictEqual(exists(null, 'x'), null)
})

t('planCreate: file, folder marker, nested', () => {
  assert.deepStrictEqual(planCreate(P, '', 'new.py', 'file'), { ok: true, add: ['new.py'], path: 'new.py' })
  assert.deepStrictEqual(planCreate(P, 'docs', 'x.md', 'file').add, ['docs/x.md'])
  assert.deepStrictEqual(planCreate(P, '', 'assets', 'folder').add, ['assets/' + FOLDER_MARKER])
  assert.deepStrictEqual(planCreate(P, 'src', 'lib/util', 'folder').add, ['src/lib/util/' + FOLDER_MARKER])
})

t('planCreate refuses collisions in any letter case, and a file where a folder is needed', () => {
  assert.strictEqual(planCreate(P, '', 'CART.PY', 'file').ok, false)
  assert.strictEqual(planCreate(P, '', 'docs', 'file').ok, false)      // a folder has that name
  assert.strictEqual(planCreate(P, '', 'cart.py', 'folder').ok, false) // a file has that name
  assert.strictEqual(planCreate(P, 'cart.py', 'x.py', 'file').ok, false) // cart.py is a file, cannot hold x.py
  assert.strictEqual(planCreate(P, '', 'x', 'weird').ok, false)
  assert.ok(/already a file/.test(planCreate(P, '', 'cart.py', 'file').reason))
})

t('planRename: a file', () => {
  assert.deepStrictEqual(planRename(P, 'cart.py', 'basket.py'), { ok: true, moves: [['cart.py', 'basket.py']] })
  assert.deepStrictEqual(planRename(P, 'cart.py', 'src/cart.py').moves, [['cart.py', 'src/cart.py']])
})

t('planRename: a folder with three files', () => {
  const r = planRename(P, 'docs', 'guides'); assert.ok(r.ok)
  assert.deepStrictEqual(r.moves, [['docs/deep/a.md', 'guides/deep/a.md'], ['docs/deep/b.md', 'guides/deep/b.md'], ['docs/notes.md', 'guides/notes.md']])
})

t('planRename refuses: nothing there, same name, into itself, collision, bad name', () => {
  assert.strictEqual(planRename(P, 'ghost.py', 'a.py').ok, false)
  assert.strictEqual(planRename(P, 'cart.py', 'cart.py').ok, false)
  assert.strictEqual(planRename(P, 'docs', 'docs/inner').ok, false)
  assert.strictEqual(planRename(P, 'docs', 'DOCS/inner').ok, false)
  assert.strictEqual(planRename(P, 'cart.py', 'README.md').ok, false)
  assert.strictEqual(planRename(P, 'cart.py', 'readme.md').ok, false)
  assert.strictEqual(planRename(P, 'cart.py', 'bad name').ok, false)
  assert.strictEqual(planRename(P, 'cart.py', 'docs').ok, false)        // a folder is called that
  assert.strictEqual(planRename(P, 'cart.py', 'README.md/x').ok, false) // README.md is a file
})

t('planRename allows a letter-case-only rename and a folder rename onto freed names', () => {
  assert.deepStrictEqual(planRename(P, 'cart.py', 'Cart.py').moves, [['cart.py', 'Cart.py']])
  assert.ok(planRename(P, 'docs', 'Docs').ok)
})

t('planDelete: file, folder, nothing', () => {
  assert.deepStrictEqual(planDelete(P, 'cart.py'), { ok: true, remove: ['cart.py'], count: 1, kind: 'file' })
  const d = planDelete(P, 'docs'); assert.deepStrictEqual(d.remove, ['docs/deep/a.md', 'docs/deep/b.md', 'docs/notes.md']); assert.strictEqual(d.count, 3); assert.strictEqual(d.kind, 'folder')
  assert.strictEqual(planDelete(P, 'ghost').ok, false)
  assert.strictEqual(planDelete(P, 'doc').ok, false) // a prefix of a name is not a folder
})

t('markers stay out of sight', () => {
  assert.ok(isMarker('a/.keep')); assert.ok(!isMarker('a/.keeper')); assert.deepStrictEqual(visiblePaths(['a/.keep', 'a/b.py']), ['a/b.py'])
})

t('a large project stays fast', () => {
  const big = Array.from({ length: 10000 }, (_, i) => `d${i % 50}/f${i}.py`)
  const t0 = Date.now(); planCreate(big, 'd1', 'x.py', 'file'); planRename(big, 'd3', 'e3'); planDelete(big, 'd4')
  assert.ok(Date.now() - t0 < 500, 'took ' + (Date.now() - t0))
})

console.log(`pathops tests passed (${n})`)
