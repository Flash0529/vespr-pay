import assert from 'node:assert'
import {
  MAX_DOC_CHARS,
  MAX_QUERY_LEN,
  MAX_MATCHES,
  escapeRegExp,
  buildRegex,
  findMatches,
  replaceOne,
  replaceAll,
  nextMatch,
  prevMatch,
  formatMatchCount
} from '../search.js'

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

t('constants exist and have expected bounds', () => {
  assert.strictEqual(MAX_DOC_CHARS, 1000000)
  assert.strictEqual(MAX_QUERY_LEN, 500)
  assert.strictEqual(MAX_MATCHES, 1000)
})

t('escapeRegExp escapes special characters', () => {
  const special = '.*+?^${}()|[]\\'
  const escaped = escapeRegExp(special)
  assert.strictEqual(escaped, '\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\')
  assert.strictEqual(escapeRegExp(null), '')
})

t('buildRegex compiles valid regex and handles invalid patterns safely', () => {
  const rx1 = buildRegex('test', { caseSensitive: true })
  assert.ok(rx1 instanceof RegExp)
  assert.strictEqual(rx1.flags, 'g')

  const rx2 = buildRegex('test', { caseSensitive: false })
  assert.strictEqual(rx2.flags, 'gi')

  const rx3 = buildRegex('item', { wholeWord: true })
  assert.ok(rx3.test('an item here'))
  assert.strictEqual(rx3.test('an itemize here'), false)

  // Malformed regex should return null without throwing
  const rxInvalid = buildRegex('[unclosed', { regex: true })
  assert.strictEqual(rxInvalid, null)
})

t('findMatches locates plain text occurrences with line and col coordinates', () => {
  const doc = 'alpha beta\nbeta gamma\nDELTA'
  const matches = findMatches(doc, 'beta')
  assert.strictEqual(matches.length, 2)

  assert.strictEqual(matches[0].index, 6)
  assert.strictEqual(matches[0].line, 1)
  assert.strictEqual(matches[0].col, 7)
  assert.strictEqual(matches[0].length, 4)

  assert.strictEqual(matches[1].index, 11)
  assert.strictEqual(matches[1].line, 2)
  assert.strictEqual(matches[1].col, 1)
})

t('findMatches respects caseSensitive option', () => {
  const doc = 'Apple apple APPLE'
  const caseInsensitive = findMatches(doc, 'apple')
  assert.strictEqual(caseInsensitive.length, 3)

  const caseSensitive = findMatches(doc, 'apple', { caseSensitive: true })
  assert.strictEqual(caseSensitive.length, 1)
  assert.strictEqual(caseSensitive[0].text, 'apple')
})

t('findMatches respects wholeWord option', () => {
  const doc = 'cat catalog bobcat cat'
  const matches = findMatches(doc, 'cat', { wholeWord: true })
  assert.strictEqual(matches.length, 2)
  assert.strictEqual(matches[0].index, 0)
  assert.strictEqual(matches[1].index, 19)
})

t('findMatches supports regular expressions', () => {
  const doc = 'first: 100, second: 250, third: 99'
  const matches = findMatches(doc, '\\d+', { regex: true })
  assert.strictEqual(matches.length, 3)
  assert.strictEqual(matches[0].text, '100')
  assert.strictEqual(matches[1].text, '250')
  assert.strictEqual(matches[2].text, '99')
})

t('replaceOne replaces match at specified range', () => {
  const doc = 'hello world, hello universe'
  const match = { index: 0, length: 5 }
  const res = replaceOne(doc, match, 'greetings')
  assert.strictEqual(res, 'greetings world, hello universe')
})

t('replaceAll replaces all matches and counts occurrences', () => {
  const doc = 'foo bar foo baz foo'
  const res = replaceAll(doc, 'foo', 'qux')
  assert.strictEqual(res.text, 'qux bar qux baz qux')
  assert.strictEqual(res.count, 3)
})

t('replaceAll handles dollar signs in replacement literally', () => {
  const doc = 'price: old'
  const res = replaceAll(doc, 'old', '$100')
  assert.strictEqual(res.text, 'price: $100')
})

t('nextMatch and prevMatch navigate with wrap-around', () => {
  const matches = [
    { index: 10 },
    { index: 50 },
    { index: 100 }
  ]

  assert.strictEqual(nextMatch(matches, 0), 0)
  assert.strictEqual(nextMatch(matches, 10), 1)
  assert.strictEqual(nextMatch(matches, 50), 2)
  assert.strictEqual(nextMatch(matches, 100), 0) // wrap to start

  assert.strictEqual(prevMatch(matches, 150), 2)
  assert.strictEqual(prevMatch(matches, 100), 1)
  assert.strictEqual(prevMatch(matches, 50), 0)
  assert.strictEqual(prevMatch(matches, 10), 2) // wrap to end
})

t('formatMatchCount formats status badge', () => {
  assert.strictEqual(formatMatchCount(0, 5), '1 of 5')
  assert.strictEqual(formatMatchCount(4, 5), '5 of 5')
  assert.strictEqual(formatMatchCount(-1, 5), '0 of 5')
  assert.strictEqual(formatMatchCount(0, 0), 'No results')
  assert.strictEqual(formatMatchCount(null, null), 'No results')
})

t('hostile input immunity for all search functions', () => {
  assert.deepStrictEqual(findMatches(null, null), [])
  assert.deepStrictEqual(findMatches('test', ''), [])
  assert.strictEqual(replaceOne(null, null, null), '')
  assert.deepStrictEqual(replaceAll(null, null, null), { text: '', count: 0 })
  assert.strictEqual(nextMatch(null, 0), -1)
  assert.strictEqual(prevMatch([], 0), -1)
})

console.log('search tests passed (' + n + ')')