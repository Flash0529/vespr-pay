// Code bracket matching, auto-closing pairs, and syntax balance validator. Pure ES module.
export const MAX_SCAN_LEN = 200000

export const OPEN_BRACKETS = Object.freeze({
  '(': ')',
  '[': ']',
  '{': '}'
})

export const CLOSE_BRACKETS = Object.freeze({
  ')': '(',
  ']': '[',
  '}': '{'
})

export const AUTO_CLOSE_PAIRS = Object.freeze({
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`'
})

// Checks if character is an opening or closing bracket.
export function isBracket (char) {
  if (typeof char !== 'string' || char.length !== 1) return false
  return char in OPEN_BRACKETS || char in CLOSE_BRACKETS
}

// Returns the auto-closing counterpart for a bracket or quotation mark.
export function getAutoCloseChar (char) {
  if (typeof char !== 'string' || char.length !== 1) return null
  return AUTO_CLOSE_PAIRS[char] || null
}

// Wraps a selected string inside matching brackets or quotes.
export function wrapWithPair (text, openChar) {
  const content = typeof text === 'string' ? text.slice(0, MAX_SCAN_LEN) : ''
  const closeChar = getAutoCloseChar(openChar)
  if (!closeChar) return content
  return openChar + content + closeChar
}

// Computes 1-based line and column from 0-based character offset.
function offsetToPos (text, offset) {
  let line = 1
  let col = 1
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) {
    if (text[i] === '\n') {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, col }
}

// Finds the matching bracket corresponding to the character at or before offset.
export function findMatchingBracket (rawText, rawOffset) {
  if (typeof rawText !== 'string') return null
  const text = rawText.slice(0, MAX_SCAN_LEN)
  if (text.length === 0) return null

  let offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset)
    ? Math.max(0, Math.min(text.length - 1, Math.floor(rawOffset)))
    : 0

  // Allow offset directly on bracket or immediately after bracket
  let targetChar = text[offset]
  if (!isBracket(targetChar) && offset > 0 && isBracket(text[offset - 1])) {
    offset = offset - 1
    targetChar = text[offset]
  }

  if (!isBracket(targetChar)) return null

  if (targetChar in OPEN_BRACKETS) {
    const closeChar = OPEN_BRACKETS[targetChar]
    let depth = 0
    let inString = null
    let inComment = false

    for (let i = offset; i < text.length; i++) {
      const ch = text[i]
      const prev = i > 0 ? text[i - 1] : ''

      if (inString) {
        if (ch === inString && prev !== '\\') inString = null
        continue
      }
      if (inComment === 'line') {
        if (ch === '\n') inComment = false
        continue
      }
      if (inComment === 'block') {
        if (ch === '/' && prev === '*') inComment = false
        continue
      }

      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch
        continue
      }
      if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
        inComment = 'line'
        i++
        continue
      }
      if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
        inComment = 'block'
        i++
        continue
      }

      if (ch === targetChar) {
        depth++
      } else if (ch === closeChar) {
        depth--
        if (depth === 0) {
          return {
            matchOffset: i,
            openOffset: offset,
            closeOffset: i,
            pair: targetChar + closeChar
          }
        }
      }
    }
    return null
  }

  // Scanning backward from closing bracket
  const openChar = CLOSE_BRACKETS[targetChar]
  let depth = 0
  for (let i = offset; i >= 0; i--) {
    const ch = text[i]
    if (ch === targetChar) {
      depth++
    } else if (ch === openChar) {
      depth--
      if (depth === 0) {
        return {
          matchOffset: i,
          openOffset: i,
          closeOffset: offset,
          pair: openChar + targetChar
        }
      }
    }
  }

  return null
}

// Scans document and checks whether all bracket pairs are correctly nested and closed.
export function checkBalance (rawText) {
  if (typeof rawText !== 'string') {
    return { balanced: true, issues: [] }
  }
  const text = rawText.slice(0, MAX_SCAN_LEN)
  const stack = []
  const issues = []

  let inString = null
  let inComment = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = i > 0 ? text[i - 1] : ''

    if (inString) {
      if (ch === inString && prev !== '\\') inString = null
      continue
    }
    if (inComment === 'line') {
      if (ch === '\n') inComment = false
      continue
    }
    if (inComment === 'block') {
      if (ch === '/' && prev === '*') inComment = false
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n')) {
      inComment = 'line'
      continue
    }
    if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
      inComment = 'line'
      i++
      continue
    }
    if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
      inComment = 'block'
      i++
      continue
    }

    if (ch in OPEN_BRACKETS) {
      stack.push({ char: ch, offset: i, close: OPEN_BRACKETS[ch] })
    } else if (ch in CLOSE_BRACKETS) {
      if (stack.length === 0) {
        const pos = offsetToPos(text, i)
        issues.push({
          line: pos.line,
          col: pos.col,
          offset: i,
          message: 'Unexpected closing bracket "' + ch + '" without matching opening bracket',
          expected: null,
          found: ch
        })
      } else {
        const top = stack.pop()
        if (top.close !== ch) {
          const pos = offsetToPos(text, i)
          issues.push({
            line: pos.line,
            col: pos.col,
            offset: i,
            message: 'Mismatched closing bracket "' + ch + '", expected "' + top.close + '"',
            expected: top.close,
            found: ch
          })
        }
      }
    }
  }

  // Report unclosed opening brackets left on stack
  while (stack.length > 0) {
    const unclosed = stack.pop()
    const pos = offsetToPos(text, unclosed.offset)
    issues.push({
      line: pos.line,
      col: pos.col,
      offset: unclosed.offset,
      message: 'Unclosed opening bracket "' + unclosed.char + '", expected "' + unclosed.close + '" before end of input',
      expected: unclosed.close,
      found: null
    })
  }

  return {
    balanced: issues.length === 0,
    issues
  }
}
