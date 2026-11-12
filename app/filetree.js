// File tree state: folders stay closed until you are in them. Pure ES module, no DOM. Run: node app/test/filetree.test.mjs
//
// Rules (the team, 2026-11-01: "stay minimized until you are in that part ... when you come back to the same folder you are on the same"):
//  - a folder is OPEN when the person opened it (kept across reloads, per workspace) or when the file they are in lives inside it;
//  - the folders that were only open because of the active file close again when the person moves to another part of the project;
//  - if the person closes the folder that holds the file they are in, it stays closed until they move to another file;
//  - what the person opened by hand is remembered; what they closed by hand stays closed.

export const MAX_OPEN = 400
export const MAX_PATH = 300

// 'a/b/c.py' -> ['a', 'a/b']
export function ancestors (path) {
  const parts = String(path || '').split('/').filter(Boolean); const out = []
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(0, i + 1).join('/'))
  return out
}

export function createTreeState (saved) {
  const manual = new Set(parseOpen(saved)); const shut = new Set(); let active = ''
  const api = {
    get manual () { return manual }, get shut () { return shut }, get active () { return active },
    // The person is in another file now: the folders that were open only for the old file close, and a folder they shut for the old file may open again.
    setActive (path) { const p = String(path || ''); if (p === active) return false; active = p; shut.clear(); return true },
    isOpen (dir) { return (manual.has(dir) || ancestors(active).includes(dir)) && !shut.has(dir) },
    // Click on a folder. Returns the new state (true = open).
    toggle (dir) {
      dir = String(dir || ''); if (!dir || dir.length > MAX_PATH) return api.isOpen(dir)
      if (api.isOpen(dir)) { manual.delete(dir); if (ancestors(active).includes(dir)) shut.add(dir); return false }
      shut.delete(dir); manual.add(dir)
      if (manual.size > MAX_OPEN) manual.delete(manual.values().next().value)
      return true
    },
    open (dir) { if (!api.isOpen(dir)) api.toggle(dir) },
    close (dir) { if (api.isOpen(dir)) api.toggle(dir) },
    // Forget folders that no longer exist (a file was deleted or the workspace changed).
    prune (paths) { const dirs = new Set(); for (const p of paths || []) for (const a of ancestors(p)) dirs.add(a); for (const d of [...manual]) if (!dirs.has(d)) manual.delete(d) },
    serialize () { return JSON.stringify([...manual].slice(-MAX_OPEN)) }
  }
  return api
}

// What was saved: a JSON list of folder paths. Anything else (wrong type, huge, hostile) is dropped.
export function parseOpen (saved) {
  let list = saved
  if (typeof saved === 'string') { try { list = JSON.parse(saved) } catch { return [] } }
  if (!Array.isArray(list)) return []
  return list.filter(x => typeof x === 'string' && x.length > 0 && x.length <= MAX_PATH && !x.includes('\0')).slice(0, MAX_OPEN)
}

// Number of files below a folder node of the shell's tree ({ n, dir, kids }).
export function countFiles (node) { if (!node || !node.dir) return node ? 1 : 0; return (node.kids || []).reduce((s, k) => s + countFiles(k), 0) }

// What an arrow key does on a row. rows = the visible rows in order as { path, dir, open, depth }; returns { move: index } or { toggle: path } or null.
export function arrowAction (rows, index, key) {
  const r = rows[index]; if (!r) return null
  if (key === 'ArrowDown') return index + 1 < rows.length ? { move: index + 1 } : null
  if (key === 'ArrowUp') return index > 0 ? { move: index - 1 } : null
  if (key === 'ArrowRight') { if (r.dir && !r.open) return { toggle: r.path }; if (r.dir && r.open && rows[index + 1] && rows[index + 1].depth > r.depth) return { move: index + 1 }; return null }
  if (key === 'ArrowLeft') {
    if (r.dir && r.open) return { toggle: r.path }
    for (let i = index - 1; i >= 0; i--) if (rows[i].depth < r.depth) return { move: i }
    return null
  }
  if (key === 'Home') return index > 0 ? { move: 0 } : null
  if (key === 'End') return index < rows.length - 1 ? { move: rows.length - 1 } : null
  return null
}
