// Status bar state, item registry, and formatting. Pure ES module.
export const MAX_STATUS_ITEMS = 50
export const MAX_ID_LEN = 60
export const MAX_TEXT_LEN = 120
export const MAX_TOOLTIP_LEN = 200
export const MAX_MESSAGE_LEN = 250
export const DEFAULT_MESSAGE_TIMEOUT = 5000

// Formats editor line and column coordinates for status bar display.
export function formatCursor (line, col, selectionLength = 0) {
  const l = typeof line === 'number' && Number.isFinite(line) && line >= 1 ? Math.floor(line) : 1
  const c = typeof col === 'number' && Number.isFinite(col) && col >= 1 ? Math.floor(col) : 1
  const sel = typeof selectionLength === 'number' && Number.isFinite(selectionLength) && selectionLength > 0
    ? Math.floor(selectionLength)
    : 0

  if (sel > 0) {
    return 'Ln ' + l + ', Col ' + c + ' (' + sel + ' selected)'
  }
  return 'Ln ' + l + ', Col ' + c
}

// Formats problems diagnostics count badge.
export function formatProblems (errors = 0, warnings = 0) {
  const errCount = typeof errors === 'number' && Number.isFinite(errors) && errors > 0 ? Math.floor(errors) : 0
  const warnCount = typeof warnings === 'number' && Number.isFinite(warnings) && warnings > 0 ? Math.floor(warnings) : 0

  if (errCount === 0 && warnCount === 0) {
    return '0 Problems'
  }
  const parts = []
  if (errCount > 0) {
    parts.push('✕ ' + errCount)
  }
  if (warnCount > 0) {
    parts.push('⚠ ' + warnCount)
  }
  return parts.join('  ')
}

// Formats Git branch and sync indicators for status bar display.
export function formatGit (branch, ahead = 0, behind = 0, detached = false) {
  const rawBranch = typeof branch === 'string' ? branch.trim().slice(0, 60) : ''
  if (!rawBranch) return ''

  if (detached) {
    return 'HEAD detached at ' + rawBranch
  }

  const ah = typeof ahead === 'number' && Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0
  const bh = typeof behind === 'number' && Number.isFinite(behind) && behind > 0 ? Math.floor(behind) : 0

  let indicators = ''
  if (bh > 0) indicators += bh + '↓ '
  if (ah > 0) indicators += ah + '↑'
  indicators = indicators.trim()

  return indicators ? rawBranch + ' ' + indicators : rawBranch
}

// Formats editor indentation settings (e.g. 'Spaces: 2' or 'Tabs: 4').
export function formatIndent (type = 'spaces', size = 2) {
  const isTabs = String(type || '').toLowerCase().startsWith('tab')
  const s = typeof size === 'number' && Number.isFinite(size) && size > 0 ? Math.floor(size) : (isTabs ? 4 : 2)
  return isTabs ? 'Tabs: ' + s : 'Spaces: ' + s
}

// Formats text encoding and line ending mode (e.g. 'UTF-8  LF').
export function formatEncoding (encoding = 'utf-8', eol = '\n') {
  const enc = typeof encoding === 'string' && encoding.trim() ? encoding.trim().toUpperCase().slice(0, 20) : 'UTF-8'
  const isCrlf = eol === '\r\n' || (typeof eol === 'string' && eol.toLowerCase().includes('crlf'))
  return enc + '  ' + (isCrlf ? 'CRLF' : 'LF')
}

// Sanitizes a raw status bar item object.
function sanitizeItem (id, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const cleanId = String(id || '').trim().slice(0, MAX_ID_LEN)
  if (!cleanId || cleanId === '__proto__' || cleanId === 'constructor') return null

  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, MAX_TEXT_LEN) : ''
  const tooltip = typeof raw.tooltip === 'string' ? raw.tooltip.trim().slice(0, MAX_TOOLTIP_LEN) : ''
  const icon = typeof raw.icon === 'string' ? raw.icon.trim().slice(0, 30) : ''
  const command = typeof raw.command === 'string' ? raw.command.trim().slice(0, 60) : ''
  const side = raw.side === 'right' ? 'right' : 'left'
  const priority = typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? Math.floor(raw.priority) : 0
  const visible = raw.visible !== false
  const className = typeof raw.className === 'string' ? raw.className.trim().slice(0, 50) : ''

  return {
    id: cleanId,
    text,
    tooltip,
    icon,
    command,
    side,
    priority,
    visible,
    className
  }
}

// Creates an isolated status bar manager instance.
export function createStatusBar (options = {}) {
  const items = new Map()
  let ephemeralMessage = null

  function set (id, rawItem) {
    const clean = sanitizeItem(id, rawItem)
    if (!clean) return false
    if (items.size >= MAX_STATUS_ITEMS && !items.has(clean.id)) return false
    items.set(clean.id, clean)
    return true
  }

  function get (id) {
    if (typeof id !== 'string') return null
    const item = items.get(id.trim())
    return item ? { ...item } : null
  }

  function has (id) {
    if (typeof id !== 'string') return false
    return items.has(id.trim())
  }

  function remove (id) {
    if (typeof id !== 'string') return false
    return items.delete(id.trim())
  }

  function show (id) {
    if (typeof id !== 'string') return false
    const item = items.get(id.trim())
    if (!item) return false
    item.visible = true
    return true
  }

  function hide (id) {
    if (typeof id !== 'string') return false
    const item = items.get(id.trim())
    if (!item) return false
    item.visible = false
    return true
  }

  function list (side = null) {
    const left = []
    const right = []

    for (const item of items.values()) {
      if (!item.visible) continue
      if (item.side === 'right') {
        right.push({ ...item })
      } else {
        left.push({ ...item })
      }
    }

    // Sort by priority descending, then ID alphabetical
    const sorter = (a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return a.id.localeCompare(b.id)
    }

    left.sort(sorter)
    right.sort(sorter)

    if (side === 'left') return left
    if (side === 'right') return right
    return { left, right }
  }

  function setMessage (text, { timeout = DEFAULT_MESSAGE_TIMEOUT, now = () => Date.now() } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
      ephemeralMessage = null
      return false
    }
    const cleanText = text.trim().slice(0, MAX_MESSAGE_LEN)
    const validTimeout = typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? Math.floor(timeout)
      : DEFAULT_MESSAGE_TIMEOUT

    const currentTime = typeof now === 'function' ? now() : Date.now()
    ephemeralMessage = {
      text: cleanText,
      expiresAt: currentTime + validTimeout
    }
    return true
  }

  function getMessage ({ now = () => Date.now() } = {}) {
    if (!ephemeralMessage) return null
    const currentTime = typeof now === 'function' ? now() : Date.now()
    if (currentTime >= ephemeralMessage.expiresAt) {
      ephemeralMessage = null
      return null
    }
    return ephemeralMessage.text
  }

  function clearMessage () {
    ephemeralMessage = null
  }

  function clear () {
    items.clear()
    ephemeralMessage = null
  }

  if (options && typeof options === 'object' && options.items) {
    if (Array.isArray(options.items)) {
      for (const it of options.items) {
        if (it && it.id) set(it.id, it)
      }
    } else if (typeof options.items === 'object') {
      for (const [key, val] of Object.entries(options.items)) {
        set(key, val)
      }
    }
  }

  return {
    set,
    get,
    has,
    remove,
    show,
    hide,
    list,
    setMessage,
    getMessage,
    clearMessage,
    clear,
    get size () {
      return items.size
    }
  }
}
