import assert from 'node:assert'
import {
  MAX_COMMANDS,
  MAX_QUERY_LEN,
  MAX_TITLE_LEN,
  MAX_CAT_LEN,
  MAX_SHORTCUT_LEN,
  MAX_RESULTS,
  normalizeCommand,
  formatShortcut,
  matchShortcut,
  scoreCommand,
  matchRanges,
  createCommandPalette
} from '../commandpalette.js'

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

// 1. Constants and boundary limits
t('exports expected constants with safe limits', () => {
  assert.strictEqual(MAX_COMMANDS, 500)
  assert.strictEqual(MAX_QUERY_LEN, 100)
  assert.strictEqual(MAX_TITLE_LEN, 120)
  assert.strictEqual(MAX_CAT_LEN, 60)
  assert.strictEqual(MAX_SHORTCUT_LEN, 50)
  assert.strictEqual(MAX_RESULTS, 50)
})

// 2. normalizeCommand
t('normalizes valid commands and sanitizes fields', () => {
  const cmd = normalizeCommand({
    id: '  file.save  ',
    title: '  Save File  ',
    category: '  File  ',
    shortcut: '  Mod+S  ',
    handler: () => 'saved',
    order: 5
  })
  assert.strictEqual(cmd.id, 'file.save')
  assert.strictEqual(cmd.title, 'Save File')
  assert.strictEqual(cmd.category, 'File')
  assert.strictEqual(cmd.shortcut, 'Mod+S')
  assert.strictEqual(typeof cmd.handler, 'function')
  assert.strictEqual(cmd.enabled, true)
  assert.strictEqual(cmd.order, 5)

  // Default category
  const simple = normalizeCommand({ id: 'test', title: 'Test Action' })
  assert.strictEqual(simple.category, 'General')
  assert.strictEqual(simple.enabled, true)
  assert.strictEqual(simple.order, 0)
  assert.strictEqual(simple.shortcut, '')
  assert.strictEqual(simple.handler, null)

  // Rejection of invalid inputs
  assert.strictEqual(normalizeCommand(null), null)
  assert.strictEqual(normalizeCommand('string'), null)
  assert.strictEqual(normalizeCommand([]), null)
  assert.strictEqual(normalizeCommand({ id: '' }), null)
  assert.strictEqual(normalizeCommand({ id: 'valid', title: '' }), null)
})

// 3. formatShortcut
t('formats shortcuts for PC and macOS', () => {
  // PC / Windows / Linux
  assert.strictEqual(formatShortcut('Mod+Shift+P', false), 'Ctrl+Shift+P')
  assert.strictEqual(formatShortcut('Mod+K', false), 'Ctrl+K')
  assert.strictEqual(formatShortcut('Alt+F', false), 'Alt+F')
  assert.strictEqual(formatShortcut('F2', false), 'F2')
  assert.strictEqual(formatShortcut('Escape', false), 'Esc')
  assert.strictEqual(formatShortcut('Enter', false), 'Enter')

  // macOS
  assert.strictEqual(formatShortcut('Mod+Shift+P', true), '⇧⌘P')
  assert.strictEqual(formatShortcut('Mod+K', true), '⌘K')
  assert.strictEqual(formatShortcut('Ctrl+Alt+Shift+Mod+P', true), '⌃⌥⇧⌘P')
  assert.strictEqual(formatShortcut('Enter', true), '↵')
  assert.strictEqual(formatShortcut('Escape', true), 'Esc')
  assert.strictEqual(formatShortcut('Delete', true), 'Del')
  assert.strictEqual(formatShortcut('Backspace', true), '⌫')

  // Invalid inputs
  assert.strictEqual(formatShortcut(null), '')
  assert.strictEqual(formatShortcut(123), '')
  assert.strictEqual(formatShortcut(''), '')
})

// 4. matchShortcut
t('matches keyboard events against shortcut definitions', () => {
  // Mod key on PC (Ctrl) or Mac (Meta)
  assert.strictEqual(matchShortcut({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'k' }, 'Mod+K'), true)
  assert.strictEqual(matchShortcut({ ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, key: 'k' }, 'Mod+K'), true)
  assert.strictEqual(matchShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, key: 'P' }, 'Mod+Shift+P'), true)

  // Reject missing modifier or extra modifier
  assert.strictEqual(matchShortcut({ ctrlKey: false, metaKey: false, shiftKey: true, altKey: false, key: 'P' }, 'Mod+Shift+P'), false)
  assert.strictEqual(matchShortcut({ ctrlKey: true, metaKey: false, shiftKey: true, altKey: true, key: 'P' }, 'Mod+Shift+P'), false)

  // Special keys
  assert.strictEqual(matchShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'Escape' }, 'Escape'), true)
  assert.strictEqual(matchShortcut({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: 'F2' }, 'F2'), true)

  // Invalid event inputs
  assert.strictEqual(matchShortcut(null, 'Mod+K'), false)
  assert.strictEqual(matchShortcut({}, null), false)
})

