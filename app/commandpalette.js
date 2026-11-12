// Command palette registry, search, shortcut formatter, and dispatch. Pure ES module.
export const MAX_COMMANDS = 500
export const MAX_QUERY_LEN = 100
export const MAX_TITLE_LEN = 120
export const MAX_CAT_LEN = 60
export const MAX_SHORTCUT_LEN = 50
export const MAX_RESULTS = 50

const WORD_DELIMS = new Set([' ', '-', '_', '.', '/', ':'])

// Normalizes and sanitizes a raw command definition.
export function normalizeCommand (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, MAX_TITLE_LEN) : ''
  if (!id) return null

  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_LEN) : ''
  if (!title) return null

  const category = typeof raw.category === 'string' && raw.category.trim()
    ? raw.category.trim().slice(0, MAX_CAT_LEN)
    : 'General'

  const shortcut = typeof raw.shortcut === 'string'
    ? raw.shortcut.trim().slice(0, MAX_SHORTCUT_LEN)
    : ''

  const handler = typeof raw.handler === 'function' ? raw.handler : null
  const enabled = raw.enabled !== false
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? Math.floor(raw.order) : 0

  return { id, title, category, shortcut, handler, enabled, order }
}

// Formats shortcut keys for display on macOS or PC (Windows/Linux).
export function formatShortcut (keys, isMac = false) {
  if (typeof keys !== 'string') return ''
  const trimmed = keys.trim().slice(0, MAX_SHORTCUT_LEN)
  if (!trimmed) return ''

  const parts = trimmed.split('+')
  const key = parts.pop() || '+'
  const mods = new Set(parts.map(p => p.trim()))

  if (isMac) {
    let out = ''
    if (mods.has('Ctrl') || mods.has('Control')) out += '⌃'
    if (mods.has('Alt') || mods.has('Option')) out += '⌥'
    if (mods.has('Shift')) out += '⇧'
    if (mods.has('Mod') || mods.has('Cmd') || mods.has('Meta')) out += '⌘'

    const specialMac = {
      Enter: '↵',
      Return: '↵',
      Escape: 'Esc',
      Esc: 'Esc',
      Delete: 'Del',
      Backspace: '⌫',
      Tab: '⇥',
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→'
    }
    const mapped = specialMac[key] || (key.length === 1 ? key.toUpperCase() : key)
    return out + mapped
  }

  const out = []
  if (mods.has('Mod') || mods.has('Ctrl') || mods.has('Control') || mods.has('Cmd') || mods.has('Meta')) {
    out.push('Ctrl')
  }
  if (mods.has('Alt') || mods.has('Option')) out.push('Alt')
  if (mods.has('Shift')) out.push('Shift')

  const specialPc = {
    Enter: 'Enter',
    Return: 'Enter',
    Escape: 'Esc',
    Esc: 'Esc',
    Delete: 'Delete',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }
  out.push(specialPc[key] || (key.length === 1 ? key.toUpperCase() : key))
  return out.join('+')
}

// Matches a keyboard event against a shortcut definition.
export function matchShortcut (event, keys) {
  if (!event || typeof event !== 'object' || typeof keys !== 'string') return false
  const trimmed = keys.trim().slice(0, MAX_SHORTCUT_LEN)
  if (!trimmed) return false

  const parts = trimmed.split('+')
  const expectedKey = parts.pop() || '+'
  const mods = new Set(parts.map(p => p.trim()))

  const hasMod = mods.has('Mod')
  const reqCtrl = mods.has('Ctrl') || mods.has('Control')
  const reqMeta = mods.has('Cmd') || mods.has('Meta')
  const reqShift = mods.has('Shift')
  const reqAlt = mods.has('Alt') || mods.has('Option')

  const eventMod = !!(event.ctrlKey || event.metaKey)
  if (hasMod) {
    if (!eventMod) return false
  } else {
    if (reqCtrl !== !!event.ctrlKey) return false
    if (reqMeta !== !!event.metaKey) return false
  }
  if (reqShift !== !!event.shiftKey) return false
  if (reqAlt !== !!event.altKey) return false

  const ek = String(event.key || '')
  if (expectedKey.length === 1) {
    if (ek.toLowerCase() === expectedKey.toLowerCase()) return true
    if (event.code) {
      const c = String(event.code)
      if (/^[A-Za-z]$/.test(expectedKey)) return c === 'Key' + expectedKey.toUpperCase()
      if (/^[0-9]$/.test(expectedKey)) return c === 'Digit' + expectedKey
    }
    return false
  }
  return ek.toLowerCase() === expectedKey.toLowerCase()
}

// Fuzzy scores a query string against a command title and category.
export function scoreCommand (query, command) {
  if (typeof query !== 'string') return null
  const qClean = query.trim().slice(0, MAX_QUERY_LEN)
  if (!qClean) return 0
  if (!command || typeof command !== 'object') return null

  const title = typeof command.title === 'string' ? command.title.slice(0, MAX_TITLE_LEN) : ''
  const category = typeof command.category === 'string' ? command.category.slice(0, MAX_CAT_LEN) : ''
  const fullText = (category ? category + ': ' + title : title).toLowerCase()
  const q = qClean.toLowerCase().replace(/\s+/g, '')

  let tIdx = 0
  const indices = []
  for (let k = 0; k < q.length; k++) {
    const pos = fullText.indexOf(q[k], tIdx)
    if (pos === -1) return null
    indices.push(pos)
    tIdx = pos + 1
  }

  let total = 100 * q.length
  const catOffset = category ? category.length + 2 : 0

  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]
    if (i === 0 || i === catOffset) total += 35
    if (i === 0 || WORD_DELIMS.has(fullText[i - 1])) total += 25
    if (k > 0 && i === indices[k - 1] + 1) total += 20
    if (i >= catOffset) total += 10
  }

  const penalty = Math.max(0, fullText.length - q.length)
  return Math.max(1, total - penalty)
}

