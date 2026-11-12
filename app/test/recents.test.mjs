import assert from 'node:assert'
import { createRecents, MAX_RECENTS, MAX_PATH } from '../recents.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

t('order after several touches', () => {
  const r = createRecents()
  r.touch('a.py')
  r.touch('b.py')
  r.touch('c.py')
  assert.deepStrictEqual(r.list(), ['c.py', 'b.py', 'a.py'])
})

t('touching an old one moves it to the front', () => {
  const r = createRecents()
  r.touch('a.py')
  r.touch('b.py')
  r.touch('a.py')
  assert.deepStrictEqual(r.list(), ['a.py', 'b.py'])
})

t('cap at 12', () => {
  const r = createRecents()
  for (let i = 0; i < 20; i++) {
    r.touch(`file${i}.py`)
  }
  assert.strictEqual(r.list().length, MAX_RECENTS)
  assert.strictEqual(r.list()[0], 'file19.py')
  assert.strictEqual(r.list()[11], 'file8.py')
})

t('list(existing) filters', () => {
  const r = createRecents()
  r.touch('a.py')
  r.touch('b.py')
  r.touch('c.py')
  assert.deepStrictEqual(r.list(['a.py', 'c.py']), ['c.py', 'a.py'])
})

t('remove deletes an item', () => {
  const r = createRecents()
  r.touch('a.py')
  r.touch('b.py')
  r.remove('a.py')
  assert.deepStrictEqual(r.list(), ['b.py'])
})

t('folder rename rewrites and de-duplicates', () => {
  const r = createRecents()
  r.touch('src/b.py')
  r.touch('lib/b.py')
  r.touch('src/a.py')
  // Before rename: ['src/a.py', 'lib/b.py', 'src/b.py']
  // Renaming folder 'src' to 'lib':
  // 'src/a.py' -> 'lib/a.py'
  // 'lib/b.py' stays 'lib/b.py'
  // 'src/b.py' -> 'lib/b.py' (duplicate of above, so older one is dropped)
  r.rename('src', 'lib')
  assert.deepStrictEqual(r.list(), ['lib/a.py', 'lib/b.py'])
})

t('hostile saved data', () => {
  assert.deepStrictEqual(createRecents('not json').list(), [])
  assert.deepStrictEqual(createRecents('{ "a": 1 }').list(), [])
  assert.deepStrictEqual(createRecents([null, undefined, 123, '', 'a'.repeat(301), 'bad\0name']).list(), [])
  assert.deepStrictEqual(createRecents('__proto__').list(), [])
})

t('serialize/restore round trip', () => {
  const r1 = createRecents()
  r1.touch('main.js')
  r1.touch('utils.js')
  const serialized = r1.serialize()

  const r2 = createRecents(serialized)
  assert.deepStrictEqual(r2.list(), ['utils.js', 'main.js'])
})

console.log('recents tests passed (' + n + ')')
