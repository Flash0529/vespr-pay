// Tab and editor document lifecycle manager for the SDE shell. Pure ES module.
export const MAX_TABS = 16
export const MAX_PATH = 300

function isValidPath (p) {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_PATH && !p.includes('\u0000')
}

export function createTabs (options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const rawMax = opts.max
  const limit = Math.max(1, Math.min(MAX_TABS, typeof rawMax === 'number' && Number.isFinite(rawMax) ? Math.floor(rawMax) : 8))
  let items = [] // Array of { path: string, pinned: boolean }
  let activePath = ''
  let accessHistory = [] // MRU order of paths

  function touchAccess (p) {
    accessHistory = accessHistory.filter(x => x !== p)
    accessHistory.unshift(p)
  }

  function open (path) {
    if (!isValidPath(path)) return { active: activePath, tabs: list(), evicted: null }

    const existing = items.find(item => item.path === path)
    if (existing) {
      activePath = path
      touchAccess(path)
      return { active: activePath, tabs: list(), evicted: null }
    }

    let evicted = null
    if (items.length >= limit) {
      // Find least recently used unpinned tab
      for (let i = accessHistory.length - 1; i >= 0; i--) {
        const cand = accessHistory[i]
        const idx = items.findIndex(item => item.path === cand && !item.pinned)
        if (idx !== -1) {
          evicted = items[idx].path
          items.splice(idx, 1)
          accessHistory = accessHistory.filter(x => x !== evicted)
          break
        }
      }

      // Fallback: if all history had issues, pick first unpinned tab
      if (!evicted) {
        const idx = items.findIndex(item => !item.pinned)
        if (idx !== -1) {
          evicted = items[idx].path
          items.splice(idx, 1)
          accessHistory = accessHistory.filter(x => x !== evicted)
        }
      }
    }

    // Add new tab if space allows
    if (items.length < limit || evicted) {
      items.push({ path, pinned: false })
      activePath = path
      touchAccess(path)
    }

    return { active: activePath, tabs: list(), evicted }
  }

  function close (path) {
    if (typeof path !== 'string' || !path) return { active: activePath, closed: null }

    const idx = items.findIndex(item => item.path === path)
    if (idx === -1) return { active: activePath, closed: null }

    const wasActive = activePath === path
    items.splice(idx, 1)
    accessHistory = accessHistory.filter(x => x !== path)

    if (wasActive) {
      if (items.length === 0) {
        activePath = ''
      } else {
        // Choose adjacent right tab, or left tab if closed tab was at the end
        const nextIdx = idx < items.length ? idx : items.length - 1
        activePath = items[nextIdx].path
        touchAccess(activePath)
      }
    }

    return { active: activePath, closed: path }
  }

  function closeOthers (path) {
    if (typeof path !== 'string' || !path) return { active: activePath, closed: [] }
    const exists = items.some(item => item.path === path)
    if (!exists) return { active: activePath, closed: [] }

    const closed = []
    const retained = []

    for (const item of items) {
      if (item.path === path || item.pinned) {
        retained.push(item)
      } else {
        closed.push(item.path)
      }
    }

    items = retained
    const closedSet = new Set(closed)
    accessHistory = accessHistory.filter(x => !closedSet.has(x))

    activePath = path
    touchAccess(path)

    return { active: activePath, closed }
  }

  function closeToRight (path) {
    if (typeof path !== 'string' || !path) return { active: activePath, closed: [] }
    const targetIdx = items.findIndex(item => item.path === path)
    if (targetIdx === -1) return { active: activePath, closed: [] }

    const closed = []
    const retained = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (i > targetIdx && !item.pinned) {
        closed.push(item.path)
      } else {
        retained.push(item)
      }
    }

    items = retained
    const closedSet = new Set(closed)
    accessHistory = accessHistory.filter(x => !closedSet.has(x))

    if (closedSet.has(activePath)) {
      activePath = path
      touchAccess(path)
    }

    return { active: activePath, closed }
  }

  function pin (path, isPinned = true) {
    if (typeof path !== 'string') return false
    const item = items.find(it => it.path === path)
    if (!item) return false
    item.pinned = Boolean(isPinned)
    return true
  }

  function move (fromIdx, toIdx) {
    if (typeof fromIdx !== 'number' || typeof toIdx !== 'number') return false
    if (!Number.isFinite(fromIdx) || !Number.isFinite(toIdx)) return false
    fromIdx = Math.floor(fromIdx)
    toIdx = Math.floor(toIdx)
    if (fromIdx < 0 || fromIdx >= items.length || toIdx < 0 || toIdx >= items.length) return false
    if (fromIdx === toIdx) return true

    const [moved] = items.splice(fromIdx, 1)
    items.splice(toIdx, 0, moved)
    return true
  }

  function rename (from, to) {
    if (!isValidPath(from) || !isValidPath(to)) return false
    if (from === to) return false

    const fromPrefix = from.endsWith('/') ? from : from + '/'
    const toPrefix = to.endsWith('/') ? to : to + '/'

    let renamedAny = false
    const updated = []
    const seen = new Map() // path -> index in updated

    for (const item of items) {
      let nextPath = item.path
      if (item.path === from) {
        nextPath = to
        renamedAny = true
      } else if (item.path.startsWith(fromPrefix)) {
        const candidate = toPrefix + item.path.slice(fromPrefix.length)
        if (isValidPath(candidate)) {
          nextPath = candidate
          renamedAny = true
        }
      }

      if (seen.has(nextPath)) {
        const idx = seen.get(nextPath)
        if (item.pinned) updated[idx].pinned = true
      } else {
        seen.set(nextPath, updated.length)
        updated.push({ path: nextPath, pinned: item.pinned })
      }
    }

    items = updated

    // Update active path
    if (activePath === from) {
      activePath = to
    } else if (activePath.startsWith(fromPrefix)) {
      const candidate = toPrefix + activePath.slice(fromPrefix.length)
      if (isValidPath(candidate)) {
        activePath = candidate
      }
    }

    // Update access history
    const nextHistory = []
    const historySeen = new Set()
    for (const p of accessHistory) {
      let nextP = p
      if (p === from) {
        nextP = to
      } else if (p.startsWith(fromPrefix)) {
        const candidate = toPrefix + p.slice(fromPrefix.length)
        if (isValidPath(candidate)) {
          nextP = candidate
        }
      }
      if (!historySeen.has(nextP)) {
        historySeen.add(nextP)
        nextHistory.push(nextP)
      }
    }
    accessHistory = nextHistory

    return renamedAny
  }

  function active () {
    return activePath
  }

  function list () {
    return items.map(it => ({ path: it.path, pinned: it.pinned }))
  }

  function paths () {
    return items.map(it => it.path)
  }

  function serialize () {
    return JSON.stringify({
      active: activePath,
      items: items.map(it => ({ path: it.path, pinned: it.pinned }))
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
    const validItems = []
    const seen = new Set()

    for (const entry of rawItems) {
      if (entry && typeof entry === 'object' && isValidPath(entry.path) && !seen.has(entry.path)) {
        seen.add(entry.path)
        validItems.push({
          path: entry.path,
          pinned: Boolean(entry.pinned)
        })
        if (validItems.length >= limit) break
      }
    }

    items = validItems
    accessHistory = validItems.map(it => it.path)

    if (isValidPath(data.active) && seen.has(data.active)) {
      activePath = data.active
      touchAccess(activePath)
    } else {
      activePath = items.length > 0 ? items[0].path : ''
      if (activePath) touchAccess(activePath)
    }

    return true
  }

  return {
    open,
    close,
    closeOthers,
    closeToRight,
    pin,
    move,
    rename,
    active,
    list,
    paths,
    serialize,
    deserialize
  }
}
