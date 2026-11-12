import assert from 'node:assert'
import {
  MAX_DOC_CHARS,
  MAX_LINES,
  DEFAULT_INDENT,
  lineCount,
  clampLine,
  offsetToPos,
  posToOffset,
  formatPosition,
  detectIndentation,
  wordAt,
  normalizeSelection
} from '../cursor.js'

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
  assert.strictEqual(MAX_LINES, 50000)
  assert.strictEqual(DEFAULT_INDENT.type, 'spaces')
  assert.strictEqual(DEFAULT_INDENT.width, 4)
})

t('lineCount counts lines accurately', () => {
  assert.strictEqual(lineCount(''), 0)
  assert.strictEqual(lineCount('single line'), 1)
  assert.strictEqual(lineCount('line 1\nline 2\nline 3'), 3)
  assert.strictEqual(lineCount('trailing\n'), 2)
  assert.strictEqual(lineCount(null), 0)
})

t('clampLine clamps target line within valid line bounds', () => {
  assert.strictEqual(clampLine(5, 10), 5)
  assert.strictEqual(clampLine(0, 10), 1)
  assert.strictEqual(clampLine(-3, 10), 1)
  assert.strictEqual(clampLine(15, 10), 10)
  assert.strictEqual(clampLine(null, 10), 1)
})

t('offsetToPos maps character offsets to 1-based line and col', () => {
  const text = 'def total():\n    return 42'
  assert.deepStrictEqual(offsetToPos(text, 0), { line: 1, col: 1 })
  assert.deepStrictEqual(offsetToPos(text, 3), { line: 1, col: 4 })
  assert.deepStrictEqual(offsetToPos(text, 12), { line: 1, col: 13 })
  assert.deepStrictEqual(offsetToPos(text, 13), { line: 2, col: 1 })
  assert.deepStrictEqual(offsetToPos(text, 17), { line: 2, col: 5 })
})

t('posToOffset maps line and col back to character offset (round-trip)', () => {
  const text = 'def total():\n    return 42\n'
  const offset1 = posToOffset(text, { line: 1, col: 1 })
  assert.strictEqual(offset1, 0)

  const offset2 = posToOffset(text, { line: 2, col: 5 })
  assert.strictEqual(offset2, 17)
  assert.deepStrictEqual(offsetToPos(text, offset2), { line: 2, col: 5 })
})

t('posToOffset clamps column to end of line if exceeded', () => {
  const text = 'short\nline'
  const offset = posToOffset(text, { line: 1, col: 999 })
  assert.strictEqual(offset, 5)
})

t('formatPosition formats status bar indicator correctly', () => {
  assert.strictEqual(formatPosition({ line: 8, col: 41 }), 'Ln 8, Col 41')
  assert.strictEqual(formatPosition({ line: 8, col: 41, selectedChars: 12 }), 'Ln 8, Col 41 (12 selected)')
  assert.strictEqual(formatPosition({ line: 8, col: 41, selectedChars: 45, selectedLines: 3 }), 'Ln 8, Col 41 (3 lines selected)')
  assert.strictEqual(formatPosition(null), 'Ln 1, Col 1')
})

t('detectIndentation identifies 4-space indentation', () => {
  const pyCode = 'def total(items):\n    result = 0\n    for x in items:\n        result += x\n    return result'
  const ind = detectIndentation(pyCode)
  assert.strictEqual(ind.type, 'spaces')
  assert.strictEqual(ind.width, 4)
  assert.strictEqual(ind.label, 'Spaces: 4')
})

t('detectIndentation identifies 2-space indentation', () => {
  const jsCode = 'function total(items) {\n  let res = 0\n  for (const x of items) {\n    res += x\n  }\n  return res\n}'
  const ind = detectIndentation(jsCode)
  assert.strictEqual(ind.type, 'spaces')
  assert.strictEqual(ind.width, 2)
  assert.strictEqual(ind.label, 'Spaces: 2')
})

t('detectIndentation identifies tab indentation', () => {
  const goCode = 'func main() {\n\tfmt.Println("hello")\n}'
  const ind = detectIndentation(goCode)
  assert.strictEqual(ind.type, 'tabs')
  assert.strictEqual(ind.label, 'Tabs')
})

t('wordAt finds identifier under cursor or adjacent to it', () => {
  const text = 'const totalItems = calculate(cart)'
  // Inside 'totalItems'
  const w1 = wordAt(text, 8)
  assert.strictEqual(w1.word, 'totalItems')
  assert.strictEqual(w1.from, 6)
  assert.strictEqual(w1.to, 16)

  // End of 'calculate'
  const w2 = wordAt(text, 27)
  assert.strictEqual(w2.word, 'calculate')

  // On whitespace
  const w3 = wordAt(text, 5)
  assert.strictEqual(w3.word, '')
})

t('normalizeSelection orders anchor and head into from and to', () => {
  const fwd = normalizeSelection(10, 25)
  assert.strictEqual(fwd.from, 10)
  assert.strictEqual(fwd.to, 25)
  assert.strictEqual(fwd.isReversed, false)
  assert.strictEqual(fwd.length, 15)

  const rev = normalizeSelection(25, 10)
  assert.strictEqual(rev.from, 10)
  assert.strictEqual(rev.to, 25)
  assert.strictEqual(rev.isReversed, true)
  assert.strictEqual(rev.length, 15)
})

t('hostile input immunity for all cursor functions', () => {
  assert.deepStrictEqual(offsetToPos(null, -10), { line: 1, col: 1 })
  assert.deepStrictEqual(offsetToPos('abc', 999), { line: 1, col: 4 })
  assert.strictEqual(posToOffset(null, null), 0)
  assert.strictEqual(formatPosition({ line: -5, col: 'invalid' }), 'Ln 1, Col 1')
  assert.deepStrictEqual(detectIndentation(null), DEFAULT_INDENT)
  assert.deepStrictEqual(wordAt(null, 10), { word: '', from: 0, to: 0 })
  assert.deepStrictEqual(normalizeSelection(null, 'bad'), { from: 0, to: 0, isReversed: false, length: 0 })
})

console.log('cursor tests passed (' + n + ')')