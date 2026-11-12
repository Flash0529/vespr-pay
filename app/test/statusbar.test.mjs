import assert from 'node:assert'
import {
  MAX_STATUS_ITEMS,
  MAX_ID_LEN,
  MAX_TEXT_LEN,
  MAX_TOOLTIP_LEN,
  MAX_MESSAGE_LEN,
  DEFAULT_MESSAGE_TIMEOUT,
  formatCursor,
  formatProblems,
  formatGit,
  formatIndent,
  formatEncoding,
  createStatusBar
} from '../statusbar.js'

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
t('exports safe status bar constants', () => {
  assert.strictEqual(MAX_STATUS_ITEMS, 50)
  assert.strictEqual(MAX_ID_LEN, 60)
  assert.strictEqual(MAX_TEXT_LEN, 120)
  assert.strictEqual(MAX_TOOLTIP_LEN, 200)
  assert.strictEqual(MAX_MESSAGE_LEN, 250)
  assert.strictEqual(DEFAULT_MESSAGE_TIMEOUT, 5000)
})

// 2. formatCursor
t('formats cursor line and column coordinates', () => {
  assert.strictEqual(formatCursor(1, 1), 'Ln 1, Col 1')
  assert.strictEqual(formatCursor(42, 10), 'Ln 42, Col 10')
  assert.strictEqual(formatCursor(10, 5, 25), 'Ln 10, Col 5 (25 selected)')
  assert.strictEqual(formatCursor(10, 5, 1), 'Ln 10, Col 5 (1 selected)')
  assert.strictEqual(formatCursor(-5, 0), 'Ln 1, Col 1')
  assert.strictEqual(formatCursor(null, undefined), 'Ln 1, Col 1')
})

// 3. formatProblems
t('formats problems diagnostics badges', () => {
  assert.strictEqual(formatProblems(0, 0), '0 Problems')
  assert.strictEqual(formatProblems(3, 0), '✕ 3')
  assert.strictEqual(formatProblems(0, 5), '⚠ 5')
  assert.strictEqual(formatProblems(2, 4), '✕ 2  ⚠ 4')
  assert.strictEqual(formatProblems(-1, null), '0 Problems')
})

// 4. formatGit
t('formats git branch and sync indicators', () => {
  assert.strictEqual(formatGit('main'), 'main')
  assert.strictEqual(formatGit('main', 1, 0), 'main 1↑')
  assert.strictEqual(formatGit('main', 0, 2), 'main 2↓')
  assert.strictEqual(formatGit('feat/auth', 3, 2), 'feat/auth 2↓ 3↑')
  assert.strictEqual(formatGit('1a2b3c4', 0, 0, true), 'HEAD detached at 1a2b3c4')
  assert.strictEqual(formatGit(''), '')
  assert.strictEqual(formatGit(null), '')
})

// 5. formatIndent
t('formats indentation mode and width', () => {
  assert.strictEqual(formatIndent('spaces', 2), 'Spaces: 2')
  assert.strictEqual(formatIndent('spaces', 4), 'Spaces: 4')
  assert.strictEqual(formatIndent('tabs', 4), 'Tabs: 4')
  assert.strictEqual(formatIndent('tab', 8), 'Tabs: 8')
  assert.strictEqual(formatIndent(null), 'Spaces: 2')
})

// 6. formatEncoding
t('formats encoding and line ending convention', () => {
  assert.strictEqual(formatEncoding('utf-8', '\n'), 'UTF-8  LF')
  assert.strictEqual(formatEncoding('utf-8', '\r\n'), 'UTF-8  CRLF')
  assert.strictEqual(formatEncoding('ascii', 'CRLF'), 'ASCII  CRLF')
  assert.strictEqual(formatEncoding(null, null), 'UTF-8  LF')
})

// 7. createStatusBar basic operations
t('registers, retrieves, and removes status bar items', () => {
  const bar = createStatusBar()
  assert.strictEqual(bar.size, 0)

  const ok = bar.set('cursor', {
    text: 'Ln 1, Col 1',
    side: 'right',
    priority: 100
  })
  assert.strictEqual(ok, true)
  assert.strictEqual(bar.size, 1)
  assert.strictEqual(bar.has('cursor'), true)
  assert.strictEqual(bar.has('missing'), false)

  const item = bar.get('cursor')
  assert.strictEqual(item.id, 'cursor')
  assert.strictEqual(item.text, 'Ln 1, Col 1')
  assert.strictEqual(item.side, 'right')
  assert.strictEqual(item.priority, 100)

  assert.strictEqual(bar.remove('cursor'), true)
  assert.strictEqual(bar.size, 0)
  assert.strictEqual(bar.remove('cursor'), false)
})

