// File and folder operations for the explorer: what is allowed and exactly what changes. Pure ES module, no storage, no DOM. Run: node app/test/pathops.test.mjs
// A project is a list of paths like 'src/a.py'. Folders are implicit (a folder exists while some path starts with 'folder/'); an empty folder is a marker file inside it.
// Names use only letters, digits, dot, dash and underscore: the same set the agents accept (agents/src/room.js), so a person and an agent can always open each other's files.

export const MAX_SEGMENT = 120
export const MAX_PATH = 300
export const MAX_DEPTH = 12
export const MAX_MOVES = 500
export const FOLDER_MARKER = '.keep'

const SEGMENT = /^[A-Za-z0-9._-]+$/
const fail = reason => ({ ok: false, reason })
const lc = s => s.toLowerCase()

export function validateName (name) {
  if (typeof name !== 'string') return fail('Give a name')
  let cleaned = name.trim()
  if (cleaned.startsWith('./')) cleaned = cleaned.slice(2)
  if (!cleaned) return fail('Give a name')
  if (cleaned.startsWith('/') || cleaned.includes('\\')) return fail('Use / between folders, with no / at the start')
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) return fail('That name has a hidden character')
  const segments = cleaned.split('/')
  if (segments.some(s => s === '')) return fail('A folder or file name is empty')
  if (segments.some(s => /^\.+$/.test(s))) return fail('Names cannot use . or .. as a step')
  if (segments.some(s => s.length > MAX_SEGMENT)) return fail('A name is too long')
  if (segments.length > MAX_DEPTH || cleaned.length > MAX_PATH) return fail('That path is too long')
  if (segments.some(s => !SEGMENT.test(s))) return fail('Use letters, numbers, dots, dashes and underscores')
  if (segments.some(s => s.endsWith('.'))) return fail('A name cannot end with a dot')
  if (lc(segments[0]) === '.git') return fail('That folder is managed by git')
  if (lc(segments[segments.length - 1]) === FOLDER_MARKER) return fail(FOLDER_MARKER + ' is reserved for empty folders')
  return { ok: true, name: cleaned }
}

export const joinPath = (dir, name) => [String(dir || '').replace(/^\/+|\/+$/g, ''), String(name || '').replace(/^\/+/, '')].filter(Boolean).join('/')

// 'file' when a path equals p, 'folder' when some path starts with p + '/', else null. Case-insensitive: 'File.py' and 'file.py' are one name.
export function exists (paths, p) {
  const k = lc(String(p)); let folder = false
  for (const x of paths || []) { const l = lc(x); if (l === k) return 'file'; if (l.startsWith(k + '/')) folder = true }
  return folder ? 'folder' : null
}

const ancestorsOf = p => { const parts = p.split('/'); const out = []; for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/')); return out }

// A file named like an ancestor would make a folder impossible ('a' is a file, so 'a/b' cannot exist).
const blockedByFile = (paths, target) => ancestorsOf(target).find(a => (paths || []).some(x => lc(x) === lc(a)))

export function planCreate (paths, dir, name, kind) {
  if (kind !== 'file' && kind !== 'folder') return fail('Unknown kind')
  const v = validateName(name); if (!v.ok) return v
  const target = joinPath(dir, v.name)
  const full = validateName(target); if (!full.ok) return full
  if (full.name !== target) return fail('That parent path is not usable')
  const added = kind === 'file' ? target : target + '/' + FOLDER_MARKER
  if (added.length > MAX_PATH || added.split('/').length > MAX_DEPTH) return fail('That path is too long')
  const have = exists(paths, target)
  if (have) return fail(`There is already a ${have} named ${target}`)
  const blocker = blockedByFile(paths, target)
  if (blocker) return fail(`${blocker} is a file, so it cannot hold ${target}`)
  return { ok: true, add: [added], path: target }
}

export function planRename (paths, from, to) {
  if (typeof from !== 'string') return fail('Give the name to rename')
  const kind = exists(paths, from); if (!kind) return fail('Nothing named that')
  const v = validateName(to); if (!v.ok) return v
  const dest = v.name
  if (dest === from) return fail('That is already its name')
  if (kind === 'folder' && lc(dest).startsWith(lc(from) + '/')) return fail('A folder cannot move into itself')
  const moving = kind === 'file' ? [(paths || []).find(x => lc(x) === lc(from))] : (paths || []).filter(x => lc(x).startsWith(lc(from) + '/'))
  if (moving.length > MAX_MOVES) return fail('Too many files to move at once')
  const movingSet = new Set(moving.map(lc))
  const remaining = (paths || []).filter(x => !movingSet.has(lc(x)))
  const remainingNames = new Set(remaining.map(lc))
  const remainingFolders = new Set(remaining.flatMap(p => ancestorsOf(lc(p))))
  const moves = moving.map(old => [old, kind === 'file' ? dest : dest + old.slice(from.length)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [, nu] of moves) {
    if (nu.length > MAX_PATH || nu.split('/').length > MAX_DEPTH) return fail('That path is too long')
    // a collision is any existing path (not itself being moved) that has the same name, or that is a file where a folder is needed
    if (remainingNames.has(lc(nu))) return fail(`There is already a file named ${nu}`)
    const parentFile = ancestorsOf(nu).find(p => remainingNames.has(lc(p)))
    if (parentFile) return fail(`${parentFile} is a file, so it cannot hold ${nu}`)
    if (remainingFolders.has(lc(nu))) return fail(`There is already a folder named ${nu}`)
  }
  const blocker = blockedByFile((paths || []).filter(x => !movingSet.has(lc(x))), dest)
  if (blocker) return fail(`${blocker} is a file, so it cannot hold ${dest}`)
  const folderClash = (paths || []).some(x => !movingSet.has(lc(x)) && (lc(x).startsWith(lc(dest) + '/')) && kind === 'file')
  if (folderClash) return fail(`There is already a folder named ${dest}`)
  return { ok: true, moves }
}

export function planDelete (paths, target) {
  const kind = exists(paths, target); if (!kind) return fail('Nothing named that')
  const k = lc(String(target))
  const remove = (paths || []).filter(x => lc(x) === k || lc(x).startsWith(k + '/')).sort()
  return { ok: true, remove, count: remove.length, kind }
}

// The rows an explorer should show for a path list: the marker files stay out of sight.
export const isMarker = p => String(p).split('/').pop() === FOLDER_MARKER
export const visiblePaths = paths => (paths || []).filter(p => !isMarker(p))
