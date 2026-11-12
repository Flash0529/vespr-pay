import assert from 'node:assert'
import {
  MAX_MENU_ITEMS,
  MAX_LABEL_LEN,
  MAX_ID_LEN,
  DEFAULT_MARGIN,
  normalizeMenuItem,
  createFileMenu,
  createTabMenu,
  createEditorMenu,
  navigateMenu,
  computePopupPosition,
  createMenu
} from '../contextmenu.js'

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
t('exports safe context menu constants', () => {
  assert.strictEqual(MAX_MENU_ITEMS, 50)
  assert.strictEqual(MAX_LABEL_LEN, 100)
  assert.strictEqual(MAX_ID_LEN, 60)
  assert.strictEqual(DEFAULT_MARGIN, 8)
})

// 2. normalizeMenuItem
t('normalizes menu items, separators, and submenus', () => {
  const item = normalizeMenuItem({
    id: '  copy-all  ',
    label: '  Copy All  ',
    shortcut: 'Mod+Shift+C',
    action: () => 'ok'
  })
  assert.strictEqual(item.id, 'copy-all')
  assert.strictEqual(item.label, 'Copy All')
  assert.strictEqual(item.shortcut, 'Mod+Shift+C')
  assert.strictEqual(typeof item.action, 'function')
  assert.strictEqual(item.disabled, false)

  // Separator
  assert.deepStrictEqual(normalizeMenuItem({ separator: true }), { separator: true })

  // Submenu
  const parent = normalizeMenuItem({
    label: 'Share',
    children: [
      { label: 'Copy Link' },
      { separator: true }
    ]
  })
  assert.strictEqual(parent.children.length, 2)
  assert.strictEqual(parent.children[0].label, 'Copy Link')

  // Rejection of invalid inputs
  assert.strictEqual(normalizeMenuItem(null), null)
  assert.strictEqual(normalizeMenuItem(''), null)
  assert.strictEqual(normalizeMenuItem({}), null)
})

// 3. createFileMenu
t('builds file and folder context menu presets', () => {
  const dirMenu = createFileMenu({ isDir: true, canPaste: true })
  assert.ok(dirMenu.some(it => it.id === 'new-file'))
  assert.ok(dirMenu.some(it => it.id === 'new-folder'))
  assert.ok(dirMenu.some(it => it.id === 'paste' && !it.disabled))
  assert.ok(dirMenu.some(it => it.id === 'delete' && it.danger))

  const fileMenu = createFileMenu({ isDir: false })
  assert.ok(!fileMenu.some(it => it.id === 'new-file'))
  assert.ok(!fileMenu.some(it => it.id === 'paste'))
  assert.ok(fileMenu.some(it => it.id === 'rename'))
})

// 4. createTabMenu
t('builds tab context menu presets based on tab position and count', () => {
  // Single pinned tab
  const single = createTabMenu({ isPinned: true, tabCount: 1, index: 0 })
  assert.ok(single.some(it => it.id === 'pin' && it.label === 'Unpin Tab'))
  assert.ok(single.some(it => it.id === 'close-others' && it.disabled))
  assert.ok(single.some(it => it.id === 'close-right' && it.disabled))

  // Middle tab in multi-tab window
  const middle = createTabMenu({ isPinned: false, tabCount: 3, index: 1 })
  assert.ok(middle.some(it => it.id === 'pin' && it.label === 'Pin Tab'))
  assert.ok(middle.some(it => it.id === 'close-others' && !it.disabled))
  assert.ok(middle.some(it => it.id === 'close-right' && !it.disabled))
})

// 5. createEditorMenu
t('builds editor context menu presets respecting selection and read-only', () => {
  // Normal edit with selection
  const selected = createEditorMenu({ hasSelection: true, readOnly: false })
  assert.ok(selected.some(it => it.id === 'cut' && !it.disabled))
  assert.ok(selected.some(it => it.id === 'copy' && !it.disabled))
  assert.ok(selected.some(it => it.id === 'format-document' && !it.disabled))

  // Read-only without selection
  const ro = createEditorMenu({ hasSelection: false, readOnly: true })
  assert.ok(ro.some(it => it.id === 'cut' && it.disabled))
  assert.ok(ro.some(it => it.id === 'copy' && it.disabled))
  assert.ok(ro.some(it => it.id === 'paste' && it.disabled))
  assert.ok(ro.some(it => it.id === 'format-document' && it.disabled))
})

