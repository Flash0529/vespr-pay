// In-file search, match navigation, and replace helper for the SDE shell. Pure ES module.
export const MAX_DOC_CHARS = 1000000
export const MAX_QUERY_LEN = 500
export const MAX_MATCHES = 1000

function cleanText (val, maxLen = MAX_DOC_CHARS) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').slice(0, maxLen)
}

export function escapeRegExp (str) {
  if (typeof str !== 'string') return ''
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildRegex (query, options = {}) {
  const cleanQ = cleanText(query, MAX_QUERY_LEN)
  if (!cleanQ) return null

  const isRegex = options.regex === true
  const isCaseSensitive = options.caseSensitive === true
  const isWholeWord = options.wholeWord === true

  let pattern = isRegex ? cleanQ : escapeRegExp(cleanQ)
  if (isWholeWord) {
    pattern = '\\b(?:' + pattern + ')\\b'
  }

  const flags = 'g' + (isCaseSensitive ? '' : 'i')
  try {
    return new RegExp(pattern, flags)
  } catch {
    return null
  }
}

function computeLineCol (src, index) {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < index; i++) {
    if (src[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  return { line, col: index - lineStart + 1 }
}

export function findMatches (text, query, options = {}) {
  const src = cleanText(text)
  if (!src) return []

  const rx = buildRegex(query, options)
  if (!rx) return []

  const matches = []
  let match

  while ((match = rx.exec(src)) !== null) {
    if (matches.length >= MAX_MATCHES) break

    const matchLen = match[0].length
    const { line, col } = computeLineCol(src, match.index)

    matches.push({
      index: match.index,
      length: matchLen,
      line,
      col,
      text: match[0]
    })

    // Advance index on zero-length matches to prevent infinite loops
    if (matchLen === 0) {
      rx.lastIndex++
    }
  }

  return matches
}

export function replaceOne (text, matchRange, replacement) {
  const src = cleanText(text)
  if (!src || !matchRange || typeof matchRange !== 'object') return src

  const idx = typeof matchRange.index === 'number' && Number.isFinite(matchRange.index)
    ? Math.max(0, Math.min(src.length, Math.floor(matchRange.index)))
    : -1

  const len = typeof matchRange.length === 'number' && Number.isFinite(matchRange.length)
    ? Math.max(0, Math.floor(matchRange.length))
    : 0

  if (idx < 0 || idx + len > src.length) return src
  const rep = cleanText(replacement, MAX_QUERY_LEN)

  return src.slice(0, idx) + rep + src.slice(idx + len)
}

export function replaceAll (text, query, replacement, options = {}) {
  const src = cleanText(text)
  if (!src) return { text: '', count: 0 }

  const matches = findMatches(src, query, options)
  if (matches.length === 0) return { text: src, count: 0 }

  const rx = buildRegex(query, options)
  if (!rx) return { text: src, count: 0 }

  const rep = cleanText(replacement, MAX_QUERY_LEN)
  // Literal replacement avoiding unwanted dollar-sequence expansions
  const replaced = src.replace(rx, () => rep)

  return {
    text: replaced,
    count: matches.length
  }
}

export function nextMatch (matches, currentOffset) {
  if (!Array.isArray(matches) || matches.length === 0) return -1
  const offset = typeof currentOffset === 'number' && Number.isFinite(currentOffset) ? Math.floor(currentOffset) : 0

  for (let i = 0; i < matches.length; i++) {
    if (matches[i] && matches[i].index > offset) {
      return i
    }
  }

  // Wrap around to the first match
  return 0
}

export function prevMatch (matches, currentOffset) {
  if (!Array.isArray(matches) || matches.length === 0) return -1
  const offset = typeof currentOffset === 'number' && Number.isFinite(currentOffset) ? Math.floor(currentOffset) : 0

  for (let i = matches.length - 1; i >= 0; i--) {
    if (matches[i] && matches[i].index < offset) {
      return i
    }
  }

  // Wrap around to the last match
  return matches.length - 1
}

export function formatMatchCount (currentIndex, totalCount) {
  const total = typeof totalCount === 'number' && Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0
  if (total === 0) return 'No results'

  const cur = typeof currentIndex === 'number' && Number.isFinite(currentIndex) ? Math.floor(currentIndex) : -1
  if (cur < 0 || cur >= total) return '0 of ' + total

  return (cur + 1) + ' of ' + total
}