// 5. scoreCommand
t('fuzzy scores query against command title and category', () => {
  const cmd = { title: 'Toggle Terminal', category: 'View', id: 'view.terminal' }
  const sExact = scoreCommand('Toggle Terminal', cmd)
  const sPartial = scoreCommand('term', cmd)
  const sCategory = scoreCommand('View', cmd)
  const sMismatch = scoreCommand('xyz123', cmd)

  assert.ok(typeof sExact === 'number' && sExact > 100)
  assert.ok(typeof sPartial === 'number' && sPartial > 0)
  assert.ok(typeof sCategory === 'number' && sCategory > 0)
  assert.strictEqual(sMismatch, null)

  // Empty query returns 0
  assert.strictEqual(scoreCommand('', cmd), 0)
  assert.strictEqual(scoreCommand('   ', cmd), 0)
  assert.strictEqual(scoreCommand(null, cmd), null)
})

// 6. matchRanges
t('computes character ranges for query match highlights', () => {
  const ranges = matchRanges('term', 'Toggle Terminal')
  assert.deepStrictEqual(ranges, [[7, 11]])

  const disjoint = matchRanges('tt', 'Toggle Terminal')
  assert.deepStrictEqual(disjoint, [[0, 1], [7, 8]])

  assert.deepStrictEqual(matchRanges('', 'Toggle Terminal'), [])
  assert.deepStrictEqual(matchRanges(null, 'Toggle Terminal'), [])
  assert.deepStrictEqual(matchRanges('xyz', 'Toggle Terminal'), [])
})

// 7. createCommandPalette registration and size
t('registers and retrieves commands safely', () => {
  const palette = createCommandPalette()
  assert.strictEqual(palette.size, 0)

  const ok = palette.register({
    id: 'cmd.test',
    title: 'Test Command',
    category: 'Tools',
    shortcut: 'Mod+T',
    handler: () => 42
  })
  assert.strictEqual(ok, true)
  assert.strictEqual(palette.size, 1)
  assert.strictEqual(palette.has('cmd.test'), true)
  assert.strictEqual(palette.has('nonexistent'), false)

  const retrieved = palette.get('cmd.test')
  assert.strictEqual(retrieved.id, 'cmd.test')
  assert.strictEqual(retrieved.title, 'Test Command')

  // Overwriting updates without growing size
  palette.register({
    id: 'cmd.test',
    title: 'Updated Title',
    category: 'Tools'
  })
  assert.strictEqual(palette.size, 1)
  assert.strictEqual(palette.get('cmd.test').title, 'Updated Title')

  // Unregister
  assert.strictEqual(palette.unregister('cmd.test'), true)
  assert.strictEqual(palette.size, 0)
  assert.strictEqual(palette.unregister('cmd.test'), false)
})

// 8. createCommandPalette with initial items and max bounds
t('accepts initial items and respects MAX_COMMANDS', () => {
  const items = [
    { id: 'c1', title: 'First', order: 2 },
    { id: 'c2', title: 'Second', order: 1 }
  ]
  const palette = createCommandPalette({ items })
  assert.strictEqual(palette.size, 2)

  // Test MAX_COMMANDS capacity check
  const bigPalette = createCommandPalette()
  for (let i = 0; i < MAX_COMMANDS; i++) {
    bigPalette.register({ id: 'cmd_' + i, title: 'Command ' + i })
  }
  assert.strictEqual(bigPalette.size, MAX_COMMANDS)
  // Registering a new command over capacity returns false
  assert.strictEqual(bigPalette.register({ id: 'overflow', title: 'Overflow' }), false)
  assert.strictEqual(bigPalette.size, MAX_COMMANDS)
})

// 9. list and categories
t('lists commands and returns sorted unique categories', () => {
  const palette = createCommandPalette({
    items: [
      { id: 'c1', title: 'Zebra', category: 'Edit', enabled: true },
      { id: 'c2', title: 'Apple', category: 'File', enabled: true },
      { id: 'c3', title: 'Beta', category: 'Edit', enabled: false }
    ]
  })

  const cats = palette.categories()
  assert.deepStrictEqual(cats, ['Edit', 'File'])

  const all = palette.list()
  assert.strictEqual(all.length, 3)

  const enabledOnly = palette.list({ enabledOnly: true })
  assert.strictEqual(enabledOnly.length, 2)

  const editOnly = palette.list({ category: 'Edit' })
  assert.strictEqual(editOnly.length, 2)
})

