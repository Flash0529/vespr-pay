// Workspace file tree builder, flattener, and filter. Pure ES module.
export const MAX_PATHS = 5000
export const MAX_PATH_LEN = 300
export const MAX_DEPTH = 30
export const MAX_ROWS = 2000

// Compares two strings using case-insensitive natural numeric ordering.
export function naturalCompare (a, b) {
  const sa = String(a || '')
  const sb = String(b || '')
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

// Extracts extension from a file path or segment name.
function getExt (name) {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

// Normalizes a path string into clean Unix relative segments.
function splitPath (rawPath) {
  if (typeof rawPath !== 'string') return []
  const clean = rawPath.replace(/\\/g, '/').slice(0, MAX_PATH_LEN).trim()
  if (!clean) return []
  const segments = clean.split('/').filter(s => s.length > 0 && s !== '.' && s !== '__proto__' && s !== 'constructor')
  return segments.slice(0, MAX_DEPTH)
}

// Counts files (nodes with dir === 0) recursively.
export function countTreeFiles (nodeOrNodes) {
  if (!nodeOrNodes) return 0
  if (Array.isArray(nodeOrNodes)) {
    let sum = 0
    for (const item of nodeOrNodes) sum += countTreeFiles(item)
    return sum
  }
  if (!nodeOrNodes.dir) return 1
  let total = 0
  if (Array.isArray(nodeOrNodes.kids)) {
    for (const k of nodeOrNodes.kids) total += countTreeFiles(k)
  }
  return total
}

// Sorts tree nodes in-place: directories first, then alphabetical natural sort.
export function sortTreeNodes (nodes) {
  if (!Array.isArray(nodes)) return []
  nodes.sort((a, b) => {
    const aDir = a.dir ? 1 : 0
    const bDir = b.dir ? 1 : 0
    if (aDir !== bDir) return bDir - aDir
    return naturalCompare(a.n, b.n)
  })
  for (const n of nodes) {
    if (n.dir && Array.isArray(n.kids)) {
      sortTreeNodes(n.kids)
    }
  }
  return nodes
}

// Builds a hierarchical tree from a flat list of workspace relative paths.
export function buildTree (paths, options = {}) {
  if (!Array.isArray(paths)) return []
  const hideKeepFiles = options.hideKeepFiles !== false
  const shouldSort = options.sort !== false
  const changedSet = options.changedPaths instanceof Set
    ? options.changedPaths
    : new Set(Array.isArray(options.changedPaths) ? options.changedPaths : [])

  const count = Math.min(paths.length, MAX_PATHS)
  const root = { kids: [] }

  for (let pIdx = 0; pIdx < count; pIdx++) {
    const raw = paths[pIdx]
    const parts = splitPath(raw)
    if (!parts.length) continue

    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isFile = i === parts.length - 1
      const isDir = !isFile
      const full = parts.slice(0, i + 1).join('/')

      let existing = cur.kids.find(k => k.n === seg)
      if (existing) {
        if (isDir && !existing.dir) {
          existing.dir = 1
          existing.kids = existing.kids || []
          existing.ext = ''
        } else if (isFile && changedSet.has(full)) {
          existing.chg = true
        }
      } else {
        existing = {
          n: seg,
          full,
          dir: isDir ? 1 : 0,
          kids: isDir ? [] : undefined,
          ext: isFile ? getExt(seg) : '',
          chg: changedSet.has(full)
        }
        cur.kids.push(existing)
      }
      cur = existing
    }
  }

  // Bubble up chg flag and calculate recursive file counts
  function decorate (node) {
    if (!node.dir) {
      node.count = 1
      return { count: 1, chg: !!node.chg }
    }
    let totalCount = 0
    let anyChg = !!node.chg
    if (Array.isArray(node.kids)) {
      if (hideKeepFiles) {
        node.kids = node.kids.filter(k => !(k.n === '.keep' && !k.dir))
      }
      for (const kid of node.kids) {
        const res = decorate(kid)
        totalCount += res.count
        if (res.chg) anyChg = true
      }
    }
    node.count = totalCount
    node.chg = anyChg
    return { count: totalCount, chg: anyChg }
  }

  if (hideKeepFiles) {
    root.kids = root.kids.filter(k => !(k.n === '.keep' && !k.dir))
  }
  for (const top of root.kids) {
    decorate(top)
  }

  if (shouldSort) {
    sortTreeNodes(root.kids)
  }

  return root.kids
}

// Flattens the visible tree structure into a 1D list of rows for rendering.
export function flattenTree (nodes, isOpen = () => false, options = {}) {
  const rootList = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : [])
  const maxRows = typeof options.maxRows === 'number' && Number.isFinite(options.maxRows)
    ? Math.max(1, Math.min(MAX_ROWS, Math.floor(options.maxRows)))
    : MAX_ROWS
  const activePath = typeof options.activePath === 'string' ? options.activePath.trim() : ''

  const rows = []

  function walk (list, depth) {
    if (depth > MAX_DEPTH || rows.length >= maxRows) return
    for (const node of list) {
      if (!node || typeof node !== 'object') continue
      if (rows.length >= maxRows) break

      const open = !!(node.dir && (typeof isOpen === 'function' ? isOpen(node.full) : false))
      const active = !node.dir && node.full === activePath

      rows.push({
        n: node.n,
        full: node.full,
        dir: node.dir ? 1 : 0,
        depth,
        open,
        count: typeof node.count === 'number' ? node.count : (node.dir ? 0 : 1),
        ext: node.ext || '',
        chg: !!node.chg,
        active
      })

      if (open && Array.isArray(node.kids) && node.kids.length > 0) {
        walk(node.kids, depth + 1)
      }
    }
  }

  walk(rootList, 0)
  return rows
}

// Finds a node by full path in a tree.
export function findNode (nodes, fullPath) {
  if (!fullPath || typeof fullPath !== 'string') return null
  const clean = fullPath.replace(/\\/g, '/').trim()
  const list = Array.isArray(nodes) ? nodes : (nodes ? [nodes] : [])

  for (const node of list) {
    if (!node || typeof node !== 'object') continue
    if (node.full === clean) return node
    if (node.dir && Array.isArray(node.kids)) {
      const match = findNode(node.kids, clean)
      if (match) return match
    }
  }
  return null
}

// Filters tree nodes matching query, retaining ancestor folders of matches.
export function filterTree (nodes, query) {
  if (!Array.isArray(nodes)) return []
  if (typeof query !== 'string' || !query.trim()) return nodes

  const q = query.trim().toLowerCase()

  function filterList (list) {
    const out = []
    for (const node of list) {
      if (!node || typeof node !== 'object') continue
      const nameMatch = String(node.n || '').toLowerCase().includes(q)

      if (node.dir && Array.isArray(node.kids)) {
        const filteredKids = filterList(node.kids)
        if (filteredKids.length > 0 || nameMatch) {
          out.push({
            ...node,
            kids: filteredKids,
            count: filteredKids.reduce((acc, k) => acc + (k.count || (k.dir ? 0 : 1)), 0)
          })
        }
      } else if (nameMatch) {
        out.push({ ...node })
      }
    }
    return out
  }

  return filterList(nodes)
}
