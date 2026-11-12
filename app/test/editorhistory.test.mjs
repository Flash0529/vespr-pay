import assert from 'node:assert'
import {
  MAX_HISTORY_DEPTH,
  DEFAULT_DEBOUNCE_MS,
  MAX_TEXT_LEN,
  createHistory
} from '../editorhistory.js'

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

// 1. Constants
t('exports safe history constants', () => {
  assert.strictEqual(MAX_HISTORY_DEPTH, 200)
  assert.strictEqual(DEFAULT_DEBOUNCE_MS, 500)
  assert.strictEqual(MAX_TEXT_LEN, 500000)
})

// 2. Initialization
t('initializes buffer history with initial text and cursor', () => {
  const h = createHistory({
    initialText: 'const x = 1',
    initialCursor: { line: 1, col: 12 }
  })
  assert.strictEqual(h.size, 1)
  assert.strictEqual(h.canUndo, false)
  assert.strictEqual(h.canRedo, false)
  assert.strictEqual(h.isDirty(), false)

  const cur = h.current()
  assert.strictEqual(cur.text, 'const x = 1')
  assert.deepStrictEqual(cur.cursor, { line: 1, col: 12 })
})

// 3. Discrete edits and undo/redo
t('handles distinct edits and undo/redo step traversal', () => {
  const h = createHistory({ initialText: 'a' })

  h.push('b', { line: 1, col: 2 }, { origin: 'paste' })
  h.push('c', { line: 1, col: 2 }, { origin: 'paste' })

  assert.strictEqual(h.size, 3)
  assert.strictEqual(h.canUndo, true)
  assert.strictEqual(h.canRedo, false)
  assert.strictEqual(h.current().text, 'c')

  // Undo to 'b'
  const u1 = h.undo()
  assert.strictEqual(u1.text, 'b')
  assert.strictEqual(u1.canUndo, true)
  assert.strictEqual(u1.canRedo, true)

  // Undo to 'a'
  const u2 = h.undo()
  assert.strictEqual(u2.text, 'a')
  assert.strictEqual(u2.canUndo, false)
  assert.strictEqual(u2.canRedo, true)

  // Cannot undo past beginning
  assert.strictEqual(h.undo(), null)

  // Redo to 'b'
  const r1 = h.redo()
  assert.strictEqual(r1.text, 'b')
  assert.strictEqual(r1.canUndo, true)
  assert.strictEqual(r1.canRedo, true)

  // Redo to 'c'
  const r2 = h.redo()
  assert.strictEqual(r2.text, 'c')
  assert.strictEqual(r2.canUndo, true)
  assert.strictEqual(r2.canRedo, false)

  // Cannot redo past end
  assert.strictEqual(h.redo(), null)
})

// 4. Redo truncation
t('truncates redo history when new edits occur from intermediate state', () => {
  const h = createHistory({ initialText: 'step1' })
  h.push('step2', null, { origin: 'paste' })
  h.push('step3', null, { origin: 'paste' })

  h.undo() // back to step2
  assert.strictEqual(h.current().text, 'step2')
  assert.strictEqual(h.canRedo, true)

  // Branch off with step4
  h.push('step4', null, { origin: 'paste' })
  assert.strictEqual(h.current().text, 'step4')
  assert.strictEqual(h.canRedo, false)
  assert.strictEqual(h.size, 3) // step1, step2, step4

  h.undo()
  assert.strictEqual(h.current().text, 'step2')
})

// 5. Typing coalescing
t('coalesces rapid single-character typing within debounce window', () => {
  let clock = 1000
  const h = createHistory({
    initialText: '',
    debounceMs: 500
  })

  // First keystroke
  h.push('h', { line: 1, col: 2 }, { origin: 'type', now: () => clock })
  assert.strictEqual(h.size, 2)

  // Second keystroke 100ms later -> coalesces into same entry!
  clock += 100
  h.push('he', { line: 1, col: 3 }, { origin: 'type', now: () => clock })
  assert.strictEqual(h.size, 2)

  // Third keystroke 100ms later -> coalesces into same entry!
  clock += 100
  h.push('hel', { line: 1, col: 4 }, { origin: 'type', now: () => clock })
  assert.strictEqual(h.size, 2)
  assert.strictEqual(h.current().text, 'hel')

  // Undoing once reverts back to ''
  h.undo()
  assert.strictEqual(h.current().text, '')
})

