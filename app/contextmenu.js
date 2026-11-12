// Context menu data model, presets, keyboard navigation, and viewport positioning. Pure ES module.
export const MAX_MENU_ITEMS = 50
export const MAX_LABEL_LEN = 100
export const MAX_ID_LEN = 60
export const DEFAULT_MARGIN = 8

// Normalizes a raw context menu item definition.
export function normalizeMenuItem (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.separator) return { separator: true }

  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, MAX_ID_LEN) : ''
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, MAX_LABEL_LEN) : ''
  if (!label && !id) return null

  const icon = typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 30) : ''
  const shortcut = typeof raw.shortcut === 'string' ? raw.shortcut.trim().slice(0, 30) : ''
  const disabled = !!raw.disabled
  const danger = !!raw.danger
  const action = typeof raw.action === 'function' ? raw.action : (typeof raw.action === 'string' ? raw.action.slice(0, MAX_ID_LEN) : null)

  const item = {
    id: id || label.toLowerCase().replace(/\s+/g, '-'),
    label: label || id,
    icon,
    shortcut,
    disabled,
    danger,
    action
  }

  if (Array.isArray(raw.children) && raw.children.length > 0) {
    const validChildren = []
    for (const child of raw.children) {
      const normalizedChild = normalizeMenuItem(child)
      if (normalizedChild) validChildren.push(normalizedChild)
    }
    if (validChildren.length > 0) {
      item.children = validChildren.slice(0, MAX_MENU_ITEMS)
    }
  }

  return item
}

// Builds standard file explorer context menu items.
export function createFileMenu (options = {}) {
  const isDir = !!options.isDir
  const canPaste = !!options.canPaste

  const items = []
  if (isDir) {
    items.push(
      { id: 'new-file', label: 'New File', icon: 'file' },
      { id: 'new-folder', label: 'New Folder', icon: 'folder' },
      { separator: true }
    )
  }

  items.push(
    { id: 'cut', label: 'Cut', shortcut: 'Mod+X' },
    { id: 'copy', label: 'Copy', shortcut: 'Mod+C' }
  )

  if (isDir) {
    items.push({ id: 'paste', label: 'Paste', shortcut: 'Mod+V', disabled: !canPaste })
  }

  items.push(
    { separator: true },
    { id: 'copy-path', label: 'Copy Path' },
    { id: 'copy-relative-path', label: 'Copy Relative Path' },
    { separator: true },
    { id: 'rename', label: 'Rename', shortcut: 'F2' },
    { id: 'delete', label: 'Delete', shortcut: 'Delete', danger: true }
  )

  return items.map(normalizeMenuItem).filter(Boolean)
}

// Builds standard editor tab context menu items.
export function createTabMenu (options = {}) {
  const isPinned = !!options.isPinned
  const tabCount = typeof options.tabCount === 'number' && Number.isFinite(options.tabCount) ? Math.floor(options.tabCount) : 1
  const index = typeof options.index === 'number' && Number.isFinite(options.index) ? Math.floor(options.index) : 0

  const hasMultiple = tabCount > 1
  const hasTabsToRight = index < tabCount - 1

  const items = [
    { id: 'close', label: 'Close', shortcut: 'Mod+W' },
    { id: 'close-others', label: 'Close Others', disabled: !hasMultiple },
    { id: 'close-right', label: 'Close to the Right', disabled: !hasTabsToRight },
    { id: 'close-saved', label: 'Close Saved', disabled: !hasMultiple },
    { separator: true },
    { id: 'pin', label: isPinned ? 'Unpin Tab' : 'Pin Tab' },
    { separator: true },
    { id: 'copy-path', label: 'Copy Path' }
  ]

  return items.map(normalizeMenuItem).filter(Boolean)
}

// Builds standard editor text area context menu items.
export function createEditorMenu (options = {}) {
  const hasSelection = !!options.hasSelection
  const readOnly = !!options.readOnly

  const items = [
    { id: 'cut', label: 'Cut', shortcut: 'Mod+X', disabled: readOnly || !hasSelection },
    { id: 'copy', label: 'Copy', shortcut: 'Mod+C', disabled: !hasSelection },
    { id: 'paste', label: 'Paste', shortcut: 'Mod+V', disabled: readOnly },
    { separator: true },
    { id: 'select-all', label: 'Select All', shortcut: 'Mod+A' },
    { id: 'format-document', label: 'Format Document', shortcut: 'Shift+Alt+F', disabled: readOnly }
  ]

  return items.map(normalizeMenuItem).filter(Boolean)
}

