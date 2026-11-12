// Workspace diagnostics and problems manager for the SDE shell. Pure ES module.
export const MAX_PROBLEMS = 200
export const MAX_PATH = 300
export const MAX_MESSAGE = 1000
export const SEVERITIES = ['error', 'warning', 'info']

function isValidPath (p) {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH && !p.includes('\u0000')
}

function cleanSeverity (sev) {
  if (typeof sev === 'string') {
    const s = sev.toLowerCase().trim()
    if (s === 'err' || s === 'error') return 'error'
    if (s === 'warn' || s === 'warning') return 'warning'
    if (s === 'info' || s === 'information' || s === 'hint') return 'info'
  }
  return 'error'
}

function cleanPos (val) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.max(1, Math.floor(val))
  }
  return 1
}

function cleanString (str, maxLen = MAX_MESSAGE) {
  if (typeof str !== 'string') return ''
  return str.replace(/\u0000/g, '').trim().slice(0, maxLen)
}

function normalizeProblem (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!isValidPath(raw.file)) return null

  const file = raw.file
  const line = cleanPos(raw.line)
  const col = cleanPos(raw.col)
  const message = cleanString(raw.message) || 'unknown problem'
  const severity = cleanSeverity(raw.severity)
  const source = cleanString(raw.source, 50) || 'workspace'

  return { file, line, col, message, severity, source }
}

export function createProblems (options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const rawMax = opts.max
  const limit = Math.max(1, Math.min(MAX_PROBLEMS, typeof rawMax === 'number' && Number.isFinite(rawMax) ? Math.floor(rawMax) : MAX_PROBLEMS))

  let items = []

  function add (raw) {
    const prob = normalizeProblem(raw)
    if (!prob) return false

    // Avoid exact duplicate
    const exists = items.some(it =>
      it.file === prob.file &&
      it.line === prob.line &&
      it.col === prob.col &&
      it.message === prob.message &&
      it.severity === prob.severity
    )
    if (exists) return false

    if (items.length >= limit) {
      items.shift() // Evict oldest problem when reaching limit
    }
    items.push(prob)
    return true
  }

  function set (file, rawList) {
    if (!isValidPath(file)) return 0
    clear(file)
    if (!Array.isArray(rawList)) return 0

    let added = 0
    for (const item of rawList) {
      if (item && typeof item === 'object') {
        const candidate = { ...item, file }
        if (add(candidate)) added++
      }
    }
    return added
  }

  function clear (file) {
    if (typeof file === 'string' && file) {
      const initialCount = items.length
      items = items.filter(it => it.file !== file)
      return initialCount - items.length
    }
    const count = items.length
    items = []
    return count
  }

  function list () {
    return items.map(it => ({ ...it }))
  }

  function summary () {
    let errors = 0
    let warnings = 0
    let infos = 0
    for (const it of items) {
      if (it.severity === 'error') errors++
      else if (it.severity === 'warning') warnings++
      else if (it.severity === 'info') infos++
    }
    return { total: items.length, errors, warnings, infos }
  }

  function filter (crit = {}) {
    if (!crit || typeof crit !== 'object') return list()
    const { file, severity, query } = crit
    const targetFile = typeof file === 'string' && file ? file : null
    const targetSev = typeof severity === 'string' && severity ? cleanSeverity(severity) : null
    const targetQuery = typeof query === 'string' && query.trim() ? query.trim().toLowerCase() : null

    return items.filter(it => {
      if (targetFile && it.file !== targetFile) return false
      if (targetSev && it.severity !== targetSev) return false
      if (targetQuery) {
        const text = `${it.file} ${it.message} ${it.source}`.toLowerCase()
        if (!text.includes(targetQuery)) return false
      }
      return true
    }).map(it => ({ ...it }))
  }

  function groupByFile () {
    const groups = {}
    for (const it of items) {
      if (!groups[it.file]) groups[it.file] = []
      groups[it.file].push({ ...it })
    }
    // Return sorted by filename
    const sorted = {}
    for (const k of Object.keys(groups).sort()) {
      sorted[k] = groups[k].sort((a, b) => a.line - b.line || a.col - b.col)
    }
    return sorted
  }

  function formatRow (problem) {
    const p = normalizeProblem(problem)
    if (!p) return ''
    const src = p.source ? ` (${p.source})` : ''
    return `${p.file}:${p.line}:${p.col} [${p.severity}] ${p.message}${src}`
  }

  function rename (from, to) {
    if (!isValidPath(from) || !isValidPath(to)) return 0
    if (from === to) return 0

    const fromPrefix = from.endsWith('/') ? from : from + '/'
    const toPrefix = to.endsWith('/') ? to : to + '/'

    let renamedCount = 0
    for (const it of items) {
      if (it.file === from) {
        it.file = to
        renamedCount++
      } else if (it.file.startsWith(fromPrefix)) {
        const candidate = toPrefix + it.file.slice(fromPrefix.length)
        if (isValidPath(candidate)) {
          it.file = candidate
          renamedCount++
        }
      }
    }
    return renamedCount
  }

  function serialize () {
    return JSON.stringify({
      items: items.map(it => ({ ...it }))
    })
  }

  function deserialize (data) {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        return false
      }
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) return false
    if (Object.prototype.hasOwnProperty.call(data, '__proto__') || Object.prototype.hasOwnProperty.call(data, 'constructor')) return false

    const rawItems = Array.isArray(data.items) ? data.items : []
    const valid = []
    for (const raw of rawItems) {
      const p = normalizeProblem(raw)
      if (p) {
        valid.push(p)
        if (valid.length >= limit) break
      }
    }
    items = valid
    return true
  }

  return {
    add,
    set,
    clear,
    list,
    summary,
    filter,
    groupByFile,
    formatRow,
    rename,
    serialize,
    deserialize
  }
}
