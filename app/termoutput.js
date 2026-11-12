// Terminal output buffer, ANSI stripper, and runner log parser. Pure ES module.
export const MAX_TERM_LINES = 1000
export const MAX_LINE_CHARS = 2000
export const MAX_PARSED_ERRORS = 50

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

function cleanText (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '')
}

function escapeHtml (str) {
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

export function stripAnsi (text) {
  const src = cleanText(text)
  if (!src) return ''
  return src.replace(ANSI_REGEX, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function ansiToHtml (text) {
  const clean = cleanText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!clean) return ''

  let out = ''
  let curStyle = ''
  let openSpan = false
  let lastIndex = 0
  let match

  ANSI_REGEX.lastIndex = 0
  while ((match = ANSI_REGEX.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      const chunk = escapeHtml(clean.slice(lastIndex, match.index))
      if (curStyle && !openSpan) {
        out += '<span style="' + curStyle + '">' + chunk
        openSpan = true
      } else if (openSpan) {
        out += chunk
      } else {
        out += chunk
      }
    }

    const codeStr = match[0]
    // Parse color numbers from SGR sequences like \u001b[31m or \u001b[1;32m
    const numMatches = codeStr.match(/\d+/g)
    if (numMatches) {
      for (const numStr of numMatches) {
        const n = parseInt(numStr, 10)
        if (n === 0 || n === 39 || n === 49) {
          if (openSpan) {
            out += '</span>'
            openSpan = false
          }
          curStyle = ''
        } else if (n === 1) {
          curStyle += 'font-weight:600;'
        } else if (n === 31 || n === 91) {
          curStyle += 'color:var(--bad);'
        } else if (n === 32 || n === 92) {
          curStyle += 'color:var(--ok);'
        } else if (n === 33 || n === 93) {
          curStyle += 'color:var(--warn);'
        } else if (n === 34 || n === 94 || n === 36 || n === 96) {
          curStyle += 'color:var(--agent);'
        } else if (n === 37 || n === 90) {
          curStyle += 'color:var(--muted);'
        }
      }
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < clean.length) {
    const tail = escapeHtml(clean.slice(lastIndex))
    if (curStyle && !openSpan) {
      out += '<span style="' + curStyle + '">' + tail + '</span>'
    } else if (openSpan) {
      out += tail + '</span>'
    } else {
      out += tail
    }
  } else if (openSpan) {
    out += '</span>'
  }

  return out
}

export function parseErrors (rawOutput) {
  const plain = stripAnsi(rawOutput)
  if (!plain) return []

  const lines = plain.split('\n')
  const errors = []
  const seen = new Set()

  function addError (file, rawLine, rawCol, severity, message) {
    if (errors.length >= MAX_PARSED_ERRORS) return
    const cleanFile = file.replace(/\\/g, '/').replace(/^\.\//, '').trim()
    const lineNum = Math.max(1, parseInt(rawLine, 10) || 1)
    const colNum = Math.max(1, parseInt(rawCol, 10) || 1)
    const sev = severity === 'warning' ? 'warning' : 'error'
    const msg = message.trim().slice(0, 300) || 'build or test failure'

    const key = cleanFile + ':' + lineNum + ':' + colNum + ':' + msg
    if (!seen.has(key)) {
      seen.add(key)
      errors.push({
        file: cleanFile,
        line: lineNum,
        col: colNum,
        severity: sev,
        message: msg,
        source: 'runner'
      })
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Pattern A: Python tracebacks (File "cart.py", line 12)
    const pyMatch = line.match(/File "([^"]+)", line (\d+)(?:, in (.+))?/)
    if (pyMatch) {
      let msg = ''
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        if (/^(?:[A-Za-z]+Error|AssertionError|Exception):/.test(lines[j])) {
          msg = lines[j]
          break
        }
      }
      addError(pyMatch[1], pyMatch[2], 1, 'error', msg || 'Python traceback error')
      continue
    }

    // Pattern B: Python unittest failure (FAIL: test_discount (cart_test.py:12))
    const utMatch = line.match(/^FAIL:\s*(\w+)\s*\(([^:]+):(\d+)\)/)
    if (utMatch) {
      addError(utMatch[2], utMatch[3], 1, 'error', 'FAIL: ' + utMatch[1])
      continue
    }

    // Pattern C: Node / V8 stack trace (at file:///path/cart.js:15:9 or at cart.js:15:9)
    const nodeMatch = line.match(/at (?:[^\s(]+\s+\()?(?:file:\/\/\/)?([^:)]+):(\d+):(\d+)\)?/)
    if (nodeMatch && !nodeMatch[1].includes('node:internal')) {
      let msg = ''
      for (let k = Math.max(0, i - 5); k < i; k++) {
        if (/^(?:[A-Za-z]+Error|AssertionError):/.test(lines[k])) {
          msg = lines[k]
          break
        }
      }
      addError(nodeMatch[1], nodeMatch[2], nodeMatch[3], 'error', msg || 'JavaScript error')
      continue
    }

    // Pattern D: Standard compiler format (cart.c:42:10: error: undefined symbol)
    const compMatch = line.match(/^([^:\s]+):(\d+):(?:(\d+):)?\s*(error|warning):\s*(.*)/i)
    if (compMatch) {
      addError(compMatch[1], compMatch[2], compMatch[3] || 1, compMatch[4], compMatch[5])
    }
  }

  return errors
}

export function createTermBuffer (options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const rawMax = opts.maxLines
  const maxLines = typeof rawMax === 'number' && Number.isFinite(rawMax)
    ? Math.max(1, Math.min(MAX_TERM_LINES, Math.floor(rawMax)))
    : MAX_TERM_LINES

  let buffer = []

  function append (chunk) {
    const plain = stripAnsi(chunk)
    if (!plain) return 0

    const raw = plain.split('\n')
    const added = raw.length

    for (let i = 0; i < raw.length; i++) {
      buffer.push(raw[i].slice(0, MAX_LINE_CHARS))
      if (buffer.length > maxLines) {
        buffer.shift()
      }
    }

    return added
  }

  function clear () {
    const count = buffer.length
    buffer = []
    return count
  }

  function lines () {
    return [...buffer]
  }

  function text () {
    return buffer.join('\n')
  }

  function tail (count = 25) {
    const n = Math.max(1, typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : 25)
    return buffer.slice(-n).join('\n')
  }

  function errors () {
    return parseErrors(text())
  }

  function summary () {
    const t = text()
    const errs = errors()
    return {
      totalLines: buffer.length,
      bytes: t.length,
      hasErrors: errs.length > 0,
      errorCount: errs.length
    }
  }

  return {
    append,
    clear,
    lines,
    text,
    tail,
    errors,
    summary
  }
}