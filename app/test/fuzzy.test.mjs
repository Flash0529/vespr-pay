import assert from 'node:assert'
import { score, rank, highlight, MAX_TEXT, MAX_RESULTS } from '../fuzzy.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

// Hand-calculated test cases:
// 1. score('cpy', 'cart.py') -> 411
t('exact hand score 1: cart.py with cpy', () => {
  assert.strictEqual(score('cpy', 'cart.py'), 411)
})

// 2. score('a', 'a') -> 160
t('exact hand score 2: a with a', () => {
  assert.strictEqual(score('a', 'a'), 160)
})

// 3. score('b', 'ab') -> 104
t('exact hand score 3: ab with b', () => {
  assert.strictEqual(score('b', 'ab'), 104)
})

t('word-start beats mid-word', () => {
  const wordStart = score('b', 'a_b')
  const midWord = score('b', 'ab')
  assert.ok(wordStart > midWord)
})

t('run beats scattered', () => {
  const runScore = score('ab', 'xab')
  const scattered = score('ab', 'xayb')
  assert.ok(runScore > scattered)
})

t('shorter text wins a tie', () => {
  const r = rank('a', ['abc', 'ab'])
  assert.deepStrictEqual(r, ['ab', 'abc'])
})

t('missing letter returns null', () => {
  assert.strictEqual(score('z', 'cart.py'), null)
})

t('empty query returns zero or all items in original order', () => {
  assert.strictEqual(score('', 'cart.py'), 0)
  assert.deepStrictEqual(rank('', ['second', 'first']), ['second', 'first'])
})

t('rank preserves stable order for identical scores and lengths', () => {
  const items = [{ id: 1, name: 'ab' }, { id: 2, name: 'ac' }]
  const r = rank('a', items, x => x.name)
  assert.deepStrictEqual(r.map(x => x.id), [1, 2])
})

t('rank does not mutate input array', () => {
  const orig = ['b', 'a', 'c']
  const copy = [...orig]
  rank('a', orig)
  assert.deepStrictEqual(orig, copy)
})

t('highlight merges consecutive runs', () => {
  assert.deepStrictEqual(highlight('cpy', 'cart.py'), [[0, 1], [5, 7]])
  assert.deepStrictEqual(highlight('z', 'cart.py'), [])
  assert.deepStrictEqual(highlight('', 'cart.py'), [])
})

t('hostile input handled safely', () => {
  assert.strictEqual(score(null, 'cart.py'), null)
  assert.strictEqual(score('a', null), null)
  assert.deepStrictEqual(rank(null, null), [])
  assert.deepStrictEqual(highlight(null, null), [])
})

console.log('fuzzy tests passed (' + n + ')')
