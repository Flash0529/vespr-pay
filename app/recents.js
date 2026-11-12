// Recently opened files for quick switching. Pure ES module.
export const MAX_RECENTS = 12
export const MAX_PATH = 300

function isValidPath (p) {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH && !p.includes('\u0000')
}

export function createRecents (saved) {
  let items = []

  let raw = saved
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch {
      raw = []
    }
  }

  if (Array.isArray(raw)) {
    const seen = new Set()
    for (const entry of raw) {
      if (isValidPath(entry) && !seen.has(entry)) {
        seen.add(entry)
        items.push(entry)
        if (items.length >= MAX_RECENTS) break
      }
    }
  }

  function touch (path) {
    if (!isValidPath(path)) return
    items = items.filter(p => p !== path)
    items.unshift(path)
    if (items.length > MAX_RECENTS) {
      items.pop()
    }
  }

  function list (existing) {
    if (Array.isArray(existing)) {
      const set = new Set(existing)
      return items.filter(p => set.has(p))
    }
    return [...items]
  }

  function remove (path) {
    if (typeof path !== 'string') return
    items = items.filter(p => p !== path)
  }

  function rename (from, to) {
    if (!isValidPath(from) || !isValidPath(to)) return
    const fromPrefix = from + '/'
    const toPrefix = to + '/'

    const updated = []
    const seen = new Set()

    for (const p of items) {
      let next = p
      if (p === from) {
        next = to
      } else if (p.startsWith(fromPrefix)) {
        next = toPrefix + p.slice(fromPrefix.length)
      }
      if (!seen.has(next)) {
        seen.add(next)
        updated.push(next)
      }
    }
    items = updated.slice(0, MAX_RECENTS)
  }

  function serialize () {
    return JSON.stringify(items)
  }

  return { touch, list, remove, rename, serialize }
}