// Navigates selectable items via keyboard (ArrowDown, ArrowUp, Home, End).
export function navigateMenu (items, currentIndex, key) {
  if (!Array.isArray(items) || items.length === 0) return null

  const selectableIndices = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item && !item.separator && !item.disabled) {
      selectableIndices.push(i)
    }
  }

  if (selectableIndices.length === 0) return null

  if (key === 'Home') {
    const idx = selectableIndices[0]
    return { index: idx, item: items[idx] }
  }

  if (key === 'End') {
    const idx = selectableIndices[selectableIndices.length - 1]
    return { index: idx, item: items[idx] }
  }

  const curPos = selectableIndices.indexOf(currentIndex)

  if (key === 'ArrowDown') {
    const nextPos = curPos === -1 || curPos >= selectableIndices.length - 1 ? 0 : curPos + 1
    const idx = selectableIndices[nextPos]
    return { index: idx, item: items[idx] }
  }

  if (key === 'ArrowUp') {
    const prevPos = curPos <= 0 ? selectableIndices.length - 1 : curPos - 1
    const idx = selectableIndices[prevPos]
    return { index: idx, item: items[idx] }
  }

  return null
}

// Computes viewport-constrained popup menu positioning with flip fallback.
export function computePopupPosition (target, popup, viewport, options = {}) {
  const t = target && typeof target === 'object' ? target : { x: 0, y: 0, width: 0, height: 0 }
  const tx = typeof t.x === 'number' && Number.isFinite(t.x) ? t.x : 0
  const ty = typeof t.y === 'number' && Number.isFinite(t.y) ? t.y : 0
  const tw = typeof t.width === 'number' && Number.isFinite(t.width) && t.width > 0 ? t.width : 0
  const th = typeof t.height === 'number' && Number.isFinite(t.height) && t.height > 0 ? t.height : 0

  const p = popup && typeof popup === 'object' ? popup : { width: 160, height: 200 }
  const pw = typeof p.width === 'number' && Number.isFinite(p.width) && p.width > 0 ? p.width : 160
  const ph = typeof p.height === 'number' && Number.isFinite(p.height) && p.height > 0 ? p.height : 200

  const v = viewport && typeof viewport === 'object' ? viewport : { width: 1024, height: 768 }
  const vw = typeof v.width === 'number' && Number.isFinite(v.width) && v.width > 0 ? v.width : 1024
  const vh = typeof v.height === 'number' && Number.isFinite(v.height) && v.height > 0 ? v.height : 768

  const margin = typeof options.margin === 'number' && Number.isFinite(options.margin) ? options.margin : DEFAULT_MARGIN

  let x = tx
  let y = ty + th
  let placement = 'bottom-start'

  // Flip upward if overflowing bottom and more space is available above
  if (y + ph > vh - margin && ty - ph >= margin) {
    y = ty - ph
    placement = 'top-start'
  }

  // Constrain X coordinate inside viewport boundaries
  if (x + pw > vw - margin) {
    x = Math.max(margin, vw - pw - margin)
  }
  if (x < margin) {
    x = margin
  }

  // Final safety clamp for Y coordinate
  if (y + ph > vh - margin) {
    y = Math.max(margin, vh - ph - margin)
  }
  if (y < margin) {
    y = margin
  }

  return { x: Math.round(x), y: Math.round(y), placement }
}

// Creates an isolated context menu state manager.
export function createMenu (options = {}) {
  let open = false
  let x = 0
  let y = 0
  let items = []
  let selectedIndex = -1

  function show (config = {}) {
    if (!config || typeof config !== 'object') return false
    const rawItems = Array.isArray(config.items) ? config.items : []
    const normalized = []
    for (const raw of rawItems) {
      const norm = normalizeMenuItem(raw)
      if (norm) normalized.push(norm)
    }

    items = normalized.slice(0, MAX_MENU_ITEMS)
    x = typeof config.x === 'number' && Number.isFinite(config.x) ? config.x : 0
    y = typeof config.y === 'number' && Number.isFinite(config.y) ? config.y : 0
    open = true
    selectedIndex = -1
    return true
  }

  function close () {
    open = false
    items = []
    selectedIndex = -1
  }

  function handleKey (key) {
    if (!open) return null
    if (key === 'Escape') {
      close()
      return { action: 'close' }
    }
    if (key === 'Enter') {
      const selected = items[selectedIndex]
      if (selected && !selected.disabled && !selected.separator) {
        close()
        return { action: 'execute', item: selected }
      }
      return null
    }

    const nav = navigateMenu(items, selectedIndex, key)
    if (nav) {
      selectedIndex = nav.index
      return { action: 'select', index: nav.index, item: nav.item }
    }
    return null
  }

  return {
    show,
    close,
    handleKey,
    get isOpen () { return open },
    get x () { return x },
    get y () { return y },
    get items () { return items.map(it => ({ ...it })) },
    get selectedIndex () { return selectedIndex }
  }
}
