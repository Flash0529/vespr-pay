import assert from 'node:assert'
import {
  MAX_LINES,
  MAX_LINE_LEN,
  MAX_DIFF_BYTES,
  splitLines,
  diffLines,
  summary,
  formatBadge,
  parsePatch,
  formatUnified
} from '../diffs.js'

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
  assert.strictEqual(MAX_LINES, 1000)
  assert.strictEqual(MAX_LINE_LEN, 1000)
  assert.strictEqual(MAX_DIFF_BYTES, 500000)
})

t('splitLines normalizes line endings and handles null bytes', () => {
  const text = 'line 1\r\nline 2\rline 3\nline \u00004'
  const lines = splitLines(text)
  assert.strictEqual(lines.length, 4)
  assert.strictEqual(lines[0], 'line 1')
  assert.strictEqual(lines[1], 'line 2')
  assert.strictEqual(lines[2], 'line 3')
  assert.strictEqual(lines[3], 'line 4')
})

t('diffLines returns eq operations for identical text', () => {
  const text = 'alpha\nbeta\ngamma'
  const diff = diffLines(text, text)
  assert.strictEqual(diff.length, 3)
  assert.ok(diff.every(d => d.type === 'eq'))
  assert.strictEqual(diff[0].oldLine, 1)
  assert.strictEqual(diff[0].newLine, 1)
  assert.strictEqual(diff[2].oldLine, 3)
  assert.strictEqual(diff[2].newLine, 3)
})

t('diffLines detects additions and deletions accurately', () => {
  const oldText = 'def total():\n    return 0\n'
  const newText = 'def total():\n    # calculate price\n    return 100\n'

  const diff = diffLines(oldText, newText)
  const s = summary(diff)
  assert.strictEqual(s.additions, 2)
  assert.strictEqual(s.deletions, 1)
})

t('diffLines tracks correct 1-based line numbers', () => {
  const oldText = 'a\nb\nc'
  const newText = 'a\nx\nc'

  const diff = diffLines(oldText, newText)
  assert.strictEqual(diff.length, 4)
  assert.deepStrictEqual(diff[0], { type: 'eq', text: 'a', oldLine: 1, newLine: 1 })
  assert.deepStrictEqual(diff[1], { type: 'del', text: 'b', oldLine: 2 })
  assert.deepStrictEqual(diff[2], { type: 'add', text: 'x', newLine: 2 })
  assert.deepStrictEqual(diff[3], { type: 'eq', text: 'c', oldLine: 3, newLine: 3 })
})

t('summary calculates counts from diff items and patch objects', () => {
  const items = [
    { type: 'eq' },
    { type: 'add' },
    { type: 'add' },
    { type: 'del' }
  ]
  const s = summary(items)
  assert.strictEqual(s.additions, 2)
  assert.strictEqual(s.deletions, 1)
  assert.strictEqual(s.unchanged, 1)
  assert.strictEqual(s.total, 4)
})

t('formatBadge formats diff statistics with unicode minus', () => {
  assert.strictEqual(formatBadge({ additions: 12, deletions: 3 }), '+12 \u22123')
  assert.strictEqual(formatBadge({ additions: 5, deletions: 0 }), '+5')
  assert.strictEqual(formatBadge({ additions: 0, deletions: 4 }), '\u22124')
  assert.strictEqual(formatBadge({ additions: 0, deletions: 0 }), '0')
  assert.strictEqual(formatBadge(null), '0')
})

t('parsePatch parses standard unified patch format', () => {
  const patch = `--- a/cart.py
+++ b/cart.py
@@ -1,3 +1,4 @@
 def total():
-    return 0
+    # comment
+    return 10
`
  const parsed = parsePatch(patch)
  assert.strictEqual(parsed.hunks.length, 1)
  assert.strictEqual(parsed.hunks[0].oldStart, 1)
  assert.strictEqual(parsed.hunks[0].newStart, 1)
  assert.strictEqual(parsed.summary.additions, 2)
  assert.strictEqual(parsed.summary.deletions, 1)
})

t('parsePatch handles simple +/- diff logs without hunk headers', () => {
  const simpleDiff = '- Murmio\n+ VESPR\n+ Shared workspace'
  const parsed = parsePatch(simpleDiff)
  assert.strictEqual(parsed.summary.additions, 2)
  assert.strictEqual(parsed.summary.deletions, 1)
})

t('formatUnified produces valid unified diff string', () => {
  const oldText = 'line1\nline2'
  const newText = 'line1\nline2_modified'
  const uni = formatUnified('test.py', oldText, newText)
  assert.ok(uni.includes('--- a/test.py'))
  assert.ok(uni.includes('+++ b/test.py'))
  assert.ok(uni.includes('@@ -1,2 +1,2 @@'))
  assert.ok(uni.includes('-line2'))
  assert.ok(uni.includes('+line2_modified'))
})

t('formatUnified returns empty string if no changes', () => {
  const text = 'unchanged\nlines'
  assert.strictEqual(formatUnified('test.py', text, text), '')
})

t('hostile input immunity for all diff functions', () => {
  assert.deepStrictEqual(splitLines(null), [])
  assert.deepStrictEqual(splitLines(undefined), [])
  assert.deepStrictEqual(splitLines(123), [])
  assert.deepStrictEqual(diffLines(null, undefined), [])
  assert.deepStrictEqual(summary(null), { additions: 0, deletions: 0, unchanged: 0, total: 0 })
  assert.strictEqual(formatBadge({ additions: 'bad', deletions: null }), '0')
  assert.deepStrictEqual(parsePatch(null).summary, { additions: 0, deletions: 0, total: 0 })
  assert.strictEqual(formatUnified(null, null, null), '')
})

console.log('diffs tests passed (' + n + ')')