// Workspace breadcrumb path parsing and formatting helper. Pure ES module.
export const MAX_PATH = 300
export const MAX_SEGMENTS = 10
export const MIN_SEGMENTS = 3
export const MAX_LABEL = 80

function cleanString (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').trim()
}

function normalizePath (pathStr) {
  const clean = cleanString(pathStr).replace(/\\/g, '/')
  const rawSegments = clean.split('/').filter(s => s && s !== '.')

  // Resolve dot-dot segments safely within workspace root
  const resolved = []
  for (const seg of rawSegments) {
    if (seg === '..') {
      if (resolved.length > 0) resolved.pop()
    } else {
      resolved.push(seg.slice(0, MAX_LABEL))
    }
  }

  return resolved
}

function compact (items, maxCount) {
  if (items.length <= maxCount) return items

  // Reserve one slot for the ellipsis segment
  const headCount = Math.max(1, Math.floor((maxCount - 1) / 2))
  const tailCount = Math.max(1, maxCount - 1 - headCount)

  const head = items.slice(0, headCount)
  const tail = items.slice(items.length - tailCount)

  const ellipsis = {
    label: '…',
    path: '',
    isLeaf: false,
    isRoot: false,
    isSymbol: false,
    isEllipsis: true,
    icon: 'more'
  }

  return [...head, ellipsis, ...tail]
}

export function parentOf (pathStr) {
  const segments = normalizePath(pathStr)
  if (segments.length <= 1) return ''
  return segments.slice(0, -1).join('/')
}

export function format (pathStr, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const rootName = cleanString(opts.root).slice(0, MAX_LABEL)
  const symbolName = cleanString(opts.symbol).slice(0, MAX_LABEL)

  const rawMax = opts.maxSegments
  const maxSegs = typeof rawMax === 'number' && Number.isFinite(rawMax)
    ? Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.floor(rawMax)))
    : 6

  const segments = normalizePath(pathStr)
  const items = []

  if (rootName) {
    items.push({
      label: rootName,
      path: '',
      isLeaf: false,
      isRoot: true,
      isSymbol: false,
      isEllipsis: false,
      icon: 'workspace'
    })
  }

  let accumulated = ''
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    accumulated = accumulated ? accumulated + '/' + seg : seg
    const isFile = i === segments.length - 1

    items.push({
      label: seg,
      path: accumulated,
      isLeaf: false,
      isRoot: false,
      isSymbol: false,
      isEllipsis: false,
      icon: isFile ? 'file' : 'folder'
    })
  }

  if (symbolName) {
    items.push({
      label: symbolName,
      path: accumulated,
      isLeaf: false,
      isRoot: false,
      isSymbol: true,
      isEllipsis: false,
      icon: 'symbol'
    })
  }

  if (items.length === 0) return []

  // Ensure only the final element is marked as leaf
  const result = compact(items, maxSegs)
  for (let i = 0; i < result.length; i++) {
    result[i].isLeaf = i === result.length - 1
  }

  return result
}

export function renderText (items, separator = ' > ') {
  if (!Array.isArray(items)) return ''
  return items.map(it => (it && typeof it.label === 'string' ? it.label : '')).filter(Boolean).join(separator)
}

export function createBreadcrumbs (defaultOptions = {}) {
  const baseOpts = defaultOptions && typeof defaultOptions === 'object' ? { ...defaultOptions } : {}

  return {
    format: (pathStr, overrides = {}) => format(pathStr, { ...baseOpts, ...overrides }),
    renderText: (items, sep) => renderText(items, sep),
    parentOf: pathStr => parentOf(pathStr)
  }
}