// Finds match ranges [start, end] for highlighting matched characters in text.
export function matchRanges (query, text) {
  if (typeof query !== 'string' || typeof text !== 'string') return []
  const qClean = query.trim().slice(0, MAX_QUERY_LEN).replace(/\s+/g, '').toLowerCase()
  if (!qClean) return []

  const t = text.slice(0, MAX_TITLE_LEN).toLowerCase()
  const exactIdx = t.indexOf(qClean)
  if (exactIdx !== -1) {
    return [[exactIdx, exactIdx + qClean.length]]
  }

  const indices = []
  let tIdx = 0
  for (let k = 0; k < qClean.length; k++) {
    const pos = t.indexOf(qClean[k], tIdx)
    if (pos === -1) return []
    indices.push(pos)
    tIdx = pos + 1
  }

  const ranges = []
  let start = indices[0]
  let prev = indices[0]
  for (let k = 1; k < indices.length; k++) {
    const cur = indices[k]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push([start, prev + 1])
      start = cur
      prev = cur
    }
  }
  ranges.push([start, prev + 1])
  return ranges
}

// Creates an isolated command palette registry and query manager.
export function createCommandPalette (options = {}) {
  const registry = new Map()

  function register (raw) {
    const cmd = normalizeCommand(raw)
    if (!cmd) return false
    if (registry.size >= MAX_COMMANDS && !registry.has(cmd.id)) return false
    registry.set(cmd.id, cmd)
    return true
  }

  function unregister (id) {
    if (typeof id !== 'string') return false
    return registry.delete(id.trim())
  }

  function has (id) {
    if (typeof id !== 'string') return false
    return registry.has(id.trim())
  }

  function get (id) {
    if (typeof id !== 'string') return null
    const cmd = registry.get(id.trim())
    if (!cmd) return null
    return { ...cmd }
  }

  function list ({ category = null, enabledOnly = false } = {}) {
    const catFilter = typeof category === 'string' && category.trim() ? category.trim() : null
    const items = []
    for (const cmd of registry.values()) {
      if (enabledOnly && !cmd.enabled) continue
      if (catFilter && cmd.category.toLowerCase() !== catFilter.toLowerCase()) continue
      items.push({ ...cmd })
    }
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      const catCmp = a.category.localeCompare(b.category)
      if (catCmp !== 0) return catCmp
      return a.title.localeCompare(b.title)
    })
    return items
  }

  function categories () {
    const set = new Set()
    for (const cmd of registry.values()) {
      set.add(cmd.category)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }

  function query (searchStr, { limit = MAX_RESULTS, category = null, enabledOnly = true } = {}) {
    const max = Math.max(1, Math.min(MAX_RESULTS, typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : MAX_RESULTS))
    const catFilter = typeof category === 'string' && category.trim() ? category.trim() : null
    const rawQuery = typeof searchStr === 'string' ? searchStr.trim().slice(0, MAX_QUERY_LEN) : ''

    const candidates = []
    for (const cmd of registry.values()) {
      if (enabledOnly && !cmd.enabled) continue
      if (catFilter && cmd.category.toLowerCase() !== catFilter.toLowerCase()) continue
      candidates.push(cmd)
    }

    if (!rawQuery) {
      candidates.sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        const catCmp = a.category.localeCompare(b.category)
        if (catCmp !== 0) return catCmp
        return a.title.localeCompare(b.title)
      })
      return candidates.slice(0, max).map(cmd => ({
        command: { ...cmd },
        score: 0,
        matches: []
      }))
    }

    const scored = []
    for (let i = 0; i < candidates.length; i++) {
      const cmd = candidates[i]
      const s = scoreCommand(rawQuery, cmd)
      if (s !== null) {
        scored.push({
          command: { ...cmd },
          score: s,
          matches: matchRanges(rawQuery, cmd.title),
          index: i
        })
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.command.title.length !== b.command.title.length) {
        return a.command.title.length - b.command.title.length
      }
      return a.index - b.index
    })

    return scored.slice(0, max)
  }

  function execute (id, ...args) {
    if (typeof id !== 'string') return { success: false, error: 'Invalid command identifier' }
    const cmd = registry.get(id.trim())
    if (!cmd) return { success: false, error: 'Command not found' }
    if (!cmd.enabled) return { success: false, error: 'Command is disabled' }
    if (typeof cmd.handler !== 'function') return { success: false, error: 'Command has no handler' }

    try {
      const result = cmd.handler(...args)
      return { success: true, result }
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err)
      return { success: false, error: msg }
    }
  }

  function clear () {
    registry.clear()
  }

  if (options && Array.isArray(options.items)) {
    for (const item of options.items) {
      register(item)
    }
  }

  return {
    register,
    unregister,
    has,
    get,
    list,
    categories,
    query,
    execute,
    trigger: execute,
    clear,
    get size () {
      return registry.size
    }
  }
}