// 6. navigateMenu ArrowDown
t('navigates forward through selectable items, skipping separators and disabled', () => {
  const items = [
    { id: '1', label: 'First' },
    { separator: true },
    { id: '2', label: 'Disabled', disabled: true },
    { id: '3', label: 'Third' }
  ]

  // From beginning (-1) -> index 0
  assert.strictEqual(navigateMenu(items, -1, 'ArrowDown').index, 0)
  // From 0 -> skips separator (1) and disabled (2) -> index 3
  assert.strictEqual(navigateMenu(items, 0, 'ArrowDown').index, 3)
  // From 3 -> wraps back to index 0
  assert.strictEqual(navigateMenu(items, 3, 'ArrowDown').index, 0)
})

// 7. navigateMenu ArrowUp
t('navigates backward through selectable items and wraps around', () => {
  const items = [
    { id: '1', label: 'First' },
    { separator: true },
    { id: '2', label: 'Second' }
  ]

  // From 0 -> wraps to index 2
  assert.strictEqual(navigateMenu(items, 0, 'ArrowUp').index, 2)
  // From 2 -> back to index 0
  assert.strictEqual(navigateMenu(items, 2, 'ArrowUp').index, 0)
})

// 8. navigateMenu Home and End
t('jumps to first and last selectable item on Home and End', () => {
  const items = [
    { separator: true },
    { id: '1', label: 'First' },
    { id: '2', label: 'Middle' },
    { id: '3', label: 'Last' },
    { separator: true }
  ]

  assert.strictEqual(navigateMenu(items, -1, 'Home').index, 1)
  assert.strictEqual(navigateMenu(items, -1, 'End').index, 3)
  assert.strictEqual(navigateMenu([], -1, 'Home'), null)
})

// 9. computePopupPosition normal placement
t('computes standard dropdown popup position below target', () => {
  const target = { x: 100, y: 50, width: 80, height: 30 }
  const popup = { width: 150, height: 200 }
  const viewport = { width: 1000, height: 800 }

  const pos = computePopupPosition(target, popup, viewport)
  assert.strictEqual(pos.x, 100)
  assert.strictEqual(pos.y, 80) // 50 + 30
  assert.strictEqual(pos.placement, 'bottom-start')
})

// 10. computePopupPosition flipping and clamping
t('flips upward when overflowing viewport bottom and clamps within margin', () => {
  // Target near bottom of screen
  const target = { x: 950, y: 700, width: 20, height: 20 }
  const popup = { width: 200, height: 180 }
  const viewport = { width: 1000, height: 750 }

  const pos = computePopupPosition(target, popup, viewport)
  // Should flip upward: ty - ph = 700 - 180 = 520
  assert.strictEqual(pos.y, 520)
  assert.strictEqual(pos.placement, 'top-start')
  // Should clamp X so it fits inside viewport - margin: 1000 - 200 - 8 = 792
  assert.strictEqual(pos.x, 792)
})

// 11. createMenu state and keyboard interaction
t('manages context menu open/close and keyboard interaction state', () => {
  const menu = createMenu()
  assert.strictEqual(menu.isOpen, false)

  menu.show({
    x: 120,
    y: 240,
    items: [
      { id: 'save', label: 'Save' },
      { id: 'close', label: 'Close' }
    ]
  })

  assert.strictEqual(menu.isOpen, true)
  assert.strictEqual(menu.x, 120)
  assert.strictEqual(menu.y, 240)
  assert.strictEqual(menu.items.length, 2)
  assert.strictEqual(menu.selectedIndex, -1)

  // ArrowDown selects first item
  const navDown = menu.handleKey('ArrowDown')
  assert.strictEqual(navDown.action, 'select')
  assert.strictEqual(navDown.index, 0)
  assert.strictEqual(menu.selectedIndex, 0)

  // Enter triggers execution and closes
  const enterRes = menu.handleKey('Enter')
  assert.strictEqual(enterRes.action, 'execute')
  assert.strictEqual(enterRes.item.id, 'save')
  assert.strictEqual(menu.isOpen, false)

  // Re-open and Escape closes
  menu.show({ items: [{ id: 'test', label: 'Test' }] })
  assert.strictEqual(menu.isOpen, true)
  const escRes = menu.handleKey('Escape')
  assert.strictEqual(escRes.action, 'close')
  assert.strictEqual(menu.isOpen, false)
})

// 12. Hostile inputs and prototype safety
t('handles hostile inputs and prototype attacks gracefully', () => {
  assert.strictEqual(createMenu().show(null), false)
  assert.strictEqual(createMenu().show('bad'), false)

  const attack = JSON.parse('{"label": "attack", "__proto__": {"polluted": true}}')
  const norm = normalizeMenuItem(attack)
  assert.strictEqual(Object.prototype.polluted, undefined)

  // Non-finite coords
  const pos = computePopupPosition({ x: NaN, y: Infinity }, { width: null, height: undefined }, null)
  assert.ok(Number.isFinite(pos.x))
  assert.ok(Number.isFinite(pos.y))
})

console.log('contextmenu tests passed (' + n + ')')