// 10. query search and ranking
t('searches and ranks commands by fuzzy score', () => {
  const palette = createCommandPalette({
    items: [
      { id: 'file.new', title: 'New File', category: 'File' },
      { id: 'file.open', title: 'Open File', category: 'File' },
      { id: 'view.sidebar', title: 'Toggle Sidebar', category: 'View' },
      { id: 'view.terminal', title: 'Toggle Terminal', category: 'View' },
      { id: 'git.status', title: 'Git: Status', category: 'Git' }
    ]
  })

  // Empty query returns all up to limit
  const emptyRes = palette.query('', { limit: 2 })
  assert.strictEqual(emptyRes.length, 2)
  assert.strictEqual(emptyRes[0].score, 0)

  // Specific query
  const termRes = palette.query('terminal')
  assert.strictEqual(termRes.length, 1)
  assert.strictEqual(termRes[0].command.id, 'view.terminal')
  assert.ok(termRes[0].score > 0)
  assert.deepStrictEqual(termRes[0].matches, [[7, 15]])

  // Category search
  const gitRes = palette.query('git')
  assert.strictEqual(gitRes.length, 1)
  assert.strictEqual(gitRes[0].command.id, 'git.status')
})

// 11. execute / trigger handling
t('safely executes commands and handles errors without throwing', () => {
  let called = false
  const palette = createCommandPalette({
    items: [
      { id: 'run.ok', title: 'Run OK', handler: arg => { called = true; return 'res: ' + arg } },
      { id: 'run.err', title: 'Run Err', handler: () => { throw new Error('boom') } },
      { id: 'run.disabled', title: 'Disabled', enabled: false, handler: () => 'nope' },
      { id: 'run.nohandler', title: 'No Handler' }
    ]
  })

  const resOk = palette.execute('run.ok', 'test')
  assert.strictEqual(called, true)
  assert.strictEqual(resOk.success, true)
  assert.strictEqual(resOk.result, 'res: test')

  // Alias trigger
  const resTrigger = palette.trigger('run.ok', 'again')
  assert.strictEqual(resTrigger.success, true)
  assert.strictEqual(resTrigger.result, 'res: again')

  // Error handling
  const resErr = palette.execute('run.err')
  assert.strictEqual(resErr.success, false)
  assert.strictEqual(resErr.error, 'boom')

  // Disabled command
  const resDis = palette.execute('run.disabled')
  assert.strictEqual(resDis.success, false)
  assert.strictEqual(resDis.error, 'Command is disabled')

  // Missing command
  const resMissing = palette.execute('missing')
  assert.strictEqual(resMissing.success, false)
  assert.strictEqual(resMissing.error, 'Command not found')

  // No handler
  const resNoH = palette.execute('run.nohandler')
  assert.strictEqual(resNoH.success, false)
  assert.strictEqual(resNoH.error, 'Command has no handler')
})

// 12. Hostile inputs and prototype safety
t('handles hostile inputs and prototype attacks gracefully', () => {
  const palette = createCommandPalette()

  // Malformed commands
  assert.strictEqual(palette.register(null), false)
  assert.strictEqual(palette.register(undefined), false)
  assert.strictEqual(palette.register('invalid'), false)
  assert.strictEqual(palette.register({}), false)
  assert.strictEqual(palette.register({ id: '__proto__' }), false)

  // Prototype pollution attempt
  const attack = JSON.parse('{"id": "pollute", "title": "Attack", "__proto__": {"polluted": true}}')
  palette.register(attack)
  assert.strictEqual(Object.prototype.polluted, undefined)

  // Huge inputs
  const hugeId = 'a'.repeat(20000)
  const hugeQuery = 'b'.repeat(20000)
  palette.register({ id: hugeId, title: 'Huge' })
  assert.ok(palette.has(hugeId.slice(0, MAX_TITLE_LEN)))

  const hugeRes = palette.query(hugeQuery)
  assert.deepStrictEqual(hugeRes, [])

  // Invalid query params
  assert.ok(Array.isArray(palette.query(null, { limit: -5 })))
  assert.ok(Array.isArray(palette.query(undefined, { limit: NaN })))
})

console.log('commandpalette tests passed (' + n + ')')