// 8. list alignment and priority sorting
t('sorts items by priority descending within each side', () => {
  const bar = createStatusBar()
  bar.set('branch', { text: 'main', side: 'left', priority: 50 })
  bar.set('problems', { text: '0 Problems', side: 'left', priority: 100 })
  bar.set('encoding', { text: 'UTF-8', side: 'right', priority: 10 })
  bar.set('cursor', { text: 'Ln 1, Col 1', side: 'right', priority: 80 })

  const left = bar.list('left')
  assert.strictEqual(left.length, 2)
  assert.strictEqual(left[0].id, 'problems') // priority 100 first
  assert.strictEqual(left[1].id, 'branch')   // priority 50 second

  const right = bar.list('right')
  assert.strictEqual(right.length, 2)
  assert.strictEqual(right[0].id, 'cursor')   // priority 80 first
  assert.strictEqual(right[1].id, 'encoding') // priority 10 second

  const all = bar.list()
  assert.strictEqual(all.left.length, 2)
  assert.strictEqual(all.right.length, 2)
})

// 9. show and hide
t('toggles item visibility and hides from list', () => {
  const bar = createStatusBar()
  bar.set('spinner', { text: 'Syncing...', visible: false })
  assert.strictEqual(bar.list('left').length, 0)

  assert.strictEqual(bar.show('spinner'), true)
  assert.strictEqual(bar.list('left').length, 1)

  assert.strictEqual(bar.hide('spinner'), true)
  assert.strictEqual(bar.list('left').length, 0)
  assert.strictEqual(bar.show('nonexistent'), false)
})

// 10. ephemeral messages
t('manages ephemeral status messages with expiration clock', () => {
  const bar = createStatusBar()
  let clock = 1000

  assert.strictEqual(bar.getMessage({ now: () => clock }), null)

  bar.setMessage('File saved', { timeout: 2000, now: () => clock })
  assert.strictEqual(bar.getMessage({ now: () => clock }), 'File saved')

  // Advance clock before expiration
  clock += 1500
  assert.strictEqual(bar.getMessage({ now: () => clock }), 'File saved')

  // Advance clock past expiration
  clock += 600
  assert.strictEqual(bar.getMessage({ now: () => clock }), null)

  // Clear message manually
  bar.setMessage('Processing...', { timeout: 5000, now: () => clock })
  bar.clearMessage()
  assert.strictEqual(bar.getMessage({ now: () => clock }), null)
})

// 11. capacity check
t('enforces MAX_STATUS_ITEMS capacity', () => {
  const bar = createStatusBar()
  for (let i = 0; i < MAX_STATUS_ITEMS; i++) {
    bar.set('item_' + i, { text: 'Text ' + i })
  }
  assert.strictEqual(bar.size, MAX_STATUS_ITEMS)
  // New item beyond max returns false
  assert.strictEqual(bar.set('overflow', { text: 'Overflow' }), false)
  assert.strictEqual(bar.size, MAX_STATUS_ITEMS)
  // Existing item can still be updated
  assert.strictEqual(bar.set('item_0', { text: 'Updated' }), true)
  assert.strictEqual(bar.size, MAX_STATUS_ITEMS)
})

// 12. hostile inputs and prototype safety
t('handles hostile inputs, bad types, and prototype pollution safely', () => {
  const bar = createStatusBar()

  assert.strictEqual(bar.set(null, {}), false)
  assert.strictEqual(bar.set('', {}), false)
  assert.strictEqual(bar.set('bad', null), false)
  assert.strictEqual(bar.set('bad', 'not-object'), false)
  assert.strictEqual(bar.set('__proto__', { text: 'attack' }), false)

  const protoAttack = JSON.parse('{"text": "safe", "__proto__": {"polluted": true}}')
  bar.set('safe', protoAttack)
  assert.strictEqual(Object.prototype.polluted, undefined)

  // Huge text clamped
  const huge = 'a'.repeat(5000)
  bar.set('huge', { text: huge, tooltip: huge })
  const saved = bar.get('huge')
  assert.strictEqual(saved.text.length, MAX_TEXT_LEN)
  assert.strictEqual(saved.tooltip.length, MAX_TOOLTIP_LEN)
})

console.log('statusbar tests passed (' + n + ')')
