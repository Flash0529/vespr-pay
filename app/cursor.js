// Editor cursor position, selection, and indentation helper for the SDE shell. Pure ES module.
export const MAX_DOC_CHARS = 1000000
export const MAX_LINES = 50000
export const DEFAULT_INDENT = Object.freeze({
  type: 'spaces',
  width: 4,
  label: 'Spaces: 4'
})

const WORD_CHAR = /[A-Za-z0-9_]/

function cleanText (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').slice(0, MAX_DOC_CHARS)
}

function cleanPosNum (val, fallback = 1) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.max(1, Math.floor(val))
  }
  return fallback
}

export function lineCount (text) {
  if (typeof text !== 'string') return 0
  if (!text) return 0
  let count = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

export function clampLine (line, totalLines) {
  const target = cleanPosNum(line, 1)
  const max = cleanPosNum(totalLines, 1)
  return Math.min(target, max)
}

export function offsetToPos (text, rawOffset) {
  const src = cleanText(text)
  const len = src.length
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset)
    ? Math.max(0, Math.min(len, Math.floor(rawOffset)))
    : 0

  let line = 1
  let lineStart = 0

  for (let i = 0; i < offset; i++) {
    if (src[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }

  const col = offset - lineStart + 1
  return { line, col }
}

export function posToOffset (text, pos) {
  const src = cleanText(text)
  if (!src) return 0

  const targetLine = pos && typeof pos === 'object' ? cleanPosNum(pos.line, 1) : 1
  const targetCol = pos && typeof pos === 'object' ? cleanPosNum(pos.col, 1) : 1

  let curLine = 1
  let lineStart = 0
  let lineEnd = src.length

  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') {
      if (curLine === targetLine) {
        lineEnd = i
        break
      }
      curLine++
      lineStart = i + 1
    }
  }

  // Calculate clamped column offset within target line
  const colOffset = Math.max(0, Math.min(targetCol - 1, lineEnd - lineStart))
  return lineStart + colOffset
}

export function formatPosition (pos) {
  if (!pos || typeof pos !== 'object') return 'Ln 1, Col 1'
  const line = cleanPosNum(pos.line, 1)
  const col = cleanPosNum(pos.col, 1)

  const selChars = typeof pos.selectedChars === 'number' && Number.isFinite(pos.selectedChars)
    ? Math.max(0, Math.floor(pos.selectedChars))
    : 0

  const selLines = typeof pos.selectedLines === 'number' && Number.isFinite(pos.selectedLines)
    ? Math.max(0, Math.floor(pos.selectedLines))
    : 0

  if (selChars > 0) {
    if (selLines > 1) {
      return 'Ln ' + line + ', Col ' + col + ' (' + selLines + ' lines selected)'
    }
    return 'Ln ' + line + ', Col ' + col + ' (' + selChars + ' selected)'
  }

  return 'Ln ' + line + ', Col ' + col
}

export function detectIndentation (text) {
  const src = cleanText(text)
  if (!src) return { ...DEFAULT_INDENT }

  const lines = src.split('\n').slice(0, 500)
  let tabCount = 0
  let space2Count = 0
  let space4Count = 0

  for (const line of lines) {
    if (!line.trim()) continue
    if (line.startsWith('\t')) {
      tabCount++
      continue
    }

    const match = line.match(/^ +/)
    if (match) {
      const len = match[0].length
      if (len % 4 === 0) space4Count++
      else if (len % 2 === 0) space2Count++
    }
  }

  if (tabCount > space2Count && tabCount > space4Count) {
    return { type: 'tabs', width: 1, label: 'Tabs' }
  }

  if (space2Count > space4Count) {
    return { type: 'spaces', width: 2, label: 'Spaces: 2' }
  }

  return { ...DEFAULT_INDENT }
}

export function wordAt (text, rawOffset) {
  const src = cleanText(text)
  if (!src) return { word: '', from: 0, to: 0 }

  let offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset)
    ? Math.max(0, Math.min(src.length, Math.floor(rawOffset)))
    : 0

  if (offset >= src.length) {
    if (offset > 0 && WORD_CHAR.test(src[offset - 1])) {
      offset--
    } else {
      return { word: '', from: offset, to: offset }
    }
  }

  if (!WORD_CHAR.test(src[offset])) {
    return { word: '', from: offset, to: offset }
  }

  let from = offset
  while (from > 0 && WORD_CHAR.test(src[from - 1])) {
    from--
  }

  let to = offset
  while (to < src.length && WORD_CHAR.test(src[to])) {
    to++
  }

  return {
    word: src.slice(from, to),
    from,
    to
  }
}

export function normalizeSelection (rawAnchor, rawHead) {
  const anchor = typeof rawAnchor === 'number' && Number.isFinite(rawAnchor)
    ? Math.max(0, Math.floor(rawAnchor))
    : 0

  const head = typeof rawHead === 'number' && Number.isFinite(rawHead)
    ? Math.max(0, Math.floor(rawHead))
    : 0

  if (anchor <= head) {
    return {
      from: anchor,
      to: head,
      isReversed: false,
      length: head - anchor
    }
  }

  return {
    from: head,
    to: anchor,
    isReversed: true,
    length: anchor - head
  }
}