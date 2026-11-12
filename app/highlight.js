// Light syntax highlighter and code tokenizer for the SDE shell. Pure ES module.
export const MAX_CODE_LEN = 100000
export const MAX_LINE_LEN = 2000

const KEYWORDS = new Set([
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from',
  'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'try', 'except', 'finally',
  'with', 'as', 'pass', 'raise', 'lambda', 'yield',
  'const', 'let', 'var', 'function', 'async', 'await', 'export', 'default', 'new',
  'this', 'null', 'true', 'false', 'undefined', 'throw', 'catch', 'switch', 'case',
  'break', 'continue', 'typeof', 'instanceof', 'interface', 'type', 'implements',
  'fn', 'mut', 'pub', 'struct', 'enum', 'impl', 'trait', 'match',
  'func', 'package', 'select', 'chan', 'defer'
])

const TOKEN_REGEX = /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/gm

export function escapeHtml (str) {
  if (typeof str !== 'string') return ''
  return str.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return c
    }
  })
}

function cleanText (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').slice(0, MAX_CODE_LEN)
}

export function isKeyword (word) {
  return typeof word === 'string' && KEYWORDS.has(word)
}

export function tokenize (code) {
  const src = cleanText(code)
  if (!src) return []

  const tokens = []
  let lastIndex = 0
  let match

  TOKEN_REGEX.lastIndex = 0
  while ((match = TOKEN_REGEX.exec(src)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        text: src.slice(lastIndex, match.index)
      })
    }

    if (match[1]) {
      tokens.push({ type: 'comment', text: match[1] })
    } else if (match[2]) {
      tokens.push({ type: 'string', text: match[2] })
    } else if (match[3]) {
      tokens.push({ type: 'number', text: match[3] })
    } else if (match[4]) {
      const w = match[4]
      if (KEYWORDS.has(w)) {
        tokens.push({ type: 'keyword', text: w })
      } else {
        const preceding = src.slice(0, match.index)
        const following = src.slice(match.index + w.length)
        const isDef = /(def|function|class)\s+$/.test(preceding)
        const isCall = /^\s*\(/.test(following)

        if (isDef || isCall) {
          tokens.push({ type: 'function', text: w })
        } else {
          tokens.push({ type: 'text', text: w })
        }
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < src.length) {
    tokens.push({
      type: 'text',
      text: src.slice(lastIndex)
    })
  }

  return tokens
}

export function highlight (code) {
  const tokens = tokenize(code)
  if (tokens.length === 0) return ''

  let out = ''
  for (const t of tokens) {
    const escText = escapeHtml(t.text)
    switch (t.type) {
      case 'keyword':
        out += '<span class="k">' + escText + '</span>'
        break
      case 'string':
        out += '<span class="s">' + escText + '</span>'
        break
      case 'number':
        out += '<span class="n">' + escText + '</span>'
        break
      case 'comment':
        out += '<span class="c">' + escText + '</span>'
        break
      case 'function':
        out += '<span class="f">' + escText + '</span>'
        break
      default:
        out += escText
        break
    }
  }

  return out
}

export function highlightLines (code) {
  const src = cleanText(code)
  if (!src) return []
  return src.split('\n').map(line => highlight(line))
}