// 6. Typing boundaries on pause or forceBoundary
t('creates separate history entry when typing pauses or forceBoundary is set', () => {
  let clock = 1000
  const h = createHistory({
    initialText: '',
    debounceMs: 300
  })

  h.push('a', null, { origin: 'type', now: () => clock })
  assert.strictEqual(h.size, 2)

  // Wait 400ms (exceeds debounceMs 300)
  clock += 400
  h.push('ab', null, { origin: 'type', now: () => clock })
  assert.strictEqual(h.size, 3) // distinct entry!

  // Force boundary
  clock += 50
  h.push('abc', null, { origin: 'type', now: () => clock, forceBoundary: true })
  assert.strictEqual(h.size, 4)
})

// 7. Dirty tracking and setSaved
t('tracks dirty state accurately through edits and undo/redo', () => {
  const h = createHistory({ initialText: 'clean' })
  assert.strictEqual(h.isDirty(), false)

  h.push('dirty', null, { origin: 'paste' })
  assert.strictEqual(h.isDirty(), true)

  // Set saved at 'dirty'
  h.setSaved()
  assert.strictEqual(h.isDirty(), false)

  // Undo back to 'clean' -> now dirty compared to saved!
  h.undo()
  assert.strictEqual(h.isDirty(), true)

  // Redo back to 'dirty' -> clean again!
  h.redo()
  assert.strictEqual(h.isDirty(), false)
})

// 8. Max depth capacity enforcement
t('enforces maxDepth limit by shifting oldest entries', () => {
  const h = createHistory({
    initialText: '0',
    maxDepth: 3
  })

  h.push('1', null, { origin: 'paste' })
  h.push('2', null, { origin: 'paste' })
  assert.strictEqual(h.size, 3)

  // Exceeds max depth 3 -> drops '0', keeps '1', '2', '3'
  h.push('3', null, { origin: 'paste' })
  assert.strictEqual(h.size, 3)
  assert.strictEqual(h.current().text, '3')

  h.undo()
  assert.strictEqual(h.current().text, '2')
  h.undo()
  assert.strictEqual(h.current().text, '1')
  // Cannot undo to '0' because it was dropped
  assert.strictEqual(h.canUndo, false)
})

// 9. Clear method
t('clears history and resets to new initial state', () => {
  const h = createHistory({ initialText: 'old' })
  h.push('newer', null, { origin: 'paste' })
  assert.strictEqual(h.size, 2)

  h.clear('fresh', { line: 5, col: 1 })
  assert.strictEqual(h.size, 1)
  assert.strictEqual(h.canUndo, false)
  assert.strictEqual(h.canRedo, false)
  assert.strictEqual(h.isDirty(), false)
  assert.strictEqual(h.current().text, 'fresh')
  assert.deepStrictEqual(h.current().cursor, { line: 5, col: 1 })
})

// 10. Numeric cursor offsets
t('supports numeric offset cursors', () => {
  const h = createHistory({
    initialText: 'hello',
    initialCursor: 5
  })
  assert.strictEqual(h.current().cursor, 5)

  h.push('hello world', 11, { origin: 'paste' })
  assert.strictEqual(h.current().cursor, 11)

  h.undo()
  assert.strictEqual(h.current().cursor, 5)
})

// 11. No-op duplicate push rejection
t('rejects pushing identical text and cursor without state change', () => {
  const h = createHistory({ initialText: 'same' })
  assert.strictEqual(h.push('same', { line: 1, col: 1 }), false)
  assert.strictEqual(h.size, 1)
})

// 12. Hostile inputs and bounds
t('handles bad types, huge strings, and negative values safely', () => {
  const h = createHistory()

  assert.strictEqual(h.push(null), false)
  assert.strictEqual(h.push(undefined), false)
  assert.strictEqual(h.push(12345), false)

  // Huge string clamped to MAX_TEXT_LEN
  const huge = 'x'.repeat(MAX_TEXT_LEN + 500)
  h.push(huge, null, { origin: 'paste' })
  assert.strictEqual(h.current().text.length, MAX_TEXT_LEN)

  // Malformed cursor
  h.push('valid', { line: -10, col: NaN }, { origin: 'paste' })
  assert.deepStrictEqual(h.current().cursor, { line: 1, col: 1 })
})

console.log('editorhistory tests passed (' + n + ')')
