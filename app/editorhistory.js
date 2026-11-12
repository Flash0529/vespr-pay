// Editor undo and redo buffer history with typing coalescing and dirty tracking. Pure ES module.
export const MAX_HISTORY_DEPTH = 200
export const DEFAULT_DEBOUNCE_MS = 500
export const MAX_TEXT_LEN = 500000

// Normalizes cursor position coordinates.
function normalizeCursor (cursor) {
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    return Math.max(0, Math.floor(cursor))
  }
  if (cursor && typeof cursor === 'object') {
    const line = typeof cursor.line === 'number' && Number.isFinite(cursor.line) && cursor.line >= 1
      ? Math.floor(cursor.line)
      : 1
    const col = typeof cursor.col === 'number' && Number.isFinite(cursor.col) && cursor.col >= 1
      ? Math.floor(cursor.col)
      : 1
    return { line, col }
  }
  return { line: 1, col: 1 }
}

// Deep compares cursor positions.
function cursorsEqual (a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return a.line === b.line && a.col === b.col
  }
  return false
}

// Creates an isolated undo/redo history manager for an editor buffer.
export function createHistory (options = {}) {
  const maxDepth = typeof options.maxDepth === 'number' && Number.isFinite(options.maxDepth) && options.maxDepth > 0
    ? Math.min(MAX_HISTORY_DEPTH, Math.floor(options.maxDepth))
    : MAX_HISTORY_DEPTH

  const debounceMs = typeof options.debounceMs === 'number' && Number.isFinite(options.debounceMs) && options.debounceMs >= 0
    ? Math.floor(options.debounceMs)
    : DEFAULT_DEBOUNCE_MS

  const initialText = typeof options.initialText === 'string'
    ? options.initialText.slice(0, MAX_TEXT_LEN)
    : ''
  const initialCursor = normalizeCursor(options.initialCursor)

  const entries = [
    {
      text: initialText,
      cursor: initialCursor,
      timestamp: 0,
      origin: 'init'
    }
  ]

  let currentIndex = 0
  let savedIndex = 0

  function push (rawText, rawCursor = null, opts = {}) {
    if (typeof rawText !== 'string') return false
    const text = rawText.slice(0, MAX_TEXT_LEN)
    const cursor = rawCursor !== null ? normalizeCursor(rawCursor) : normalizeCursor(entries[currentIndex].cursor)
    const origin = typeof opts.origin === 'string' ? opts.origin.slice(0, 30) : 'type'
    const forceBoundary = !!opts.forceBoundary
    const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
    const timestamp = nowFn()

    const currentEntry = entries[currentIndex]
    if (currentEntry.text === text && cursorsEqual(currentEntry.cursor, cursor)) {
      return false
    }

    const isTyping = origin === 'type' || origin === 'input'
    const wasTyping = currentEntry.origin === 'type' || currentEntry.origin === 'input'
    const timeDelta = timestamp - currentEntry.timestamp

    // Coalesce rapid single-character typing without newlines
    const canCoalesce = !forceBoundary &&
      isTyping &&
      wasTyping &&
      timeDelta <= debounceMs &&
      Math.abs(text.length - currentEntry.text.length) === 1 &&
      !text.includes('\n', Math.min(text.length - 1, currentEntry.text.length))

    if (canCoalesce) {
      currentEntry.text = text
      currentEntry.cursor = cursor
      currentEntry.timestamp = timestamp
      return true
    }

    // Drop redo history forward of current index
    entries.splice(currentIndex + 1)

    // Append new entry
    entries.push({
      text,
      cursor,
      timestamp,
      origin
    })
    currentIndex++

    // Enforce max depth capacity by dropping oldest entry
    if (entries.length > maxDepth) {
      entries.shift()
      currentIndex--
      if (savedIndex > 0) savedIndex--
      else if (savedIndex === 0) savedIndex = -1 // saved state fell out of history
    }

    return true
  }

  function undo () {
    if (currentIndex <= 0) return null
    currentIndex--
    const entry = entries[currentIndex]
    return {
      text: entry.text,
      cursor: typeof entry.cursor === 'object' ? { ...entry.cursor } : entry.cursor,
      canUndo: currentIndex > 0,
      canRedo: currentIndex < entries.length - 1,
      isDirty: currentIndex !== savedIndex
    }
  }

  function redo () {
    if (currentIndex >= entries.length - 1) return null
    currentIndex++
    const entry = entries[currentIndex]
    return {
      text: entry.text,
      cursor: typeof entry.cursor === 'object' ? { ...entry.cursor } : entry.cursor,
      canUndo: currentIndex > 0,
      canRedo: currentIndex < entries.length - 1,
      isDirty: currentIndex !== savedIndex
    }
  }

  function current () {
    const entry = entries[currentIndex]
    return {
      text: entry.text,
      cursor: typeof entry.cursor === 'object' ? { ...entry.cursor } : entry.cursor,
      canUndo: currentIndex > 0,
      canRedo: currentIndex < entries.length - 1,
      isDirty: currentIndex !== savedIndex
    }
  }

  function setSaved () {
    savedIndex = currentIndex
  }

  function isDirty () {
    return currentIndex !== savedIndex
  }

  function clear (newInitialText = '', newInitialCursor = null) {
    const text = typeof newInitialText === 'string' ? newInitialText.slice(0, MAX_TEXT_LEN) : ''
    const cursor = normalizeCursor(newInitialCursor)
    entries.length = 0
    entries.push({
      text,
      cursor,
      timestamp: 0,
      origin: 'init'
    })
    currentIndex = 0
    savedIndex = 0
  }

  return {
    push,
    undo,
    redo,
    current,
    setSaved,
    isDirty,
    clear,
    get canUndo () { return currentIndex > 0 },
    get canRedo () { return currentIndex < entries.length - 1 },
    get size () { return entries.length },
    get index () { return currentIndex }
  }
}
